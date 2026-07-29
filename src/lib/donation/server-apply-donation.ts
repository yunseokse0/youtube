import { readDonationAliases } from "@/app/api/donations/_shared/alias-store";
import {
  releaseDonationApplyClaim,
  tryClaimDonationApply,
} from "@/app/api/donations/_shared/applied-store";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { broadcastPlayerDonationAlert, enrichDonationEventWithSigMatch } from "./player-donation-alert";
import {
  applyDonationToAppState,
  isDuplicateDonationEvent,
} from "./apply-donation-state";
import { enqueueDonationEvent, purgeDonationQueueForEvent } from "./toonation/enqueue-donation";
import type { DonationEvent } from "./types";

export type ToonationAutoApplyOutcome = "applied" | "applied_needs_review" | "not_applied";

const inFlightApplyKeys = new Set<string>();

function inFlightKey(userId: string, event: DonationEvent): string {
  const eventId = String(event.id || "").trim();
  const ext = String(event.externalId || "").trim();
  return `${userId}:${eventId || ext}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 동시 WS·큐 처리 중 선점 실패 시 실제 반영 여부 확인 후 큐로 넘김(누락 방지) */
async function resolveAlreadyAppliedOrDefer(
  userId: string,
  event: DonationEvent
): Promise<ToonationAutoApplyOutcome | "retry"> {
  const state = await loadAppStateForUserId(userId);
  if (isDuplicateDonationEvent(state, event)) return "applied";
  return "retry";
}

async function broadcastDonationStateUpdated(updatedAt: number, donorRankingsUpdatedAt?: number): Promise<void> {
  const origin = process.env.INTERNAL_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
  await fetch(`${origin}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "state_updated",
      updatedAt,
      ...(typeof donorRankingsUpdatedAt === "number" ? { donorRankingsUpdatedAt } : {}),
    }),
  }).catch(() => {});
}

/** 투네 WS 수신 시 서버에서 즉시 엑셀표 반영. 실패 시 큐 등록용 */
export async function tryAutoApplyToonationDonationOnServer(
  userId: string,
  event: DonationEvent
): Promise<ToonationAutoApplyOutcome> {
  const lockKey = inFlightKey(userId, event);
  if (inFlightApplyKeys.has(lockKey)) {
    for (let i = 0; i < 24; i += 1) {
      await sleep(50);
      if (!inFlightApplyKeys.has(lockKey)) break;
    }
    const deferred = await resolveAlreadyAppliedOrDefer(userId, event);
    if (deferred !== "retry") return deferred;
    return "not_applied";
  }
  inFlightApplyKeys.add(lockKey);
  try {
    const state = await loadAppStateForUserId(userId);
    if (isDuplicateDonationEvent(state, event)) return "applied";
    if (!(await tryClaimDonationApply(userId, event))) {
      const deferred = await resolveAlreadyAppliedOrDefer(userId, event);
      if (deferred !== "retry") return deferred;
      await sleep(80);
      if (!(await tryClaimDonationApply(userId, event))) {
        const again = await resolveAlreadyAppliedOrDefer(userId, event);
        if (again !== "retry") return again;
        return "not_applied";
      }
    }

    const freshState = await loadAppStateForUserId(userId);
    if (isDuplicateDonationEvent(freshState, event)) return "applied";

    const aliases = await readDonationAliases(userId);
    const result = applyDonationToAppState(freshState, event, aliases);
    if (!result.ok) {
      if (result.reason === "duplicate") return "applied";
      await releaseDonationApplyClaim(userId, event);
      return "not_applied";
    }
    await saveAppStateForRoulette(userId, result.state);
    await purgeDonationQueueForEvent(userId, event);
    await broadcastDonationStateUpdated(result.state.updatedAt, result.state.donorRankingsUpdatedAt);
    const enriched = await enrichDonationEventWithSigMatch(userId, result.event);
    await broadcastPlayerDonationAlert(userId, enriched);
    return result.event.memberAutoAssigned ? "applied_needs_review" : "applied";
  } finally {
    inFlightApplyKeys.delete(lockKey);
  }
}

/** 멤버 미매칭 등 서버 자동 반영 실패 시 — 큐 등록 후 관리자/백업 자동 처리 */
export async function enqueueUnmatchedToonationDonation(
  userId: string,
  event: DonationEvent
): Promise<boolean> {
  return enqueueDonationEvent(userId, event);
}
