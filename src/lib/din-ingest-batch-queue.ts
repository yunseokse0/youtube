/**
 * DIN ingest HTTP 전용: 짧게 ACK 후 계정당 워커 1개가 메모리에서 여러 건 적용하고
 * AppState(정산표)에는 처리가 끝난 뒤에만 저장 1회.
 * 투네 WS 경로(tryAutoApplyToonationDonationOnServer)는 건드리지 않는다.
 */
import { readDonationAliases } from "@/app/api/donations/_shared/alias-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { persistDonationApplyLikeToonation } from "@/lib/donation/persist-donation-like-toon";
import { enqueueDonationEvent } from "@/lib/donation/toonation/enqueue-donation";
import type { DonationEvent } from "@/lib/donation/types";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";
import { runExclusivePerUser } from "@/lib/per-user-mutex";

const MAX_QUEUE = 8_000;
const MAX_FLUSH_BATCH = 200;
const DRAIN_MUTEX_MS = 60_000;

type QueuedIngest = {
  hubUserId: string;
  stateUserId: string;
  event: DonationEvent;
};

type QueueStore = {
  byUser: Map<string, QueuedIngest[]>;
  draining: Set<string>;
};

const STORE_KEY = "__YOUTUBE_DIN_INGEST_BATCH_QUEUE_V1__";

function getStore(): QueueStore {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = { byUser: new Map<string, QueuedIngest[]>(), draining: new Set<string>() };
  }
  return g[STORE_KEY] as QueueStore;
}

export function resetDinIngestBatchQueueForTests(): void {
  const store = getStore();
  store.byUser.clear();
  store.draining.clear();
}

export type EnqueueDinIngestResult =
  | { ok: true; queued: true; depth: number; duplicateQueued: boolean }
  | { ok: false; error: "queue_full" };

export function enqueueDinExcelIngest(
  hubUserId: string,
  event: DonationEvent
): EnqueueDinIngestResult {
  const stateUserId = resolveScopedOverlayUserId(hubUserId, "finalent") || hubUserId;
  const store = getStore();
  const q = store.byUser.get(stateUserId) || [];
  const id = String(event.id || "").trim();
  if (id && q.some((row) => String(row.event.id || "").trim() === id)) {
    return { ok: true, queued: true, depth: q.length, duplicateQueued: true };
  }
  if (q.length >= MAX_QUEUE) {
    return { ok: false, error: "queue_full" };
  }
  q.push({ hubUserId, stateUserId, event });
  store.byUser.set(stateUserId, q);
  void drainDinIngestQueue(stateUserId);
  return { ok: true, queued: true, depth: q.length, duplicateQueued: false };
}

function takeBatch(stateUserId: string): QueuedIngest[] {
  const store = getStore();
  const q = store.byUser.get(stateUserId);
  if (!q?.length) return [];
  return q.splice(0, MAX_FLUSH_BATCH);
}

function requeueFront(stateUserId: string, rows: QueuedIngest[]): void {
  if (!rows.length) return;
  const store = getStore();
  const q = store.byUser.get(stateUserId) || [];
  store.byUser.set(stateUserId, rows.concat(q));
}

async function flushBatch(stateUserId: string, rows: QueuedIngest[]): Promise<boolean> {
  const state = await loadAppStateForUserId(stateUserId);
  if (!state) return false;
  const aliases = await readDonationAliases(stateUserId);
  const folded = foldIngestEventsIntoState(
    state,
    rows.map((r) => r.event),
    aliases
  );
  for (const event of folded.unmatched) {
    await enqueueDonationEvent(stateUserId, event, { notify: false }).catch(() => false);
  }
  if (folded.applied.length === 0) return true;
  const last = folded.applied[folded.applied.length - 1]!;
  const persisted = await persistDonationApplyLikeToonation(stateUserId, folded.state, last);
  return persisted.ok;
}

export async function drainDinIngestQueue(stateUserId: string): Promise<void> {
  const uid = String(stateUserId || "").trim();
  if (!uid) return;
  const store = getStore();
  if (store.draining.has(uid)) return;
  store.draining.add(uid);
  try {
    await runExclusivePerUser(
      uid,
      async () => {
        while (true) {
          const batch = takeBatch(uid);
          if (batch.length === 0) break;
          const ok = await flushBatch(uid, batch);
          if (!ok) {
            requeueFront(uid, batch);
            break;
          }
        }
      },
      { timeoutMs: DRAIN_MUTEX_MS }
    );
  } catch (err) {
    console.error("[din-ingest-batch-queue] drain failed", uid, err instanceof Error ? err.message : err);
  } finally {
    store.draining.delete(uid);
    if ((store.byUser.get(uid) || []).length > 0) {
      void drainDinIngestQueue(uid);
    }
  }
}
