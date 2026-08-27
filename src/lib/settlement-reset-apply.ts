import { resetOverlayPresetsGoalForDonationInit } from "@/lib/goal-preset-math";
import { pickSettingsPreservedAcrossSettlementReset } from "@/lib/settlement-reset-preserve";
import { buildDefaultMembersCount, defaultState } from "@/lib/state";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import type { AppState, Member } from "@/types";

export type SettlementResetMode = "keep" | "init";

export type ApplySettlementResetOptions = {
  mode: SettlementResetMode;
  /** mode=init 일 때 슬롯 수 (1~30) */
  memberSlotCount?: number;
  resetAt?: number;
};

/**
 * 정산 리셋 스냅샷 생성 — 서버·클라이언트 공통.
 * donors 비움 + settlementResetAt 상승 + 금액 0.
 */
export function applySettlementResetToState(
  state: AppState,
  opts: ApplySettlementResetOptions
): AppState {
  const resetAt = Number(opts.resetAt || 0) || Date.now();
  const resetPresets = resetOverlayPresetsGoalForDonationInit(state.overlayPresets);
  const preserved = pickSettingsPreservedAcrossSettlementReset(state);

  if (opts.mode === "keep") {
    const next: AppState = {
      ...state,
      ...preserved,
      members: (state.members || []).map((m: Member) => ({
        ...m,
        account: 0,
        toon: 0,
        contribution: 0,
        restroom: 0,
      })),
      donors: [],
      mealBattle: {
        ...state.mealBattle,
        participants: (state.mealBattle?.participants || []).map((p) => ({ ...p, score: 0 })),
      },
      overlayPresets: resetPresets as AppState["overlayPresets"],
      missions: preserved.missions || state.missions || [],
      settlementResetAt: resetAt,
      updatedAt: resetAt,
      donorRankingsUpdatedAt: resetAt,
    };
    return syncMemberTotalsFromDonors(next);
  }

  const slotN = Math.max(1, Math.min(30, Math.floor(Number(opts.memberSlotCount) || 3)));
  const ds = defaultState();
  const nextMembers = buildDefaultMembersCount(slotN);
  const nextMemberIds = new Set(nextMembers.map((m) => m.id));
  const filteredMealParticipants = (state.mealBattle?.participants || [])
    .filter((p) => nextMemberIds.has(p.memberId))
    .map((p) => ({ ...p, score: 0 }));

  const next: AppState = {
    ...ds,
    ...preserved,
    members: nextMembers,
    memberPositions: {},
    donors: [],
    overlayPresets: resetPresets as AppState["overlayPresets"],
    sigMatch: Object.fromEntries(
      Object.entries(state.sigMatch || {}).filter(([memberId]) => nextMemberIds.has(memberId))
    ),
    mealBattle: {
      ...state.mealBattle,
      participants: filteredMealParticipants,
      memberGaugeColors: Object.fromEntries(
        Object.entries(state.mealBattle?.memberGaugeColors || {}).filter(([memberId]) =>
          nextMemberIds.has(memberId)
        )
      ),
      teamAMemberIds: (state.mealBattle?.teamAMemberIds || []).filter((memberId) =>
        nextMemberIds.has(memberId)
      ),
      teamBMemberIds: (state.mealBattle?.teamBMemberIds || []).filter((memberId) =>
        nextMemberIds.has(memberId)
      ),
    },
    mealMatch: Object.fromEntries(
      Object.entries(state.mealMatch || {}).filter(([memberId]) => nextMemberIds.has(memberId))
    ),
    settlementResetAt: resetAt,
    updatedAt: resetAt,
    donorRankingsUpdatedAt: resetAt,
  };
  return syncMemberTotalsFromDonors(next);
}
