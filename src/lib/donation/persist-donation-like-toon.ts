import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { getServerMemoryAppState } from "@/lib/server-memory-app-state";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import { mergeStatePreservingDonorsUntilSettlementReset } from "@/lib/donation/merge-donation-apply-base";
import { isDuplicateDonationEvent } from "@/lib/donation/apply-donation-state";
import type { DonationEvent } from "@/lib/donation/types";
import type { AppState } from "@/types";

export type DonationAppliedSseHint = {
  donorName: string;
  amount: number;
  target: "account" | "toon";
  memberName?: string;
};

async function broadcastDonationStateUpdated(
  updatedAt: number,
  donorRankingsUpdatedAt?: number,
  donationApplied?: DonationAppliedSseHint
): Promise<void> {
  await publishSseEvent({
    type: "state_updated" as const,
    updatedAt,
    ...(typeof donorRankingsUpdatedAt === "number" && donorRankingsUpdatedAt > 0
      ? { donorRankingsUpdatedAt }
      : {}),
    ...(donationApplied ? { donationApplied } : {}),
  });
}

/**
 * 투네 서버 반영과 동일한 저장 파이프라인.
 * - Redis·메모리와 donors union (정산 리셋 전)
 * - saveAppStateForRoulette 로 즉시 기록
 * - SSE donationApplied 로 엑셀·관리자 동기화
 */
export async function persistDonationApplyLikeToonation(
  userId: string,
  appliedState: AppState,
  event: DonationEvent
): Promise<{ ok: true; state: AppState } | { ok: false }> {
  const concurrent = await loadAppStateForUserId(userId);
  const toPersist = mergeStatePreservingDonorsUntilSettlementReset(appliedState, concurrent);
  await saveAppStateForRoulette(userId, toPersist);

  const memSaved = getServerMemoryAppState(userId);
  const verify = await loadAppStateForUserId(userId);
  const persisted =
    isDuplicateDonationEvent(verify, event) ||
    (memSaved ? isDuplicateDonationEvent(memSaved, event) : false);
  if (!persisted) return { ok: false };

  const member = (toPersist.members || []).find((m) => m.id === event.memberId);
  await broadcastDonationStateUpdated(toPersist.updatedAt, toPersist.donorRankingsUpdatedAt, {
    donorName: event.donorName,
    amount: event.amount,
    target: event.target === "account" ? "account" : "toon",
    memberName: member?.name || undefined,
  });
  return { ok: true, state: toPersist };
}
