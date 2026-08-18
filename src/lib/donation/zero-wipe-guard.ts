import type { AppState, Member } from "@/types";
import { isMemberRosterIdentityOnlyChange, mergeMemberRosterPreservingAmounts } from "@/lib/member-roster-merge";
import {
  countableDonorTotal,
  purgeDonorsForMemberRoster,
  rosterDonorMatchScore,
  syncMemberTotalsFromDonors,
} from "./apply-donation-state";

function remainingMemberIds(state: AppState): Set<string> {
  return new Set((state.members || []).map((m) => String(m.id || "")).filter(Boolean));
}

function remainingMemberCombinedTotal(
  members: AppState["members"],
  ids: Set<string>
): number {
  return (members || [])
    .filter((m) => ids.has(m.id))
    .reduce(
      (sum, m) =>
        sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)),
      0
    );
}

/**
 * 상류사회 설정만 PATCH(일시정지·좌석·FX 등) — donors/members 권위 저장이 아님.
 * 이 경우 서버가 members 금액을 donors 기준으로 재계산하면 안 된다.
 */
export function isHighSocietySettingsOnlyPatch(opts: {
  highSocietySettingsInPatch: boolean;
  donorsInPatch: boolean;
  membersAuthoritative: boolean;
  settlementReset: boolean;
  donationInitReset: boolean;
}): boolean {
  return (
    opts.highSocietySettingsInPatch &&
    !opts.donorsInPatch &&
    !opts.membersAuthoritative &&
    !opts.settlementReset &&
    !opts.donationInitReset
  );
}

/**
 * 멤버 개명 등 identity-only PATCH 에서 donorsAuthoritative 축소를 거부할지.
 * (클라이언트가 불완전 donors 를 실어 후원 전체가 지워지는 회귀 방지)
 */
export function shouldRefuseDonorShrinkOnMemberIdentityPatch(opts: {
  membersAuthoritative: boolean;
  donorsAuthoritative: boolean;
  donorsInPatch: boolean;
  settlementReset: boolean;
  donationInitReset: boolean;
  baseMembers: Member[] | undefined;
  patchMembers: Member[] | undefined;
  baseDonorCount: number;
  incomingDonorCount: number;
}): boolean {
  return (
    opts.membersAuthoritative &&
    opts.donorsAuthoritative &&
    opts.donorsInPatch &&
    !opts.settlementReset &&
    !opts.donationInitReset &&
    opts.baseDonorCount > 0 &&
    opts.incomingDonorCount < opts.baseDonorCount &&
    isMemberRosterIdentityOnlyChange(opts.baseMembers, opts.patchMembers)
  );
}

/**
 * 다건 후원을 빈 authoritative 로 덮는 저장 거부 여부.
 * 상류사회 ON/OFF·일시정지 등 설정 patch 포함 시 단건(1→0)도 차단.
 */
export function shouldRefuseMassEmptyAuthoritativeDonorWipe(opts: {
  donorsAuthoritative: boolean;
  settlementReset: boolean;
  donationInitReset: boolean;
  donorsInPatch: boolean;
  incomingDonorCount: number;
  baseDonorCount: number;
  highSocietySettingsInPatch: boolean;
}): boolean {
  return (
    opts.donorsAuthoritative &&
    !opts.settlementReset &&
    !opts.donationInitReset &&
    opts.donorsInPatch &&
    opts.incomingDonorCount === 0 &&
    opts.baseDonorCount > 0 &&
    (opts.baseDonorCount > 1 || opts.highSocietySettingsInPatch)
  );
}

/** 로스터 변경 원격이 남은 멤버 금액만 0으로 덮는지 — donors 정본은 살아 있을 때 */
export function wouldAccidentallyZeroRemainingMembers(
  local: AppState,
  remote: AppState
): boolean {
  const remoteIds = remainingMemberIds(remote);
  if (remoteIds.size === 0) return false;

  const localRemainingTotal = remainingMemberCombinedTotal(local.members, remoteIds);
  const remoteRemainingTotal = remainingMemberCombinedTotal(remote.members, remoteIds);
  if (localRemainingTotal <= 0) return false;
  if (remoteRemainingTotal >= localRemainingTotal * 0.99) return false;

  const rosterDonors = purgeDonorsForMemberRoster(remote.donors, remote.members);
  const donorSupport = rosterDonorMatchScore(remote.members, rosterDonors);
  return donorSupport >= localRemainingTotal * 0.99;
}

/**
 * donors 에 금액이 남아 있는데 남은 멤버 합계만 0(또는 급감)으로 sync 된 경우 baseline 금액을 복원.
 * 멤버 삭제·불완전 PATCH·React donors 비어 있음 등으로 엑셀표가 통째로 0 되는 회귀 방지.
 */
export function guardMemberTotalsAgainstAccidentalZeroWipe(
  state: AppState,
  baseline: AppState | null | undefined
): AppState {
  if (!baseline?.members?.length) return state;

  const ids = remainingMemberIds(state);
  if (ids.size === 0) return state;

  const baselineTotal = remainingMemberCombinedTotal(baseline.members, ids);
  const stateTotal = remainingMemberCombinedTotal(state.members, ids);
  if (baselineTotal <= 0) return state;
  if (stateTotal >= baselineTotal * 0.99) return state;

  const rosterDonors = purgeDonorsForMemberRoster(state.donors, state.members);
  const donorSupport = rosterDonorMatchScore(state.members, rosterDonors);
  if (donorSupport < baselineTotal * 0.99) return state;

  const resynced = syncMemberTotalsFromDonors({ ...state, donors: rosterDonors });
  const resyncedTotal = remainingMemberCombinedTotal(resynced.members, ids);
  if (resyncedTotal >= baselineTotal * 0.99) return resynced;

  return {
    ...state,
    donors: rosterDonors,
    members: mergeMemberRosterPreservingAmounts(baseline.members, state.members),
  };
}
