import type { Member } from "@/types";

export type MemberRankingRow = {
  id: string;
  name: string;
  position: string;
  accountAmount: number;
  toonAmount: number;
  totalAmount: number;
  isRepresentative: boolean;
};

export type MemberPositionMode = "fixed" | "rankLinked";

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

function compareMembersByTotalDesc(a: Member, b: Member): number {
  const ta = safeAmount(a.account) + safeAmount(a.toon);
  const tb = safeAmount(b.account) + safeAmount(b.toon);
  if (tb !== ta) return tb - ta;
  const byName = String(a.name || "").localeCompare(String(b.name || ""), "ko");
  if (byName !== 0) return byName;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export type OverlayRankedMember = { m: Member; rank: number | null };

/** 엑셀표 오버레이: 대표 최상단 고정 → 운영비 제외 멤버 순위 → 운영비(핀)는 호출측에서 하단 */
export function buildOverlayRankedMembers(
  unpinnedMembers: Member[],
  memberPositions?: Record<string, string>,
  getMemberRole?: (m: Member) => string
): OverlayRankedMember[] {
  const roleOf = getMemberRole ?? ((m: Member) => normalizePosition(m, memberPositions));
  const isRep = (m: Member) =>
    isRepresentativeMember(m, memberPositions) || roleOf(m).trim().includes("대표");
  const representative = unpinnedMembers.find(isRep) || null;
  const rankable = unpinnedMembers.filter((m) => !isRep(m));
  const sorted = [...rankable].sort(compareMembersByTotalDesc);
  let nextRank = 1;
  const others = sorted.map((m) => ({ m, rank: nextRank++ }));
  if (representative) return [{ m: representative, rank: null }, ...others];
  return others;
}

/** 대표는 항상 맨 위 고정, 나머지는 총합 내림차순 */
export function sortMembersForRanking(
  members: Member[],
  memberPositions?: Record<string, string>,
  options?: { mode?: MemberPositionMode; rankPositionLabels?: string[] }
): MemberRankingRow[] {
  const mode = options?.mode || "fixed";
  const rankLabels = Array.from({ length: 12 }).map((_, idx) => String(options?.rankPositionLabels?.[idx] || "").trim());
  const rows: MemberRankingRow[] = (members || []).map((m) => {
    // 엑셀표(멤버 랭킹 표)는 100원 단위 버림 기준으로 집계한다.
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
      isRepresentative: position === "대표",
    };
  });

  if (mode === "rankLinked") {
    const representative = rows.find((x) => x.isRepresentative) || null;
    const operating = rows.filter((row) => {
      const member = (members || []).find((m) => m.id === row.id);
      return member ? isOperatingMember(member, memberPositions) : false;
    });
    const operatingIds = new Set(operating.map((x) => x.id));
    const others = rows
      .filter((x) => (!representative || x.id !== representative.id) && !operatingIds.has(x.id))
      .sort((a, b) => b.totalAmount - a.totalAmount);
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
  const others = rows
    .filter((x) => (!representative || x.id !== representative.id) && !operatingIds.has(x.id))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const ordered = [...(representative ? [representative] : []), ...others, ...operating];
  return ordered;
}
