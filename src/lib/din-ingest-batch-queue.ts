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
  resetDinIngestBatchQueueForTests as resetPendingForTests,
  takeBatch,
  type OfferDinIngestResult,
  type QueuedIngest,
} from "@/lib/din-ingest-pending";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";
import { runExclusivePerUser } from "@/lib/per-user-mutex";

const DRAIN_MUTEX_MS = 60_000;
/**
 * 꺼낸 후원은 정산표나 관리자 매칭 대기열에 들어가기 전까지 버리지 않는다.
 * 대기열 ID 기억만 남고 줄이 사라지면 허브 보조 수집이 같은 후원을 영영 무시한다.
 * 저장본에 계속 안 보이면 이 횟수 뒤 관리자 매칭 대기열로 넘긴다.
 */
const MAX_LAND_ATTEMPTS = 4;
/** 저장 실패·예외 뒤 바로 다시 돌면 같은 실패를 연타하므로 잠시 쉰다. */
const DRAIN_RETRY_DELAY_MS = 2_000;

const drainRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function resetDinIngestBatchQueueForTests(): void {
  for (const timer of drainRetryTimers.values()) clearTimeout(timer);
  drainRetryTimers.clear();
  resetPendingForTests();
}

export type EnqueueDinIngestResult = OfferDinIngestResult;

/** 대기 상한 없이 받는다. 같은 ID는 한 줄만 남긴다. 저장은 drain 이 200건씩 이어서 한다. */
export function offerDinExcelIngest(
  hubUserId: string,
  event: DonationEvent
): EnqueueDinIngestResult {
  const stateUserId = resolveScopedOverlayUserId(hubUserId, "finalent") || hubUserId;
  return offerPendingIngest(hubUserId, stateUserId, event);
}

export async function enqueueDinExcelIngest(
  hubUserId: string,
  event: DonationEvent
): Promise<EnqueueDinIngestResult> {
  const result = offerDinExcelIngest(hubUserId, event);
  if (!result.duplicateQueued) {
    /** ingest ACK 전에 drain 을 기다려 브라우저 종료 시 후원 손실을 방지 */
    await drainDinIngestQueue(resolveScopedOverlayUserId(hubUserId, "finalent") || hubUserId);
  }
  return result;
}

type FlushOutcome = { committed: boolean; retry: QueuedIngest[] };

function rowKey(row: QueuedIngest): string {
  return String(row.event.id || "").trim();
}

/** 관리자 매칭 대기열에 넣었거나 이미 있으면 true. 저장소 오류면 false. */
async function handOverToAdminQueue(stateUserId: string, event: DonationEvent): Promise<boolean> {
  return enqueueDonationEvent(stateUserId, event, { notify: false }).then(
    () => true,
    () => false
  );
}

/** 저장본에 안 보인 줄: 횟수 안이면 재시도, 넘으면 관리자 대기열. 대기열 쓰기도 실패하면 계속 재시도. */
async function retryOrHandOverMissing(
  stateUserId: string,
  rows: QueuedIngest[]
): Promise<QueuedIngest[]> {
  const retry: QueuedIngest[] = [];
  for (const row of rows) {
    const attempts = (row.attempts || 0) + 1;
    if (attempts < MAX_LAND_ATTEMPTS) {
      retry.push({ ...row, attempts });
      continue;
    }
    const queued = await handOverToAdminQueue(stateUserId, row.event);
    console.error(
      "[din-ingest-batch-queue] donor missing after persist",
      row.event.id,
      row.event.amount,
      row.event.donorName,
      queued ? "→ 관리자 대기열" : "→ 대기열 저장 실패, 다시 시도"
    );
    if (!queued) retry.push({ ...row, attempts });
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
  if (folded.discardedReset > 0) {
    console.warn(
      "[din-ingest-batch-queue] discarded donations older than settlement reset",
      stateUserId,
      folded.discardedReset
    );
  }
  const handOverFailedKeys = new Set<string>();
  for (const event of folded.unmatched) {
    if (!(await handOverToAdminQueue(stateUserId, event))) {
      handOverFailedKeys.add(String(event.id || "").trim());
    }
  }
  const handOverFailed = rows.filter((row) => handOverFailedKeys.has(rowKey(row)));

  let missing: QueuedIngest[] = [];
  if (folded.applied.length > 0) {
    const last = folded.applied[folded.applied.length - 1]!;
    const persisted = await persistDonationApplyLikeToonation(stateUserId, folded.state, last);
    if (!persisted.ok) return { committed: false, retry: rows };
    const donors = persisted.state.donors || [];
    const appliedKeys = new Set(folded.applied.map((e) => String(e.id || "").trim()));
    missing = rows.filter(
      (row) => appliedKeys.has(rowKey(row)) && !eventMatchesDonorLedger(row.event, donors)
    );
  }

  const missingRetry = await retryOrHandOverMissing(stateUserId, missing);
  const retry = [...missingRetry, ...handOverFailed];
  const retryKeys = new Set(retry.map(rowKey));
  forgetQueuedIds(
    stateUserId,
    rows.filter((row) => !retryKeys.has(rowKey(row)))
  );
  if (retry.length === 0) return { committed: true, retry: [] };
  return { committed: false, retry };
}

function scheduleDrainRetry(uid: string): void {
  if (drainRetryTimers.has(uid)) return;
  const timer = setTimeout(() => {
    drainRetryTimers.delete(uid);
    void drainDinIngestQueue(uid);
  }, DRAIN_RETRY_DELAY_MS);
  drainRetryTimers.set(uid, timer);
}

export async function drainDinIngestQueue(stateUserId: string): Promise<void> {
  const uid = String(stateUserId || "").trim();
  if (!uid) return;
  const store = getDinIngestStore();
  if (store.draining.has(uid)) return;
  store.draining.add(uid);
  let failed = false;
  try {
    await runExclusivePerUser(
      uid,
      async () => {
        while (true) {
          const batch = takeBatch(uid);
          if (batch.length === 0) break;
          let outcome: FlushOutcome;
          try {
            outcome = await flushBatch(uid, batch);
          } catch (err) {
            /** takeBatch 로 이미 꺼낸 줄이다. 되돌리지 않으면 ID 기억만 남고 후원이 사라진다. */
            console.error(
              "[din-ingest-batch-queue] flush failed",
              uid,
              err instanceof Error ? err.message : err
            );
            outcome = { committed: false, retry: batch };
          }
          if (!outcome.committed) {
            requeueFront(uid, outcome.retry);
            failed = true;
            break;
          }
        }
      },
      { timeoutMs: DRAIN_MUTEX_MS }
    );
  } catch (err) {
    failed = true;
    console.error("[din-ingest-batch-queue] drain failed", uid, err instanceof Error ? err.message : err);
  } finally {
    store.draining.delete(uid);
    if ((store.byUser.get(uid) || []).length > 0) {
      if (failed) scheduleDrainRetry(uid);
      else void drainDinIngestQueue(uid);
    }
  }
}
