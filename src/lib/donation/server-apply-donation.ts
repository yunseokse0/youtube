import { readDonationAliases } from "@/app/api/donations/_shared/alias-store";
import {
  releaseDonationApplyClaim,
  tryClaimDonationApply,
} from "@/app/api/donations/_shared/applied-store";
import { readDonationQueue } from "@/app/api/donations/_shared/queue-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";
import { broadcastPlayerDonationAlert, enrichDonationEventWithSigMatch } from "./player-donation-alert";
import {
  applyDonationToAppState,
  isDuplicateDonationEvent,
  mergeContributionFormulaIntoState,
} from "./apply-donation-state";
import { enrichAppStateWithDonationRosterBackupFromKv, loadDonationRosterBackupFromKv } from "@/lib/donation-roster-backup-redis";
import { unionAppStateDonorsFromBackupIfRicher } from "@/lib/donation-roster-backup-core";
import { persistDonationApplyLikeToonation } from "@/lib/donation/persist-donation-like-toon";
import { fetchToonaHubContributionFormula } from "@/lib/toona-hub-client";
import { donationApplyInFlightKey } from "./donation-dedupe-keys";
import { enqueueDonationEvent, purgeDonationQueueForEvent } from "./toonation/enqueue-donation";
import { readToonationListenerConfig } from "./toonation/listener-config-store";
import { resolveToonationDonationWithOwnerRemap } from "./toonation/owner-donation-remap";
import type { DonationEvent } from "./types";

export type ToonationAutoApplyOutcome = "applied" | "applied_needs_review" | "not_applied";

const inFlightApplyKeys = new Set<string>();

/**
 * ✅ v17.5 이중 경로 중복봉쇄:
 *  · 세션 userId(din) → stateUserId(finalent) 로 내부에서 자동 scoping
 *  → loadAppStateForUserId / persistDonationApplyLikeToonation / queue / listener / alias / broadcast
 *    전부 자동으로 finalent 기준으로 작동 → 2경로 같은 후원 1건만 저장!
 */
function scopedStateUserIdOf(userId: string): string {
  return resolveScopedOverlayUserId(userId, "finalent");
}

function inFlightKey(userId: string, event: DonationEvent): string {
  return donationApplyInFlightKey(userId, event);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 동시 WS·큐 처리 중 선점 실패 시 실제 반영 여부 확인 후 큐로 넘김(누락 방지) */
async function resolveAlreadyAppliedOrDefer(
  userId: string,
  event: DonationEvent
): Promise<ToonationAutoApplyOutcome | "retry"> {
  const uid = scopedStateUserIdOf(userId);
  const state = await loadAppStateForUserId(uid);
  if (!state) return "not_applied";
  if (isDuplicateDonationEvent(state, event)) return "applied";
  return "retry";
}

/** 큐에 쌓인 후원을 서버에서 즉시 재시도(관리자 탭 없이 엑셀 반영) */
export async function drainDonationQueueOnServer(userId: string): Promise<number> {
  const uid = scopedStateUserIdOf(userId);
  const list = await readDonationQueue(uid);
  if (list.length === 0) return 0;
  let applied = 0;
  for (const evt of list) {
    const outcome = await tryAutoApplyToonationDonationOnServer(userId, evt);
    if (outcome === "applied" || outcome === "applied_needs_review") {
      applied += 1;
    }
  }
  return applied;
}

/** 투네 WS 수신 시 서버에서 즉시 엑셀표 반영. 실패 시 큐 등록용 */
export async function tryAutoApplyToonationDonationOnServer(
  userId: string,
  rawEvent: DonationEvent
): Promise<ToonationAutoApplyOutcome> {
  const uid = scopedStateUserIdOf(userId);
  const lockKey = inFlightKey(uid, rawEvent);
  if (inFlightApplyKeys.has(lockKey)) {
    for (let i = 0; i < 24; i += 1) {
      await sleep(50);
      if (!inFlightApplyKeys.has(lockKey)) break;
    }
    const deferred = await resolveAlreadyAppliedOrDefer(userId, rawEvent);
    if (deferred !== "retry") return deferred;
    return "not_applied";
  }
  inFlightApplyKeys.add(lockKey);
  try {
    const listenerCfg = await readToonationListenerConfig(uid);
    const event = await resolveToonationDonationWithOwnerRemap(
      uid,
      rawEvent,
      listenerCfg?.ownerName
    );
    const state = await loadAppStateForUserId(uid);
    if (!state) return "not_applied";
    if (isDuplicateDonationEvent(state, event)) return "applied";
    if (!(await tryClaimDonationApply(uid, event))) {
      const deferred = await resolveAlreadyAppliedOrDefer(userId, event);
      if (deferred !== "retry") return deferred;
      await sleep(80);
      if (!(await tryClaimDonationApply(uid, event))) {
        const again = await resolveAlreadyAppliedOrDefer(userId, event);
        if (again !== "retry") return again;
        return "not_applied";
      }
    }

    const freshState = await loadAppStateForUserId(uid);
    if (!freshState) {
      await releaseDonationApplyClaim(uid, event);
      return "not_applied";
    }
    if (isDuplicateDonationEvent(freshState, event)) return "applied";

    const { state: enrichedState } = await enrichAppStateWithDonationRosterBackupFromKv(
      uid,
      freshState
    );
    const backup = await loadDonationRosterBackupFromKv(uid);
    const unionState = unionAppStateDonorsFromBackupIfRicher(enrichedState, backup);
    const hubFormula = await fetchToonaHubContributionFormula(uid);
    const stateForApply = mergeContributionFormulaIntoState(unionState, event, hubFormula);
    const aliases = await readDonationAliases(uid);
    const result = applyDonationToAppState(stateForApply, event, aliases);
    if (!result.ok) {
      if (result.reason === "duplicate") return "applied";
      if (result.reason === "paused") {
        await releaseDonationApplyClaim(uid, event);
        return "not_applied";
      }
      await releaseDonationApplyClaim(uid, event);
      return "not_applied";
    }
    const persisted = await persistDonationApplyLikeToonation(uid, result.state, result.event);
    if (!persisted.ok) {
      await releaseDonationApplyClaim(uid, event);
      return "not_applied";
    }
    await purgeDonationQueueForEvent(uid, event);
    const isAggregatedBucket =
      typeof event.aggregatedCount === "number" && event.aggregatedCount > 1;
    if (!isAggregatedBucket) {
      const enriched = await enrichDonationEventWithSigMatch(uid, result.event);
      await broadcastPlayerDonationAlert(uid, enriched);
    }
    return result.event.memberAutoAssigned ? "applied_needs_review" : "applied";
  } finally {
    inFlightApplyKeys.delete(lockKey);
  }
}

/** 멤버 미매칭 등 서버 자동 반영 실패 시 — 큐 등록 후 서버에서 즉시 재시도 */
export async function enqueueUnmatchedToonationDonation(
  userId: string,
  event: DonationEvent
): Promise<boolean> {
  const uid = scopedStateUserIdOf(userId);
  const added = await enqueueDonationEvent(uid, event);
  await drainDonationQueueOnServer(userId);
  return added;
}
