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

/**
 * 식사 대전 게이지만 0으로 돌린다.
 * 연동 중인 참가자는 이 시각 이후 후원만 다시 집계한다. 후원 목록·멤버 정산은 건드리지 않는다.
 */
export function resetMealBattleDonationUi(
  mealBattle: MealBattleState | undefined,
  resetAt = Date.now()
): MealBattleState {
  const at = Math.max(0, Math.floor(Number(resetAt) || Date.now()));
  const base = (mealBattle || {}) as MealBattleState;
  return {
    ...base,
    participants: (base.participants || []).map((p) => ({
      ...p,
      score: 0,
      ...(p.donationLinkActive ? { donationLinkStartedAt: at } : {}),
    })),
  };
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

/** datetime-local 입력(로컬 시각) → epoch ms */
export function parseMealBattleFromAtInput(raw: string, fallback = Date.now()): number {
  const t = Date.parse(String(raw || "").trim());
  return Number.isFinite(t) && t > 0 ? t : fallback;
}

/** epoch ms → datetime-local 값 */
export function formatMealBattleFromAtInput(ms: number): string {
  const n = Math.max(0, Math.floor(Number(ms) || 0));
  const d = new Date(n > 0 ? n : Date.now());
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * 고른 멤버의 대전 UI에, 이 시각 이후 후원만 다시 넣는다.
 * 정산표 후원 목록은 건드리지 않는다. 연동이 꺼져 있던 멤버는 켠다.
 */
export function applyMealBattleDonationsFromTime(
  mealBattle: MealBattleState | undefined,
  donors: AppState["donors"],
  opts: { fromAt: number; memberIds: string[] }
): MealBattleState {
  const fromAt = Math.max(0, Math.floor(Number(opts.fromAt) || 0));
  const want = new Set((opts.memberIds || []).map((id) => String(id || "").trim()).filter(Boolean));
  const base = (mealBattle || {}) as MealBattleState;
  const participants = (base.participants || []).map((p) =>
    want.has(p.memberId)
      ? { ...p, donationLinkActive: true, donationLinkStartedAt: fromAt }
      : p
  );
  const next: MealBattleState = { ...base, participants };
  return {
    ...next,
    participants: recalculateMealParticipantScoresFromDonors(next, donors),
  };
}
