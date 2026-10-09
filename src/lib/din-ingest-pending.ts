/**
 * DIN ingest 메모리 대기열. 건수 상한 없음. 같은 ID는 한 줄만.
 * 저장(flush)은 din-ingest-batch-queue 가 200건씩 이어서 한다.
 */
import type { DonationEvent } from "@/lib/donation/types";

export const DIN_INGEST_FLUSH_BATCH = 200;

export type QueuedIngest = {
  hubUserId: string;
  stateUserId: string;
  event: DonationEvent;
  attempts?: number;
};

type QueueStore = {
  byUser: Map<string, QueuedIngest[]>;
  idsByUser: Map<string, Set<string>>;
  draining: Set<string>;
};

const STORE_KEY = "__YOUTUBE_DIN_INGEST_BATCH_QUEUE_V1__";

export function getDinIngestStore(): QueueStore {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[STORE_KEY]) {
    g[STORE_KEY] = {
      byUser: new Map<string, QueuedIngest[]>(),
      idsByUser: new Map<string, Set<string>>(),
      draining: new Set<string>(),
    };
  }
  return g[STORE_KEY] as QueueStore;
}

export function resetDinIngestBatchQueueForTests(): void {
  const store = getDinIngestStore();
  store.byUser.clear();
  store.idsByUser.clear();
  store.draining.clear();
}

export type OfferDinIngestResult = {
  ok: true;
  queued: true;
  depth: number;
  duplicateQueued: boolean;
};

function queuedIds(stateUserId: string): Set<string> {
  const store = getDinIngestStore();
  let ids = store.idsByUser.get(stateUserId);
  if (!ids) {
    ids = new Set<string>();
    store.idsByUser.set(stateUserId, ids);
  }
  return ids;
}

export function offerPendingIngest(
  hubUserId: string,
  stateUserId: string,
  event: DonationEvent
): OfferDinIngestResult {
  const store = getDinIngestStore();
  const q = store.byUser.get(stateUserId) || [];
  const ids = queuedIds(stateUserId);
  const id = String(event.id || "").trim();
  if (id && ids.has(id)) {
    return { ok: true, queued: true, depth: q.length, duplicateQueued: true };
  }
  q.push({ hubUserId, stateUserId, event });
  store.byUser.set(stateUserId, q);
  if (id) ids.add(id);
  return { ok: true, queued: true, depth: q.length, duplicateQueued: false };
}

export function takeBatch(stateUserId: string): QueuedIngest[] {
  const q = getDinIngestStore().byUser.get(stateUserId);
  if (!q?.length) return [];
  return q.splice(0, DIN_INGEST_FLUSH_BATCH);
}

export function forgetQueuedIds(stateUserId: string, rows: QueuedIngest[]): void {
  const ids = getDinIngestStore().idsByUser.get(stateUserId);
  if (!ids) return;
  for (const row of rows) {
    const id = String(row.event.id || "").trim();
    if (id) ids.delete(id);
  }
}

export function requeueFront(stateUserId: string, rows: QueuedIngest[]): void {
  if (!rows.length) return;
  const store = getDinIngestStore();
  const q = store.byUser.get(stateUserId) || [];
  store.byUser.set(stateUserId, rows.concat(q));
}
