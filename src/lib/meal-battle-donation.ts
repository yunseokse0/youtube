import type { MealBattleParticipant } from "@/types";

/** 후원 금액(원)을 식대전 점수 증분으로 환산: 만 원 단위 올림, 최소 1 */
export function mealBattleDonationScoreDelta(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(1, Math.round(amount / 10_000));
}

export function applyMealBattleDonationToParticipants(
  participants: MealBattleParticipant[],
  memberId: string,
  amount: number,
  direction: 1 | -1,
  donorAt?: number
): MealBattleParticipant[] {
  const delta = mealBattleDonationScoreDelta(amount) * direction;
  if (delta === 0) return participants;
  const eventAt = Number.isFinite(Number(donorAt)) ? Math.max(0, Math.floor(Number(donorAt))) : Date.now();
  return participants.map((p) =>
    p.memberId === memberId &&
    p.donationLinkActive &&
    (!p.donationLinkStartedAt || eventAt >= p.donationLinkStartedAt)
      ? { ...p, score: Math.max(0, (Number(p.score) || 0) + delta) }
      : p
  );
}
