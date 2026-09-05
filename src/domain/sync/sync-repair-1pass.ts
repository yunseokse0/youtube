import type { AppState, Donor, Member, ContributionFormula, ContributionLog } from "@/types";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { computeContributionPoints, normalizeContributionFormula } from "@/lib/contribution-formula";
import {
  dedupeDonorRows as _dedupe,
  isDonorExcludedFromDonationTotals as _excluded,
  rosterDonorMatchScore as _roster,
} from "@/domain/dedupe/donation-dedupe.pipeline";
import { isDonorExcludedFromDonationTotals as __excluded2 } from "@/domain/dedupe/donation-dedupe.pipeline";

const dedupeDonorRows = _dedupe;
const rosterDonorMatchScore = _roster;
const isDonorExcludedFromDonationTotals = _excluded;
export { __excluded2 as _unused_excluded };

function scoreRosterAgainstMatchCounts(
  members: Member[] | null | undefined,
  matchCounts: Map<string, number>
): number {
  if (!members || !members.length) return 0;
  let score = 0;
  for (const m of members) {
    const c = matchCounts.get(String(m.id || "").trim()) || 0;
    if (c > 0) score += c;
  }
  return score;
}

export function aggregateContributionByMember(
  state: Pick<AppState, "contributionFormula">,
  dedupedDonors: Donor[]
): Map<string, { donorPoints: number; hasDonorSource: boolean }> {
  const out = new Map<string, { donorPoints: number; hasDonorSource: boolean }>();
  const formula = normalizeContributionFormula(
    (state as { contributionFormula?: unknown }).contributionFormula
  );
  for (const donor of dedupedDonors) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    const mid = String(donor.memberId || "").trim();
    if (!mid) continue;
    let bucket = out.get(mid);
    if (!bucket) {
      bucket = { donorPoints: 0, hasDonorSource: false };
      out.set(mid, bucket);
    }
    bucket.hasDonorSource = true;
    const stored = Number(donor.contributionPoints);
    if (Number.isFinite(stored) && stored >= 0) {
      bucket.donorPoints += Math.round(stored);
    } else {
      bucket.donorPoints += computeContributionPoints(
        donor.amount,
        donor.target || "account",
        formula
      );
    }
  }
  return out;
}

export function mergeContributionFormulaIntoState(
  state: AppState,
  event?: Pick<DonationEventLike, "contributionFormula"> | null,
  hubFormula?: ContributionFormula | null
): AppState {
  const fromEvent = (event as { contributionFormula?: unknown })?.contributionFormula
    ? normalizeContributionFormula(
        (event as { contributionFormula?: unknown }).contributionFormula
      )
    : null;
  const fromHub = hubFormula ? normalizeContributionFormula(hubFormula) : null;
  const nextFormula = fromEvent ?? fromHub;
  if (!nextFormula) return state;
  return { ...state, contributionFormula: nextFormula };
}

type DonationEventLike = {
  contributionFormula?: unknown;
  contributionPoints?: unknown;
};

export function aggregateContribLogsByMember(
  logs: ContributionLog[] | null | undefined
): Map<string, { deltaSum: number; hasLogSource: boolean }> {
  const out = new Map<string, { deltaSum: number; hasLogSource: boolean }>();
  if (!logs || logs.length === 0) return out;
  for (const log of logs) {
    const mid = String(log.memberId || "").trim();
    if (!mid) continue;
    const amt = Math.max(0, Math.floor(Number(log.amount) || 0));
    if (amt <= 0) continue;
    let bucket = out.get(mid);
    if (!bucket) {
      bucket = { deltaSum: 0, hasLogSource: false };
      out.set(mid, bucket);
    }
    bucket.hasLogSource = true;
    bucket.deltaSum += log.delta === -1 ? -amt : amt;
  }
  return out;
}

export function resolveApplyContributionContext(
  state: Pick<AppState, "contributionFormula">,
  event: Pick<DonationEventLike, "contributionFormula" | "contributionPoints">,
  amount: number,
  target: "account" | "toon"
): { formula: ContributionFormula; contributionPoints: number } {
  const formula = normalizeContributionFormula(
    (event.contributionFormula ?? state.contributionFormula) as unknown
  );
  const override = Math.round(Number(event.contributionPoints));
  const contributionPoints =
    Number.isFinite(override) && override >= 0
      ? override
      : computeContributionPoints(amount, target, formula);
  return { formula, contributionPoints };
}

