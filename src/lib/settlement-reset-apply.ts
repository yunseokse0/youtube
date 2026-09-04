import { resetOverlayPresetsGoalForDonationInit } from "@/lib/goal-preset-math";
import { withIntentionalDonationClear } from "@/lib/intentional-donation-clear";
import { pickSettingsPreservedAcrossSettlementReset } from "@/lib/settlement-reset-preserve";
import { buildDefaultMembersCount, defaultState } from "@/lib/state";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import type { AppState, Member } from "@/types";

/** 정산 리셋 시 시그·식사 대전 런타임 점수·타이머 초기화 (풀·참가자 설정은 유지) */
function buildSettlementResetBattleRuntime(
  state: AppState,
  resetAt: number
): Pick<AppState, "sigMatch" | "mealMatch" | "sigMatchSettings"> {
  const resetAtMs = Math.floor(resetAt);
  const sigSettings = state.sigMatchSettings;
  const nextSigDonationLinks: Record<string, { active: boolean; startedAt?: number }> = {};
  for (const [memberId, link] of Object.entries(sigSettings?.donationLinks || {})) {
    if (!link || typeof link !== "object") continue;
    nextSigDonationLinks[memberId] = link.active
      ? { active: true, startedAt: resetAtMs }
      : { active: false, ...(link.startedAt != null ? { startedAt: link.startedAt } : {}) };
  }
  return {
    sigMatch: {},
    mealMatch: {},
    sigMatchSettings: {
      ...sigSettings,
      donationLinks: nextSigDonationLinks,
      overlayTimerEndAt: null,
    },
  };
}

export type SettlementResetMode = "keep" | "init";

export type ApplySettlementResetOptions = {
  mode: SettlementResetMode;
  /** mode=init 일 때 슬롯 수 (1~30) */
  memberSlotCount?: number;
  resetAt?: number;
};

/**
 * 정산 리셋 스냅샷 생성 — 서버·클라이언트 공통.
 * donors 비움 + settlementResetAt 상승 + intentionalDonationClearAt 설정.
 */
export function applySettlementResetToState(
  state: AppState,
  opts: ApplySettlementResetOptions
): AppState {
  const resetAt = Number(opts.resetAt || 0) || Date.now();
  const resetPresets = resetOverlayPresetsGoalForDonationInit(state.overlayPresets);
  const preserved = pickSettingsPreservedAcrossSettlementReset(state);
  const battleRuntime = buildSettlementResetBattleRuntime(state, resetAt);

  if (opts.mode === "keep") {
    const next: AppState = {
      ...state,
      ...preserved,
      ...battleRuntime,
      members: (state.members || []).map((m: Member) => ({
        ...m,
        account: 0,
        toon: 0,
        contribution: 0,
        restroom: 0,
      })),
      donors: [],
      contributionLogs: [],
      restroomLogs: [],
      territoryLogs: [],
      mealBattle: {
        ...state.mealBattle,
        participants: (state.mealBattle?.participants || []).map((p) => ({ ...p, score: 0 })),
      },
      overlayPresets: resetPresets as AppState["overlayPresets"],
      missions: preserved.missions || state.missions || [],
      settlementResetAt: resetAt,
      intentionalDonationClearAt: resetAt,
      updatedAt: resetAt,
      donorRankingsUpdatedAt: resetAt,
    };
    return syncMemberTotalsFromDonors(withIntentionalDonationClear(next, resetAt));
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
    ...battleRuntime,
    members: nextMembers,
    memberPositions: {},
    donors: [],
    overlayPresets: resetPresets as AppState["overlayPresets"],
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
    settlementResetAt: resetAt,
    intentionalDonationClearAt: resetAt,
    updatedAt: resetAt,
    donorRankingsUpdatedAt: resetAt,
  };
  return syncMemberTotalsFromDonors(withIntentionalDonationClear(next, resetAt));
}
