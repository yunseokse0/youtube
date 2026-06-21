import { readDonationAliases } from "@/app/api/donations/_shared/alias-store";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { broadcastPlayerDonationAlert, enrichDonationEventWithSigMatch } from "./player-donation-alert";
import { applyDonationToAppState, normalizeDonationEventId } from "./apply-donation-state";
import { enqueueDonationEvent } from "./toonation/enqueue-donation";
import type { DonationEvent } from "./types";

export type ToonationAutoApplyOutcome = "applied" | "applied_needs_review" | "not_applied";

const inFlightApplyKeys = new Set<string>();

function donationApplyLockKey(userId: string, event: DonationEvent): string {
  const eventId = String(event.id || "").trim();
  if (eventId) return `${userId}:${eventId}`;
  const ext = String(event.externalId || "").trim();
  const base = normalizeDonationEventId(ext);
  return `${userId}:${event.provider || "toonation"}:${ext || base}`;
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
  const lockKey = donationApplyLockKey(userId, event);
  if (inFlightApplyKeys.has(lockKey)) return "applied";
  inFlightApplyKeys.add(lockKey);
  try {
    const state = await loadAppStateForUserId(userId);
    const aliases = await readDonationAliases(userId);
    const result = applyDonationToAppState(state, event, aliases);
    if (!result.ok) {
      if (result.reason === "duplicate") return "applied";
      return "not_applied";
    }
    await saveAppStateForRoulette(userId, result.state);
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