function computeMemberTotalsAndScores(state: AppState): {
  deduped: Donor[];
  totals: Map<string, { account: number; toon: number }>;
  matchCounts: Map<string, number>;
  contribMap: Map<string, { donorPoints: number; hasDonorSource: boolean }>;
  logMap: Map<string, { deltaSum: number; hasLogSource: boolean }>;
  countable: number;
} {
  const deduped = dedupeDonorRows(state.donors || []);
  const totals = new Map<string, { account: number; toon: number }>();
  const matchCounts = new Map<string, number>();
  let countable = 0;
  for (const member of state.members || []) {
    totals.set(member.id, { account: 0, toon: 0 });
  }
  for (const donor of deduped) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    countable += 1;
    const memberId = String(donor.memberId || "").trim();
    if (memberId) {
      matchCounts.set(memberId, (matchCounts.get(memberId) || 0) + 1);
      if (totals.has(memberId)) {
        const bucket = totals.get(memberId)!;
        const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
        if ((donor.target || "account") === "toon") bucket.toon += amount;
        else bucket.account += amount;
      }
    }
  }
  const contribMap = aggregateContributionByMember(state, deduped);
  const logMap = aggregateContribLogsByMember(state.contributionLogs);
  return { deduped, totals, matchCounts, contribMap, logMap, countable };
}

function buildMembersFromTotals(
  baseState: AppState,
  members: Member[] | null | undefined,
  totals: Map<string, { account: number; toon: number }>,
  contribMap: Map<string, { donorPoints: number; hasDonorSource: boolean }>,
  logMap: Map<string, { deltaSum: number; hasLogSource: boolean }>
): Member[] {
  const positions = baseState.memberPositions || null;
  return (members || []).map((member) => {
    const bucket = totals.get(member.id) || { account: 0, toon: 0 };
    const isOperating = isOperatingSettlementMember(
      {
        id: member.id,
        name: member.name,
        operating: member.operating,
        realName: member.realName,
      },
      positions
    );
    const hasDonorSrc = contribMap.get(member.id)?.hasDonorSource === true;
    const hasLogSrc = logMap.get(member.id)?.hasLogSource === true;
    const contribution =
      isOperating || !(hasDonorSrc || hasLogSrc)
        ? Math.max(0, Number(member.contribution) || 0)
        : Math.max(
            0,
            (contribMap.get(member.id)?.donorPoints || 0) +
              (logMap.get(member.id)?.deltaSum || 0)
          );
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution,
    };
  });
}

function memberRosterIdSignature(members: Member[] | null | undefined): string {
  return (members || [])
    .map((m) => String(m.id || ""))
    .filter(Boolean)
    .sort()
    .join("\u001e");
}

const syncMemoSelf = new WeakMap<object, AppState>();

export function syncMemberTotalsFromDonors(state: AppState): AppState {
  const selfCached = syncMemoSelf.get(state);
  if (selfCached) return selfCached;

  const deduped = dedupeDonorRows(state.donors || []);
  const totals = new Map<string, { account: number; toon: number }>();
  for (const member of state.members || []) {
    totals.set(member.id, { account: 0, toon: 0 });
  }
  for (const donor of deduped) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    const memberId = String(donor.memberId || "").trim();
    if (!memberId || !totals.has(memberId)) continue;
    const bucket = totals.get(memberId)!;
    const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
    if ((donor.target || "account") === "toon") bucket.toon += amount;
    else bucket.account += amount;
  }
  const contribMap = aggregateContributionByMember(state, deduped);
  const logMap = aggregateContribLogsByMember(state.contributionLogs);
  const positions = state.memberPositions || null;
  const members = (state.members || []).map((member) => {
    const bucket = totals.get(member.id) || { account: 0, toon: 0 };
    const isOperating = isOperatingSettlementMember(
      {
        id: member.id,
        name: member.name,
        operating: member.operating,
        realName: member.realName,
      },
      positions
    );
    const hasDonorSrc = contribMap.get(member.id)?.hasDonorSource === true;
    const hasLogSrc = logMap.get(member.id)?.hasLogSource === true;
    const contribution =
      isOperating || !(hasDonorSrc || hasLogSrc)
        ? Math.max(0, Number(member.contribution) || 0)
        : Math.max(
            0,
            (contribMap.get(member.id)?.donorPoints || 0) +
              (logMap.get(member.id)?.deltaSum || 0)
          );
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution,
    };
  });
  const result = { ...state, members };
  syncMemoSelf.set(state, result);
  return result;
}

