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
import {
  eventMatchesDonorLedger,
  foldIngestEventsIntoState,
} from "@/lib/din-ingest-batch-fold";
import {
  forgetQueuedIds,
  getDinIngestStore,
  offerPendingIngest,
  requeueFront,
  takeBatch,
  type OfferDinIngestResult,
  type QueuedIngest,
} from "@/lib/din-ingest-pending";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";
import { runExclusivePerUser } from "@/lib/per-user-mutex";

export { resetDinIngestBatchQueueForTests } from "@/lib/din-ingest-pending";

const DRAIN_MUTEX_MS = 60_000;
/** 저장본에 UID가 없으면 다시 넣는다. 같은 건이 계속 빠지면 루프를 끊고 로그만 남긴다. */
const MAX_LAND_ATTEMPTS = 4;

export type EnqueueDinIngestResult = OfferDinIngestResult;

/** 대기 상한 없이 받는다. 같은 ID는 한 줄만 남긴다. 저장은 drain 이 200건씩 이어서 한다. */
export function offerDinExcelIngest(
  hubUserId: string,
  event: DonationEvent
): EnqueueDinIngestResult {
  const stateUserId = resolveScopedOverlayUserId(hubUserId, "finalent") || hubUserId;
  return offerPendingIngest(hubUserId, stateUserId, event);
}

export function enqueueDinExcelIngest(
  hubUserId: string,
  event: DonationEvent
): EnqueueDinIngestResult {
  const result = offerDinExcelIngest(hubUserId, event);
  if (!result.duplicateQueued) {
    void drainDinIngestQueue(resolveScopedOverlayUserId(hubUserId, "finalent") || hubUserId);
  }
  return result;
}

type FlushOutcome = { committed: boolean; retry: QueuedIngest[] };

function retryMissing(rows: QueuedIngest[]): QueuedIngest[] {
  const retry: QueuedIngest[] = [];
  for (const row of rows) {
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= MAX_LAND_ATTEMPTS) {
      console.error(
        "[din-ingest-batch-queue] donor missing after persist",
        row.event.id,
        row.event.amount,
        row.event.donorName
      );
      continue;
    }
    retry.push({ ...row, attempts });
  }
  return retry;
}

async function flushBatch(stateUserId: string, rows: QueuedIngest[]): Promise<FlushOutcome> {
  const state = await loadAppStateForUserId(stateUserId);
  if (!state) return { committed: false, retry: rows };
  const aliases = await readDonationAliases(stateUserId);
  const folded = foldIngestEventsIntoState(
    state,
    rows.map((r) => r.event),
    aliases
  );
  for (const event of folded.unmatched) {
    await enqueueDonationEvent(stateUserId, event, { notify: false }).catch(() => false);
  }
  if (folded.applied.length === 0) {
    forgetQueuedIds(stateUserId, rows);
    return { committed: true, retry: [] };
  }
  const last = folded.applied[folded.applied.length - 1]!;
  const persisted = await persistDonationApplyLikeToonation(stateUserId, folded.state, last);
  if (!persisted.ok) return { committed: false, retry: rows };
  const donors = persisted.state.donors || [];
  const missing = rows.filter((row) => {
    const landedInFold = folded.applied.some(
      (event) => String(event.id || "") === String(row.event.id || "")
    );
    if (!landedInFold) return false;
    return !eventMatchesDonorLedger(row.event, donors);
  });
  const missingIds = new Set(missing.map((row) => String(row.event.id || "").trim()).filter(Boolean));
  forgetQueuedIds(
    stateUserId,
    rows.filter((row) => !missingIds.has(String(row.event.id || "").trim()))
  );
  if (!missing.length) return { committed: true, retry: [] };
  return { committed: false, retry: retryMissing(missing) };
}

export async function drainDinIngestQueue(stateUserId: string): Promise<void> {
  const uid = String(stateUserId || "").trim();
  if (!uid) return;
  const store = getDinIngestStore();
  if (store.draining.has(uid)) return;
  store.draining.add(uid);
  try {
    await runExclusivePerUser(
      uid,
      async () => {
        while (true) {
          const batch = takeBatch(uid);
          if (batch.length === 0) break;
          const outcome = await flushBatch(uid, batch);
          if (!outcome.committed) {
            requeueFront(uid, outcome.retry);
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
