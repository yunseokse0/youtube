import type { AppState, Donor, Member } from "@/types";
import {
  hasMeaningfulMemberRoster,
  isDefaultPlaceholderMemberList,
  normalizeDonorsArray,
  totalCombined,
} from "@/lib/state";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { mergeDonationApplyBase } from "@/lib/donation/merge-donation-apply-base";

const STORAGE_KEY_BASE = "excel-broadcast-donation-roster-v1";

export function donationRosterBackupKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

export type DonationRosterBackupPayload = {
  members: Member[];
  donors: Donor[];
  memberPositions?: AppState["memberPositions"];
  settlementResetAt?: number;
  savedAt: number;
  total: number;
  donorsCount: number;
};

export function normalizeDonationRosterBackupPayload(
  raw: DonationRosterBackupPayload | null | undefined
): DonationRosterBackupPayload | null {
  if (!raw || typeof raw !== "object") return null;
  const donors = normalizeDonorsArray(raw.donors);
  const total = Math.max(0, Number(raw.total) || 0);
  if (donors.length === 0 && total <= 0) return null;
  return {
    ...raw,
    donors,
    members: Array.isArray(raw.members) ? raw.members : [],
    donorsCount: donors.length,
    total: total || totalCombined({ members: raw.members || [], donors } as AppState),
    savedAt: Number(raw.savedAt) || 0,
  };
}

export function buildDonationRosterBackupPayload(state: AppState): DonationRosterBackupPayload | null {
  const donors = normalizeDonorsArray(state.donors);
  const total = totalCombined(state);
  if (donors.length === 0 && total <= 0) return null;
  return {
    members: Array.isArray(state.members) ? state.members : [],
    donors,
    memberPositions: state.memberPositions,
    settlementResetAt: state.settlementResetAt,
    savedAt: Date.now(),
    total,
    donorsCount: donors.length,
  };
}

/** 메인 상태가 비거나 줄었을 때 백업에서 후원·금액을 되살릴지 */
export function shouldRestoreDonationRosterFromBackup(
  current: Pick<AppState, "members" | "donors" | "settlementResetAt"> | null | undefined,
  backup: DonationRosterBackupPayload | null | undefined
): boolean {
  if (!backup) return false;
  if (backup.donorsCount <= 0 && backup.total <= 0) return false;
  const curDonors = normalizeDonorsArray(current?.donors);
  const curTotal = current ? totalCombined(current as AppState) : 0;
  const curReset = Number(current?.settlementResetAt || 0);
  const backupReset = Number(backup.settlementResetAt || 0);
  const placeholderMembers = isDefaultPlaceholderMemberList(current?.members);
  if (placeholderMembers && curDonors.length === 0 && backup.donorsCount > 0) {
    return true;
  }
  if (placeholderMembers && curTotal === 0 && backup.total > 0) {
    return true;
  }
  if (curReset > backupReset) {
    return false;
  }
  if (curDonors.length === 0 && backup.donorsCount > 0) {
    if (curTotal > 0) return true;
    if (!placeholderMembers && hasMeaningfulMemberRoster({ members: current?.members || [] } as AppState)) {
      return false;
    }
    return true;
  }
  if (curTotal === 0 && backup.total > 0) {
    if (!placeholderMembers && hasMeaningfulMemberRoster({ members: current?.members || [] } as AppState)) {
      return false;
    }
    return true;
  }
  return false;
}

export function applyDonationRosterBackupToState(
  state: AppState,
  backup: DonationRosterBackupPayload,
  opts?: { ignoreSettlementResetFilter?: boolean }
): AppState {
  const curDonors = normalizeDonorsArray(state.donors);
  const curTotal = totalCombined(state);
  const donorsLostWithMemberTotals =
    curDonors.length === 0 && curTotal > 0 && hasMeaningfulMemberRoster(state);
  const placeholderWipe =
    isDefaultPlaceholderMemberList(state.members) &&
    curDonors.length === 0 &&
    curTotal === 0;
  const resetAt = placeholderWipe
    ? Number(backup.settlementResetAt || 0)
    : Number(state.settlementResetAt || backup.settlementResetAt || 0);
  const rawDonors = normalizeDonorsArray(backup.donors);
  const donors =
    !opts?.ignoreSettlementResetFilter && resetAt > 0
      ? rawDonors.filter((d) => (d.at || 0) >= resetAt - 3000)
      : rawDonors;
  const merged: AppState = {
    ...state,
    members:
      donorsLostWithMemberTotals || backup.members.length === 0
        ? state.members
        : backup.members,
    donors,
    memberPositions: backup.memberPositions ?? state.memberPositions,
    settlementResetAt: placeholderWipe
      ? backup.settlementResetAt
      : state.settlementResetAt ?? backup.settlementResetAt,
    updatedAt: Math.max(Number(state.updatedAt || 0), Number(backup.savedAt || 0), Date.now()),
  };
  return syncMemberTotalsFromDonors(merged);
}

export function enrichAppStateWithDonationRosterBackupPayload(
  state: AppState,
  backup: DonationRosterBackupPayload | null | undefined
): { state: AppState; restoredFromBackup: boolean } {
  const normalized = normalizeDonationRosterBackupPayload(backup ?? null);
  if (normalized && shouldRestoreDonationRosterFromBackup(state, normalized)) {
    return {
      state: applyDonationRosterBackupToState(state, normalized),
      restoredFromBackup: true,
    };
  }
  return { state, restoredFromBackup: false };
}

/**
 * 투네·apply 저장 직전 — 메인 donors 가 비었거나 백업보다 적을 때 id union.
 * (UI·메모리만 0인데 백업에 4건 → 1건만 저장되어 서버가 초기화되던 회귀 방지)
 */
export function unionAppStateDonorsFromBackupIfRicher(
  state: AppState,
  backup: DonationRosterBackupPayload | null | undefined
): AppState {
  const normalized = normalizeDonationRosterBackupPayload(backup ?? null);
  if (!normalized) return state;
  const curDonors = normalizeDonorsArray(state.donors);
  if (normalized.donorsCount <= curDonors.length) return state;
  const curReset = Number(state.settlementResetAt || 0);
  const backupReset = Number(normalized.settlementResetAt || 0);
  if (curReset > backupReset) return state;
  if (
    curDonors.length > 0 &&
    hasMeaningfulMemberRoster(state) &&
    !shouldRestoreDonationRosterFromBackup(state, normalized)
  ) {
    return state;
  }
  const withBackup = applyDonationRosterBackupToState(
    { ...state, members: state.members },
    normalized
  );
  return mergeDonationApplyBase(state, withBackup) ?? state;
}
