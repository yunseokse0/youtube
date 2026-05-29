import type { MealBattleParticipant, MealBattleState, Member } from "@/types";

/** 후원 금액(원)을 식대전 점수 증분으로 환산: 만 원 단위 올림, 최소 1 */
export function mealBattleDonationScoreDelta(amount: number): number {
  if (amount <= 0) return 0;
  return Math.max(1, Math.round(amount / 10_000));
}

/** 후원 연동 ON 시 참가자 행이 없으면 추가(게이지·점수 반영 대상) */
export function ensureMealBattleParticipantRow(
  mealBattle: MealBattleState | undefined,
  member: Pick<Member, "id" | "name">,
  colorPalette: string[]
): MealBattleParticipant[] {
  const existing = mealBattle?.participants || [];
  if (existing.some((p) => p.memberId === member.id)) return existing;
  const totalGoal = Math.max(1, Math.floor(mealBattle?.totalGoal || 100));
  const color =
    mealBattle?.memberGaugeColors?.[member.id] ||
    colorPalette[existing.length % Math.max(1, colorPalette.length)] ||
    "#60a5fa";
  return [
    ...existing,
    {
      memberId: member.id,
      name: member.name,
      score: 0,
      goal: totalGoal,
      color,
      donationLinkActive: false,
      donationLinkStartedAt: undefined,
    },
  ];
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
