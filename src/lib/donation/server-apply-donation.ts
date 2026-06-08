import { readDonationAliases } from "@/app/api/donations/_shared/alias-store";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { applyDonationToAppState } from "./apply-donation-state";
import { enqueueDonationEvent } from "./toonation/enqueue-donation";
import type { DonationEvent } from "./types";

export type ToonationAutoApplyOutcome = "applied" | "applied_needs_review" | "not_applied";

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
  const state = await loadAppStateForUserId(userId);
  const aliases = await readDonationAliases(userId);
  const result = applyDonationToAppState(state, event, aliases);
  if (!result.ok) return "not_applied";
  await saveAppStateForRoulette(userId, result.state);
  await broadcastDonationStateUpdated(result.state.updatedAt, result.state.donorRankingsUpdatedAt);
  if (result.event.memberAutoAssigned) {
    await enqueueDonationEvent(
      userId,
      {
        ...result.event,
        id: `${result.event.id}::review`,
        status: "queued",
        alreadyApplied: true,
      },
      { notify: true }
    );
    return "applied_needs_review";
  }
  return "applied";
}