export function repairMemberTotalsForDonorRoster(
  state: AppState,
  ...fallbacks: Array<AppState | null | undefined>
): AppState {
  const donors = state.donors || [];
  const countable =
    dedupeDonorRows(donors)
      .filter((d) => !isDonorExcludedFromDonationTotals(d))
      .reduce((sum, d) => sum + Math.max(0, Math.round(Number(d.amount) || 0)), 0);
  if (countable <= 0) return state;

  const currentScore = rosterDonorMatchScore(state.members, donors);
  if (currentScore >= countable * 0.99) return state;

  const bumpedRoster = Number(state.rosterVersion || 0);
  if (bumpedRoster > 0) {
    const maxFbRoster = fallbacks.reduce(
      (m, fb) => Math.max(m, Number(fb?.rosterVersion || 0)),
      0
    );
    if (bumpedRoster > maxFbRoster) return state;
  }

  if (fallbacks.length === 0) {
    return syncMemberTotalsFromDonors(state);
  }

  const stateIdSig = memberRosterIdSignature(state.members);
  const stateUpdatedAt = Number(state.updatedAt || 0);

  let bestMembers = state.members;
  let bestScore = currentScore;
  for (const fb of fallbacks) {
    if (!fb?.members?.length) continue;
    const fbIdSig = memberRosterIdSignature(fb.members);
    if (
      stateIdSig &&
      fbIdSig &&
      stateIdSig !== fbIdSig &&
      stateUpdatedAt >= Number(fb.updatedAt || 0)
    ) {
      continue;
    }
    const score = rosterDonorMatchScore(fb.members, donors);
    if (score > bestScore) {
      bestScore = score;
      bestMembers = fb.members;
    }
  }
  if (bestScore <= 0) return state;
  if (bestMembers === state.members || bestScore === currentScore) return state;
  return syncMemberTotalsFromDonors({ ...state, members: bestMembers });
}

export function syncAndRepairMemberTotals(
  state: AppState,
  ...fallbacks: Array<AppState | null | undefined>
): AppState {
  const selfCached = syncMemoSelf.get(state);
  if (selfCached && fallbacks.length === 0) return selfCached;
  const calc = computeMemberTotalsAndScores(state);
  const { totals, matchCounts, contribMap, logMap, countable } = calc;
  if (countable <= 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    const res = { ...state, members };
    if (fallbacks.length === 0) syncMemoSelf.set(state, res);
    return res;
  }
  const currentScore = scoreRosterAgainstMatchCounts(state.members, matchCounts);
  if (currentScore >= countable * 0.99 && fallbacks.length === 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    const res = { ...state, members };
    syncMemoSelf.set(state, res);
    return res;
  }
  const bumpedRoster = Number(state.rosterVersion || 0);
  if (bumpedRoster > 0) {
    const maxFbRoster = fallbacks.reduce(
      (m, fb) => Math.max(m, Number(fb?.rosterVersion || 0)),
      0
    );
    if (bumpedRoster > maxFbRoster) {
      const members = buildMembersFromTotals(
        state,
        state.members,
        totals,
        contribMap,
        logMap
      );
      const res = { ...state, members };
      if (fallbacks.length === 0) syncMemoSelf.set(state, res);
      return res;
    }
  }
  if (fallbacks.length === 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    const res = { ...state, members };
    syncMemoSelf.set(state, res);
    return res;
  }
  const stateIdSig = memberRosterIdSignature(state.members);
  const stateUpdatedAt = Number(state.updatedAt || 0);
  let bestMembers: Member[] = state.members;
  let bestScore = currentScore;
  for (const fb of fallbacks) {
    if (!fb?.members?.length) continue;
    const fbIdSig = memberRosterIdSignature(fb.members);
    if (
      stateIdSig &&
      fbIdSig &&
      stateIdSig !== fbIdSig &&
      stateUpdatedAt >= Number(fb.updatedAt || 0)
    ) {
      continue;
    }
    const score = scoreRosterAgainstMatchCounts(fb.members, matchCounts);
    if (score > bestScore) {
      bestScore = score;
      bestMembers = fb.members;
    }
  }
  if (bestScore <= 0) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    return { ...state, members };
  }
  if (bestMembers === state.members || bestScore === currentScore) {
    const members = buildMembersFromTotals(state, state.members, totals, contribMap, logMap);
    const res = { ...state, members };
    if (fallbacks.length === 0) syncMemoSelf.set(state, res);
    return res;
  }
  const members = buildMembersFromTotals(state, bestMembers, totals, contribMap, logMap);
  return { ...state, members };
}

export function resolveMemberContributionTotal(
  memberId: string,
  state: Pick<AppState, "donors" | "contributionLogs" | "contributionFormula">
): number {
  const id = String(memberId || "").trim();
  if (!id) return 0;
  const deduped = dedupeDonorRows(state.donors || []);
  const contribMap = aggregateContributionByMember(state, deduped);
  const logMap = aggregateContribLogsByMember(state.contributionLogs);
  const donorB = contribMap.get(id);
  const logB = logMap.get(id);
  return Math.max(0, (donorB?.donorPoints || 0) + (logB?.deltaSum || 0));
}

export function purgeDonorsForMemberRoster(
  donors: Donor[] | undefined,
  members: Member[] | undefined
): Donor[] {
  const keep = new Set(
    (members || []).map((m) => String(m.id || "").trim()).filter(Boolean)
  );
  if (keep.size === 0) return [];
  return (donors || []).filter((d) => keep.has(String(d.memberId || "").trim()));
}
