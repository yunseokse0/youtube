import type { Member } from "@/types";

export type MemberRankingRow = {
  id: string;
  name: string;
  position: string;
  accountAmount: number;
  toonAmount: number;
  totalAmount: number;
  /** 세션 누적 기여도 — 엑셀표 순위 기준 */
  contributionAmount: number;
  isRepresentative: boolean;
};

export type MemberContributionGetter = (member: Member) => number;

export type MemberPositionMode = "fixed" | "rankLinked";

/** 엑셀표·순위 연동 정렬 기준 */
export type MemberRankingMetric = "contribution" | "donation";

export function normalizeMemberRankingMetric(input: unknown): MemberRankingMetric {
  return input === "donation" ? "donation" : "contribution";
}

function safeAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function floorToHundreds(value: number): number {
  return Math.floor(Math.max(0, value) / 100) * 100;
}

function normalizePosition(member: Member, memberPositions?: Record<string, string>): string {
  const mapped = memberPositions?.[member.id];
  const raw = String(mapped ?? (member as Member & { position?: string }).position ?? "").trim();
  return raw;
}

function isOperatingMember(member: Member, memberPositions?: Record<string, string>): boolean {
  if (Boolean(member.operating)) return true;
  if (/운영비/i.test(String(member.name || ""))) return true;
  if (/운영비/i.test(String(member.realName || ""))) return true;
  if (/운영비/i.test(normalizePosition(member, memberPositions))) return true;
  return false;
}

function isRepresentativeMember(member: Member, memberPositions?: Record<string, string>): boolean {
  return normalizePosition(member, memberPositions) === "대표";
}

/** `state.members` 배열 순서 = 멤버 생성순 */
export function buildMemberCreationOrderIndex(members: Member[]): Map<string, number> {
  const map = new Map<string, number>();
  (members || []).forEach((m, idx) => map.set(m.id, idx));
  return map;
}

/** 후원 분배·금액 참고 — 100원 단위 버림 후 account+toon 합 */
export function memberDonationRankingTotal(member: Member): number {
  return floorToHundreds(safeAmount(member.account)) + floorToHundreds(safeAmount(member.toon));
}

/** 엑셀표 순위 — 세션 누적 기여도 (getter 없으면 member.contribution) */
export function memberContributionRankingTotal(
  member: Member,
  getContribution?: MemberContributionGetter
): number {
  if (getContribution) {
    return Math.max(0, Math.floor(Number(getContribution(member)) || 0));
  }
  const raw = (member as Member & { contribution?: unknown }).contribution;
  return safeAmount(raw);
}

/** 후원 총액 내림차순 → 동점 시 멤버 생성순 (분배·레거시용) */
export function compareMembersByDonationTotal(
  a: Member,
  b: Member,
  orderIndex?: Map<string, number>
): number {
  const ta = memberDonationRankingTotal(a);
  const tb = memberDonationRankingTotal(b);
  if (tb !== ta) return tb - ta;
  if (orderIndex) {
    const ia = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const ib = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
  }
  return String(a.id || "").localeCompare(String(b.id || ""));
}

/**
 * 엑셀표·순위 연동: 누적 기여도 내림차순 → 동점이면 금액 합 → 생성순
 */
export function compareMembersByContribution(
  a: Member,
  b: Member,
  orderIndex?: Map<string, number>,
  getContribution?: MemberContributionGetter
): number {
  const ca = memberContributionRankingTotal(a, getContribution);
  const cb = memberContributionRankingTotal(b, getContribution);
  if (cb !== ca) return cb - ca;
  const ta = memberDonationRankingTotal(a);
  const tb = memberDonationRankingTotal(b);
  if (tb !== ta) return tb - ta;
  if (orderIndex) {
    const ia = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const ib = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
  }
  return String(a.id || "").localeCompare(String(b.id || ""));
}

