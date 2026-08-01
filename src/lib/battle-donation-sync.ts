import type { AppState, MealBattleParticipant, MealBattleState } from "@/types";
import { dedupeDonorRows, isDonorExcludedFromDonationTotals } from "@/lib/donation/apply-donation-state";
import {
  applyMealBattleDonationToParticipants,
  mealBattleDonationScoreDelta,
  mealBattleUsesRawDonationScore,
} from "@/lib/meal-battle-donation";

function donorAtMs(donor: { at?: number | string }): number {
  const raw = donor.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** 식사 대전 — 참가자별 donors 기준 점수 재계산(연동 켤 때·대전 시작 시) */
export function recalculateMealParticipantScoresFromDonors(
  mealBattle: MealBattleState | undefined,
  donors: AppState["donors"]
): MealBattleParticipant[] {
  const participants = mealBattle?.participants || [];
  const raw = mealBattleUsesRawDonationScore(mealBattle);
  const rows = dedupeDonorRows(donors || []);
  return participants.map((p) => {
    if (!p.donationLinkActive) return p;
    const since = p.donationLinkStartedAt ?? 0;
    let score = 0;
    for (const d of rows) {
      if (isDonorExcludedFromDonationTotals(d)) continue;
      if (String(d.memberId || "") !== p.memberId) continue;
      if (since > 0 && donorAtMs(d) < since) continue;
      const amount = Math.max(0, Math.round(Number(d.amount) || 0));
      score += raw ? amount : mealBattleDonationScoreDelta(amount);
    }
    return { ...p, score: Math.max(0, score) };
  });
}

/** 참가자 후원 연동 ON + (선택) donors에서 점수 재계산 */
export function enableMealBattleDonationSync(
  state: AppState,
  opts?: { recalculateFromDonors?: boolean; startedAt?: number }
): AppState {
  const startedAt = opts?.startedAt ?? Date.now();
  const linked = (state.mealBattle?.participants || []).map((p) => ({
    ...p,
    donationLinkActive: true,
    donationLinkStartedAt: p.donationLinkStartedAt ?? startedAt,
  }));
  let mealBattle: MealBattleState = {
    ...state.mealBattle,
    participants: linked,
  };
  if (opts?.recalculateFromDonors !== false) {
    mealBattle = {
      ...mealBattle,
      participants: recalculateMealParticipantScoresFromDonors(mealBattle, state.donors),
    };
  }
  return {
    ...state,
    donationSyncMode: "mealBattle",
    mealBattle,
    updatedAt: Date.now(),
  };
}

export function activateSigMatchDonationSync(state: AppState): AppState {
  return {
    ...state,
    donationSyncMode: "sigMatch",
    sigMatchSettings: {
      ...state.sigMatchSettings,
      isActive: true,
    },
    updatedAt: Date.now(),
  };
}

export function mealBattleDonationApplyOpts(mealBattle: MealBattleState | undefined) {
  return { useRawAmount: mealBattleUsesRawDonationScore(mealBattle) };
}
