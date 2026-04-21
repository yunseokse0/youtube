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

function normalizePosition(member: Member, memberPositions?: Record<string, string>): string {
  const mapped = memberPositions?.[member.id];
  const raw = String(mapped ?? (member as Member & { position?: string }).position ?? "").trim();
  return raw;
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
    const accountAmount = safeAmount(m.account);
    const toonAmount = safeAmount(m.toon);
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
    const others = rows
      .filter((x) => !representative || x.id !== representative.id)
      .sort((a, b) => b.totalAmount - a.totalAmount);
    const merged = representative ? [representative, ...others] : others;
    return merged
      .map((row, idx) => ({
        ...row,
        position: row.isRepresentative ? (rankLabels[idx] || "대표") : (rankLabels[idx] || ""),
        isRepresentative: row.isRepresentative,
      }));
  }

  const representative = rows.find((x) => x.isRepresentative) || null;
  const others = rows
    .filter((x) => !representative || x.id !== representative.id)
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return representative ? [representative, ...others] : others;
}