function compareRankingRowsByMetricDesc(
  a: MemberRankingRow,
  b: MemberRankingRow,
  orderIndex: Map<string, number>,
  metric: MemberRankingMetric
): number {
  if (metric === "donation") {
    if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
  } else {
    if (b.contributionAmount !== a.contributionAmount) {
      return b.contributionAmount - a.contributionAmount;
    }
    if (b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;
  }
  const ia = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
  const ib = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
  if (ia !== ib) return ia - ib;
  return String(a.id).localeCompare(String(b.id));
}

export function compareMembersByRankingMetric(
  a: Member,
  b: Member,
  metric: MemberRankingMetric,
  orderIndex?: Map<string, number>,
  getContribution?: MemberContributionGetter
): number {
  if (metric === "donation") {
    return compareMembersByDonationTotal(a, b, orderIndex);
  }
  return compareMembersByContribution(a, b, orderIndex, getContribution);
}

export type OverlayRankedMember = { m: Member; rank: number | null };

/** 엑셀표·후원순위: 이 인원 초과(6명~)부터 좌우 스플릿 */
export const OVERLAY_HALF_SPLIT_MIN_COUNT = 5;

/** 스플릿 시 좌·우 각 열 고정 슬롯(1–5 / 6–10) */
export const OVERLAY_EXCEL_COLUMN_SLOTS = 5;

/** 5명 이하: 단일 열. 6명 이상: 왼쪽 5칸 + 오른쪽 5칸(최대 10명) */
export function splitOverlayListAtHalf<T>(
  items: readonly T[],
  minCount = OVERLAY_HALF_SPLIT_MIN_COUNT
): { left: T[]; right: T[]; split: boolean } {
  const list = Array.from(items);
  if (list.length <= minCount) {
    return { left: list, right: [], split: false };
  }
  const slots = OVERLAY_EXCEL_COLUMN_SLOTS;
  return {
    left: list.slice(0, slots),
    right: list.slice(slots, slots * 2),
    split: true,
  };
}

/**
 * 관리자 미리보기에서는 좌우 분할을 끈다.
 * 가운데 크롭 시 왼쪽 패널「순위」가 잘리고 오른쪽 패널「순위」만 보여
 * 순위 열이 표 맨 오른쪽으로 오해되는 것을 막는다.
 */
export function shouldEnableOverlayExcelSplit(
  split: boolean,
  opts?: { adminPreview?: boolean; previewGuide?: boolean }
): boolean {
  if (!split) return false;
  if (opts?.adminPreview || opts?.previewGuide) return false;
  return true;
}

/** 엑셀표 오버레이: 대표 최상단 고정 → metric 순위 → 운영비(핀)는 호출측에서 하단 */
export function buildOverlayRankedMembers(
  unpinnedMembers: Member[],
  memberPositions?: Record<string, string>,
  getMemberRole?: (m: Member) => string,
  allMembersForOrder?: Member[],
  getContribution?: MemberContributionGetter,
  rankingMetric: MemberRankingMetric = "contribution"
): OverlayRankedMember[] {
  const metric = normalizeMemberRankingMetric(rankingMetric);
  const orderIndex = buildMemberCreationOrderIndex(allMembersForOrder ?? unpinnedMembers);
  const roleOf = getMemberRole ?? ((m: Member) => normalizePosition(m, memberPositions));
  const isRep = (m: Member) =>
    isRepresentativeMember(m, memberPositions) || roleOf(m).trim().includes("대표");
  const representative = unpinnedMembers.find(isRep) || null;
  const rankable = unpinnedMembers.filter((m) => !isRep(m));
  const sorted = [...rankable].sort((a, b) =>
    compareMembersByRankingMetric(a, b, metric, orderIndex, getContribution)
  );
  let nextRank = 1;
  const others = sorted.map((m) => ({ m, rank: nextRank++ }));
  if (representative) return [{ m: representative, rank: null }, ...others];
  return others;
}

/**
 * 순위 연동 직급을 멤버별 고정 맵으로 스냅샷.
 * 오버레이 `resolvedMemberRoles`와 동일: 대표 고정 → metric 순위 → rankPositionLabels.
 */
export function buildRankLinkedMemberPositions(
  members: Member[],
  memberPositions?: Record<string, string>,
  rankPositionLabels?: string[],
  options?: {
    rankingMetric?: MemberRankingMetric;
    getContribution?: MemberContributionGetter;
  }
): Record<string, string> {
  const metric = normalizeMemberRankingMetric(options?.rankingMetric);
  const labels = Array.isArray(rankPositionLabels) ? rankPositionLabels : [];
  const roleMap: Record<string, string> = {};
  const list = members || [];
  const orderIndex = buildMemberCreationOrderIndex(list);
  const representative =
    list.find((m) => String(memberPositions?.[m.id] || "").trim() === "대표") || null;
  const others = list
    .filter((m) => !representative || m.id !== representative.id)
    .sort((a, b) =>
      compareMembersByRankingMetric(a, b, metric, orderIndex, options?.getContribution)
    );
  if (representative) roleMap[representative.id] = "대표";
  const startIdx = representative ? 1 : 0;
  others.forEach((m, idx) => {
    const rankIdx = idx + startIdx;
    const label = String(labels[rankIdx] || "").trim() || (rankIdx === 0 ? "대표" : "");
    if (label) roleMap[m.id] = label;
  });
  return roleMap;
}

/** 대표는 항상 맨 위 고정, 나머지는 metric 순 (기여도 또는 금액) */
export function sortMembersForRanking(
  members: Member[],
  memberPositions?: Record<string, string>,
  options?: {
    mode?: MemberPositionMode;
    rankPositionLabels?: string[];
    getContribution?: MemberContributionGetter;
    rankingMetric?: MemberRankingMetric;
  }
): MemberRankingRow[] {
  const mode = options?.mode || "fixed";
  const metric = normalizeMemberRankingMetric(options?.rankingMetric);
  const getContribution = options?.getContribution;
  const orderIndex = buildMemberCreationOrderIndex(members || []);
  const labelSrc = options?.rankPositionLabels || [];
  const rankLabelCount = Math.max(1, (members || []).length, labelSrc.length);
  const rankLabels = Array.from({ length: rankLabelCount }).map((_, idx) =>
    String(labelSrc[idx] || "").trim()
  );
  const rows: MemberRankingRow[] = (members || []).map((m) => {
    const accountAmount = floorToHundreds(safeAmount(m.account));
    const toonAmount = floorToHundreds(safeAmount(m.toon));
    const basePosition = normalizePosition(m, memberPositions);
    const position = mode === "rankLinked" ? basePosition : basePosition;
    return {
      id: m.id,
      name: m.name || "이름 없음",
      position,
      accountAmount,
      toonAmount,
      totalAmount: accountAmount + toonAmount,
      contributionAmount: memberContributionRankingTotal(m, getContribution),
      isRepresentative: position === "대표",
    };
  });

  const sortRows = (list: MemberRankingRow[]) =>
    [...list].sort((a, b) => compareRankingRowsByMetricDesc(a, b, orderIndex, metric));

  if (mode === "rankLinked") {
    const representative = rows.find((x) => x.isRepresentative) || null;
    const operating = rows.filter((row) => {
      const member = (members || []).find((m) => m.id === row.id);
      return member ? isOperatingMember(member, memberPositions) : false;
    });
    const operatingIds = new Set(operating.map((x) => x.id));
    const others = sortRows(
      rows.filter((x) => (!representative || x.id !== representative.id) && !operatingIds.has(x.id))
    );
    const merged = [...(representative ? [representative] : []), ...others, ...operating];
    return merged.map((row, idx) => ({
      ...row,
      position: row.isRepresentative ? "대표" : rankLabels[idx] || (idx === 0 ? "대표" : ""),
      isRepresentative: row.isRepresentative || idx === 0,
    }));
  }

  const representative = rows.find((x) => x.isRepresentative) || null;
  const operating = rows.filter((row) => {
    const member = (members || []).find((m) => m.id === row.id);
    return member ? isOperatingMember(member, memberPositions) : false;
  });
  const operatingIds = new Set(operating.map((x) => x.id));
  const others = sortRows(
    rows.filter((x) => (!representative || x.id !== representative.id) && !operatingIds.has(x.id))
  );

  const ordered = [...(representative ? [representative] : []), ...others, ...operating];
  return ordered;
}
