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
  state: Pick<AppState, "contributionFormula"> & { members?: Member[] },
  dedupedDonors: Donor[]
): Map<string, { donorPoints: number; hasDonorSource: boolean }> {
  const out = new Map<string, { donorPoints: number; hasDonorSource: boolean }>();
  const memberIdNormalizeMap = new Map<string, string>();
  for (const m of (state as { members?: Member[] }).members || []) {
    if (m.id) memberIdNormalizeMap.set(String(m.id).trim(), String(m.id).trim());
    if (m.name) memberIdNormalizeMap.set(String(m.name).trim(), String(m.id).trim());
  }
  const formula = normalizeContributionFormula(
    (state as { contributionFormula?: unknown }).contributionFormula
  );
  for (const donor of dedupedDonors) {
    if (isDonorExcludedFromDonationTotals(donor) && !donor.isZubzubBonus) continue;
    const rawMid = String(donor.memberId || "").trim();
    if (!rawMid) continue;
    const mid = memberIdNormalizeMap.get(rawMid) || rawMid;
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

export function isPongdangContributionLog(log: ContributionLog | null | undefined): boolean {
  if (!log) return false;
  if ((log as any).isPongdang === true) return true;
  if (typeof log.id === "string" && (log.id.startsWith("plog_") || log.id.startsWith("cl_pd_"))) return true;
  if (typeof log.note === "string" && log.note.includes("퐁당")) return true;
  if (typeof (log as any).reason === "string" && (log as any).reason.includes("퐁당")) return true;
  return false;
}

export function isPongdangMinusContributionLog(log: ContributionLog | null | undefined): boolean {
  if (!log) return false;
  if (log.delta !== -1) return false;
  return isPongdangContributionLog(log);
}

export function aggregateContribLogsByMember(
  logs: ContributionLog[] | null | undefined,
  opts?: { includePongdangMinus?: boolean; includePongdangLogs?: boolean; members?: Member[] }
): Map<string, { deltaSum: number; hasLogSource: boolean }> {
  const out = new Map<string, { deltaSum: number; hasLogSource: boolean }>();
  if (!logs || logs.length === 0) return out;
  const memberIdNormalizeMap = new Map<string, string>();
  for (const m of opts?.members || []) {
    if (m.id) memberIdNormalizeMap.set(String(m.id).trim(), String(m.id).trim());
    if (m.name) memberIdNormalizeMap.set(String(m.name).trim(), String(m.id).trim());
  }
  const includePongdang = Boolean(opts?.includePongdangLogs);
  for (const log of logs) {
    // 퐁당퐁당 기여도 로그는 메인 엑셀표 기여도 집계에서 완전히 제외 (별도 항목)
    if (!includePongdang && isPongdangContributionLog(log)) {
      continue;
    }
    const rawMid = String(log.memberId || "").trim();
    if (!rawMid) continue;
    const mid = memberIdNormalizeMap.get(rawMid) || rawMid;
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
  const logMap = aggregateContribLogsByMember(
    state.contributionLogs || (state as { zubzubContributionLogs?: ContributionLog[] }).zubzubContributionLogs
  );
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
    const logInfo = logMap.get(member.id);
    const contribution = isOperating
      ? Math.max(
          0,
          Math.floor(
            logInfo?.hasLogSource
              ? Math.max(Number(member.contribution) || 0, logInfo.deltaSum)
              : Number(member.contribution) || 0
          )
        )
      : Math.max(
          0,
          Math.floor(
            (contribMap.get(member.id)?.donorPoints || 0) +
              (logInfo?.deltaSum || 0)
          )
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

function migrateLegacyZubzubDonors(state: AppState): AppState {
  const legacy = (state.donors || []).filter(
    (donor) => donor.isZubzubBonus || String(donor.id || "").startsWith("zubzub_bonus_")
  );
  if (legacy.length === 0) return state;

  const logs = [
    ...(state.contributionLogs ||
      (state as { zubzubContributionLogs?: ContributionLog[] }).zubzubContributionLogs ||
      []),
  ];
  const knownIds = new Set(logs.map((log) => log.id));
  const knownQueueIds = new Set(
    logs.map((log) => String(log.zubzubQueueId || "")).filter(Boolean)
  );
  const migratedDonors = new Set<Donor>();
  for (const donor of legacy) {
    const queueId =
      String(donor.zubzubQueueId || "").trim() ||
      String(donor.id || "").replace(/^zubzub_bonus_/, "").trim();
    const id = `zubzub_bonus_${queueId || donor.id}`;
    if (knownIds.has(id) || (queueId && knownQueueIds.has(queueId))) {
      migratedDonors.add(donor);
      continue;
    }
    const amount = Math.max(
      0,
      Math.round(Number(donor.sigPrice || donor.contributionPoints || donor.amount) || 0)
    );
    if (!donor.memberId || amount <= 0) continue;
    logs.push({
      id,
      memberId: donor.memberId,
      amount,
      delta: 1,
      donorName: donor.donorName || "대표 시그 줍줍",
      note: donor.message || donor.name || "대표 시그 줍줍 보너스",
      at: Number(donor.at) || Date.now(),
      isZubzubBonus: true,
      zubzubQueueId: queueId || undefined,
      baseSigPrice: donor.sigPrice || Math.round(amount / (donor.zubzubMultiplier || 2)),
      multiplier: donor.zubzubMultiplier || 2,
      pongdangMinus: Boolean(donor.pongdangMinus),
    });
    knownIds.add(id);
    if (queueId) knownQueueIds.add(queueId);
    migratedDonors.add(donor);
  }

  if (migratedDonors.size === 0) return state;
  return {
    ...state,
    donors: (state.donors || []).filter((donor) => !migratedDonors.has(donor)),
    contributionLogs: logs,
  };
}

export function syncMemberTotalsFromDonors(state: AppState): AppState {
  const selfCached = syncMemoSelf.get(state);
  if (selfCached) return selfCached;

  const source = migrateLegacyZubzubDonors(state);
  const deduped = dedupeDonorRows(source.donors || []);
  const totals = new Map<string, { account: number; toon: number }>();
  const memberIdNormalizeMap = new Map<string, string>();
  for (const member of source.members || []) {
    totals.set(member.id, { account: 0, toon: 0 });
    if (member.id) memberIdNormalizeMap.set(String(member.id).trim(), String(member.id).trim());
    if (member.name) memberIdNormalizeMap.set(String(member.name).trim(), String(member.id).trim());
  }
  for (const donor of deduped) {
    if (isDonorExcludedFromDonationTotals(donor)) continue;
    const rawMid = String(donor.memberId || "").trim();
    if (!rawMid) continue;
    const memberId = memberIdNormalizeMap.get(rawMid) || rawMid;
    if (!totals.has(memberId)) continue;
    const bucket = totals.get(memberId)!;
    const amount = Math.max(0, Math.round(Number(donor.amount) || 0));
    if ((donor.target || "account") === "toon") bucket.toon += amount;
    else bucket.account += amount;
  }
  const contribMap = aggregateContributionByMember(source, deduped);
  const logMap = aggregateContribLogsByMember(
    source.contributionLogs || (source as { zubzubContributionLogs?: ContributionLog[] }).zubzubContributionLogs,
    { members: source.members }
  );
  const positions = source.memberPositions || null;
  const members = (source.members || []).map((member) => {
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
    const logInfo = logMap.get(member.id);
    const contribution = isOperating
      ? Math.max(
          0,
          Math.floor(
            logInfo?.hasLogSource
              ? Math.max(Number(member.contribution) || 0, logInfo.deltaSum)
              : Number(member.contribution) || 0
          )
        )
      : Math.max(
          0,
          Math.floor(
            (contribMap.get(member.id)?.donorPoints || 0) +
              (logInfo?.deltaSum || 0)
          )
        );
    return {
      ...member,
      account: bucket.account,
      toon: bucket.toon,
      contribution,
    };
  });
  const result = { ...source, members };
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
  const logMap = aggregateContribLogsByMember(
    state.contributionLogs || (state as { zubzubContributionLogs?: ContributionLog[] }).zubzubContributionLogs
  );
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
