import type { AppState } from "@/types";
import { mergeMemberRosterPreservingAmounts } from "@/lib/member-roster-merge";
import {
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
