import type { Member } from "@/types";

export type MemberRankingRow = {
  id: string;
  name: string;
  position: string;
  accountAmount: number;
  toonAmount: number;
  totalAmount: number;
  /** 기여도 기준 — 회차 복원분이 있으면 함께 합산 */
  contributionAmount: number;
  isRepresentative: boolean;
};

export type MemberContributionGetter = (member: Member) => number;

export type MemberPositionMode = "fixed" | "rankLinked";

/**
 * 엑셀표·순위 연동 정렬 기준
 * - contribution: 현재 방송 기여도 (회차 복원분이 있을 때만 누적)
 * - sessionContribution: 이번 방송(세션)에서 새로 쌓인 기여도만 (저장·복원 누적값 제외)
 */
export type MemberRankingMetric = "contribution" | "sessionContribution" | "donation" | "account" | "toon";

export function normalizeMemberRankingMetric(input: unknown): MemberRankingMetric {
  if (input === "sessionContribution") return "sessionContribution";
  if (input === "donation") return "donation";
  if (input === "account") return "account";
  if (input === "toon") return "toon";
  return "contribution";
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

function safeContributionAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : 0;
  const raw = String(value ?? '').trim().replace(/[,\s，]/g, '').replace(/[−–—]/g, '-');
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
}

/** 엑셀표 순위 — 기여도 (getter 없으면 member.contribution, 음수 기여도 지원) */
export function memberContributionRankingTotal(
  member: Member,
  getContribution?: MemberContributionGetter
): number {
  if (getContribution) {
    const res = getContribution(member);
    return Number.isFinite(res) ? Math.floor(Number(res)) : 0;
  }
  const raw = (member as Member & { contribution?: unknown }).contribution;
  return safeContributionAmount(raw);
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
 * 엑셀표·순위 연동: 기여도 내림차순 → 동점이면 금액 합 → 생성순
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

/** 계좌(캐시) 후원금 내림차순 → 동점 시 투네 → 생성순 */
export function compareMembersByAccount(
  a: Member,
  b: Member,
  orderIndex?: Map<string, number>
): number {
  const aa = floorToHundreds(safeAmount(a.account));
  const ab = floorToHundreds(safeAmount(b.account));
  if (ab !== aa) return ab - aa;
  const ta = floorToHundreds(safeAmount(a.toon));
  const tb = floorToHundreds(safeAmount(b.toon));
  if (tb !== ta) return tb - ta;
  if (orderIndex) {
    const ia = orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const ib = orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
  }
  return String(a.id || "").localeCompare(String(b.id || ""));
}

/** 투네이션 후원금 내림차순 → 동점 시 계좌 → 생성순 */
export function compareMembersByToon(
  a: Member,
  b: Member,
  orderIndex?: Map<string, number>
): number {
  const ta = floorToHundreds(safeAmount(a.toon));
  const tb = floorToHundreds(safeAmount(b.toon));
  if (tb !== ta) return tb - ta;
  const aa = floorToHundreds(safeAmount(a.account));
  const ab = floorToHundreds(safeAmount(b.account));
  if (ab !== aa) return ab - aa;
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
  } else if (metric === "account") {
    if (b.accountAmount !== a.accountAmount) return b.accountAmount - a.accountAmount;
    if (b.toonAmount !== a.toonAmount) return b.toonAmount - a.toonAmount;
  } else if (metric === "toon") {
    if (b.toonAmount !== a.toonAmount) return b.toonAmount - a.toonAmount;
    if (b.accountAmount !== a.accountAmount) return b.accountAmount - a.accountAmount;
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
  if (metric === "account") {
    return compareMembersByAccount(a, b, orderIndex);
  }
  if (metric === "toon") {
    return compareMembersByToon(a, b, orderIndex);
  }
  /** contribution · sessionContribution — 모두 getContribution(누적/세션) 내림차순 비교 */
  return compareMembersByContribution(a, b, orderIndex, getContribution);
}

export type OverlayRankedMember = {
  m: Member;
  rank: number | null;
  isRepresentative?: boolean;
  isFixedPosition?: boolean;
};

/** 엑셀표·후원순위: 이 인원 초과(6명~)부터 좌우 스플릿 */
export const OVERLAY_HALF_SPLIT_MIN_COUNT = 5;

/** 스플릿 시 좌·우 각 열 고정 슬롯(1–5 / 6–10) */
export const OVERLAY_EXCEL_COLUMN_SLOTS = 5;

/** 5명 이하: 단일 열. 6명 이상: 최소 5칸 기준 균등 분할 (10명 초과 시에도 누락 없이 분할) */
export function splitOverlayListAtHalf<T>(
  items: readonly T[],
  minCount = OVERLAY_HALF_SPLIT_MIN_COUNT
): { left: T[]; right: T[]; split: boolean } {
  const list = Array.from(items);
  if (list.length <= minCount) {
    return { left: list, right: [], split: false };
  }
  const slots = Math.max(OVERLAY_EXCEL_COLUMN_SLOTS, Math.ceil(list.length / 2));
  return {
    left: list.slice(0, slots),
    right: list.slice(slots),
    split: true,
  };
}

/**
 * 관리자 미리보기에서는 좌우 분할을 끈다.
 * 가운데 크롭 시 왼쪽 패널「순위」가 잘리고 오른쪽 패널「순위」만 보여
 * 순위 열이 표 맨 오른쪽으로 오해되는 것을 막는다.
 * tableSplit 또는 excelSplit이 명시적 false이면 6명 이상이어도 단일 1열 유지 (OBS 너비 2000+ 초과 방지)
 */
export function shouldEnableOverlayExcelSplit(
  split: boolean,
  opts?: {
    adminPreview?: boolean;
    previewGuide?: boolean;
    tableSplit?: boolean;
    excelSplit?: boolean;
  }
): boolean {
  if (!split) return false;
  if (opts?.tableSplit === false || opts?.excelSplit === false) return false;
  if (opts?.tableSplit === true || opts?.excelSplit === true) return true;
  if (opts?.adminPreview || opts?.previewGuide) return false;
  return true;
}

/** 엑셀표 오버레이: 대표 최상단 고정 → 고정 직급(실장 등) 순위 제외 상단 → metric 순위 → 운영비(핀)는 호출측에서 하단 */
export function buildOverlayRankedMembers(
  unpinnedMembers: Member[],
  memberPositions?: Record<string, string>,
  getMemberRole?: (m: Member) => string,
  allMembersForOrder?: Member[],
  getContribution?: MemberContributionGetter,
  rankingMetric: MemberRankingMetric = "contribution",
  options?: {
    fixedPositionMemberIds?: string[];
    memberPositionMode?: MemberPositionMode;
  }
): OverlayRankedMember[] {
  const metric = normalizeMemberRankingMetric(rankingMetric);
  const orderIndex = buildMemberCreationOrderIndex(allMembersForOrder ?? unpinnedMembers);
  const roleOf = getMemberRole ?? ((m: Member) => normalizePosition(m, memberPositions));
  const isRep = (m: Member) => {
    const role = roleOf(m).trim();
    if (isRepresentativeMember(m, memberPositions)) return true;
    if (role.includes("부대표")) return false;
    return role.includes("대표");
  };
  const representative = unpinnedMembers.find(isRep) || null;

  const fixedIds = new Set(
    (options?.fixedPositionMemberIds || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  );

  const getFixedRolePriority = (role: string): number => {
    const r = role.trim();
    if (r.includes("부대표")) return 1;
    if (r.includes("총괄")) return 2;
    if (r.includes("실장")) return 3;
    if (r.includes("이사") || r.includes("상무") || r.includes("전무")) return 4;
    if (r.includes("본부장") || r.includes("팀장") || r.includes("매니저")) return 5;
    if (r.includes("고문")) return 6;
    return 10;
  };

  // 대표 외 고정 직급 멤버 판별 (순위 연동 제외 및 상단 배치)
  const isFixedMember = (m: Member): boolean => {
    if (representative && m.id === representative.id) return false;
    if (fixedIds.has(m.id)) return true;
    const role = roleOf(m).trim();
    if (role) {
      if (role.includes("실장")) return true;
      if (options?.memberPositionMode === "fixed" || !options?.memberPositionMode) {
        // fixed 모드이거나 옵션 미지정 시, 일부 멤버만 직급이 있고 다른 멤버는 비어있으면 고정 직급으로 취급
        const anyOtherEmpty = unpinnedMembers.some((x) => !isRep(x) && !roleOf(x).trim());
        if (anyOtherEmpty) return true;
      }
    }
    return false;
  };

  const fixedMembers = unpinnedMembers.filter(isFixedMember);
  fixedMembers.sort((a, b) => {
    const idxA = (options?.fixedPositionMemberIds || []).indexOf(a.id);
    const idxB = (options?.fixedPositionMemberIds || []).indexOf(b.id);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    const pA = getFixedRolePriority(roleOf(a));
    const pB = getFixedRolePriority(roleOf(b));
    if (pA !== pB) return pA - pB;
    return (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999);
  });

  const nonRankableIds = new Set(fixedMembers.map((m) => m.id));
  if (representative) nonRankableIds.add(representative.id);

  const rankable = unpinnedMembers.filter((m) => !nonRankableIds.has(m.id));
  const sorted = [...rankable].sort((a, b) =>
    compareMembersByRankingMetric(a, b, metric, orderIndex, getContribution)
  );

  const repRow: OverlayRankedMember[] = representative
    ? [{ m: representative, rank: null, isRepresentative: true }]
    : [];

  const fixedRows: OverlayRankedMember[] = fixedMembers.map((m) => ({
    m,
    rank: null,
    isFixedPosition: true,
  }));

  let currentRank = 1;
  const others = sorted.map((m) => ({ m, rank: currentRank++ }));
  return [...repRow, ...fixedRows, ...others];
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
    fixedPositionMemberIds?: string[];
  }
): Record<string, string> {
  const metric = normalizeMemberRankingMetric(options?.rankingMetric);
  const labels = Array.isArray(rankPositionLabels) ? rankPositionLabels : [];
  const fixedIds = new Set(
    (options?.fixedPositionMemberIds || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  );
  const roleMap: Record<string, string> = {};
  const list = members || [];
  const orderIndex = buildMemberCreationOrderIndex(list);
  const representative =
    list.find((m) => {
      const pos = String(memberPositions?.[m.id] || "").trim();
      if (pos === "대표") return true;
      if (pos.includes("부대표")) return false;
      return pos.includes("대표");
    }) || null;

  const nonDynamicIds = new Set<string>();
  if (representative) {
    nonDynamicIds.add(representative.id);
    roleMap[representative.id] = "대표";
  }

  // 대표 외 고정 직급 멤버 반영
  for (const m of list) {
    if (nonDynamicIds.has(m.id)) continue;
    const customPos = String(memberPositions?.[m.id] || "").trim();
    if (fixedIds.has(m.id) || customPos.includes("실장")) {
      if (customPos) {
        nonDynamicIds.add(m.id);
        roleMap[m.id] = customPos;
      }
    }
  }

  const others = list
    .filter((m) => !nonDynamicIds.has(m.id))
    .sort((a, b) =>
      compareMembersByRankingMetric(a, b, metric, orderIndex, options?.getContribution)
    );

  const hasLegacyRepInLabels = Boolean(
    representative &&
    labels.length > others.length &&
    (labels[0] === "대표" || labels[0] === "")
  );

  others.forEach((m, idx) => {
    const label = hasLegacyRepInLabels
      ? String(labels[idx + 1] || "").trim()
      : String(labels[idx] || "").trim();
    if (label) roleMap[m.id] = label;
  });
  return roleMap;
}

/** 대표는 항상 맨 위 고정, 고정 직급(실장 등)은 순위 제외 상단 고정, 나머지는 metric 순 (기여도 또는 금액) */
export function sortMembersForRanking(
  members: Member[],
  memberPositions?: Record<string, string>,
  options?: {
    mode?: MemberPositionMode;
    rankPositionLabels?: string[];
    getContribution?: MemberContributionGetter;
    rankingMetric?: MemberRankingMetric;
    fixedPositionMemberIds?: string[];
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

  const representative = rows.find((x) => x.isRepresentative) || null;
  const operating = rows.filter((row) => {
    const member = (members || []).find((m) => m.id === row.id);
    return member ? isOperatingMember(member, memberPositions) : false;
  });
  const operatingIds = new Set(operating.map((x) => x.id));

  const fixedIds = new Set(
    (options?.fixedPositionMemberIds || [])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  );

  const getFixedRolePriority = (role: string): number => {
    const r = role.trim();
    if (r.includes("부대표")) return 1;
    if (r.includes("총괄")) return 2;
    if (r.includes("실장")) return 3;
    if (r.includes("이사") || r.includes("상무") || r.includes("전무")) return 4;
    if (r.includes("본부장") || r.includes("팀장") || r.includes("매니저")) return 5;
    if (r.includes("고문")) return 6;
    return 10;
  };

  const isFixedRow = (row: MemberRankingRow): boolean => {
    if (representative && row.id === representative.id) return false;
    if (operatingIds.has(row.id)) return false;
    if (fixedIds.has(row.id)) return true;
    const pos = (row.position || "").trim();
    if (pos.includes("실장")) return true;
    if (mode === "fixed" && pos && rows.some((r) => !r.isRepresentative && !operatingIds.has(r.id) && !r.position)) {
      return true;
    }
    return false;
  };

  const fixedRows = rows.filter(isFixedRow);
  fixedRows.sort((a, b) => {
    const idxA = (options?.fixedPositionMemberIds || []).indexOf(a.id);
    const idxB = (options?.fixedPositionMemberIds || []).indexOf(b.id);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    const pA = getFixedRolePriority(a.position || "");
    const pB = getFixedRolePriority(b.position || "");
    if (pA !== pB) return pA - pB;
    return (orderIndex.get(a.id) ?? 999) - (orderIndex.get(b.id) ?? 999);
  });

  const nonDynamicIds = new Set(fixedRows.map((x) => x.id));
  if (representative) nonDynamicIds.add(representative.id);

  const others = sortRows(
    rows.filter((x) => !nonDynamicIds.has(x.id) && !operatingIds.has(x.id))
  );

  if (mode === "rankLinked") {
    const assignedOthers = others.map((row, idx) => ({
      ...row,
      position: rankLabels[idx] || "",
      isRepresentative: false,
    }));
    return [
      ...(representative ? [representative] : []),
      ...fixedRows,
      ...assignedOthers,
      ...operating,
    ];
  }

  return [
    ...(representative ? [representative] : []),
    ...fixedRows,
    ...others,
    ...operating,
  ];
}
