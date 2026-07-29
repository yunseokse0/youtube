import type { Member } from "@/types";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { buildMemberCreationOrderIndex } from "@/lib/utils";

export type BattleDonationRankingRow = {
  memberId: string;
  name: string;
  category: string;
  account: number;
  toon: number;
  contribution: number;
  total: number;
};

export function formatBattleDonationAmount(n: number): string {
  return Math.max(0, Math.round(n)).toLocaleString("ko-KR");
}

export function buildBattleDonationRows(
  members: Member[],
  memberPositions?: Record<string, string> | null,
  opts?: { memberIds?: string[]; limit?: number }
): BattleDonationRankingRow[] {
  const allow = opts?.memberIds?.length
    ? new Set(opts.memberIds.filter(Boolean))
    : null;
  const orderIndex = buildMemberCreationOrderIndex(members || []);
  const rows = (members || [])
    .filter((m) => {
      if (allow && !allow.has(m.id)) return false;
      return !isOperatingSettlementMember(m, memberPositions);
    })
    .map((m) => {
      const account = Math.max(0, Math.round(m.account || 0));
      const toon = Math.max(0, Math.round(m.toon || 0));
      const contribution = Math.max(0, Math.round(m.contribution || 0));
      const pos = String(memberPositions?.[m.id] || "").trim();
      const category = pos ? (pos.startsWith("[") ? pos : `[${pos}]`) : "";
      return {
        memberId: m.id,
        name: m.name || m.id,
        category,
        account,
        toon,
        contribution: contribution > 0 ? contribution : account + toon,
        total: account + toon,
      };
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.contribution !== a.contribution) return b.contribution - a.contribution;
      const ia = orderIndex.get(a.memberId) ?? Number.MAX_SAFE_INTEGER;
      const ib = orderIndex.get(b.memberId) ?? Number.MAX_SAFE_INTEGER;
      return ia - ib;
    });

  const limit = opts?.limit;
  if (limit != null && limit > 0) return rows.slice(0, limit);
  return rows;
}

export function battleDonationRankingTotals(rows: BattleDonationRankingRow[]) {
  return rows.reduce(
    (acc, r) => ({
      account: acc.account + r.account,
      toon: acc.toon + r.toon,
      total: acc.total + r.total,
      contribution: acc.contribution + r.contribution,
    }),
    { account: 0, toon: 0, total: 0, contribution: 0 }
  );
}

/** 1·2·3위 및 이하 행 배경 (방송 엑셀표 스타일) */
export function battleRankRowBg(rankIndex: number): string {
  if (rankIndex === 0) return "rgba(254, 240, 138, 0.92)";
  if (rankIndex === 1) return "rgba(254, 215, 170, 0.88)";
  if (rankIndex === 2) return "rgba(187, 247, 208, 0.88)";
  return rankIndex % 2 === 0 ? "rgba(233, 213, 255, 0.55)" : "rgba(243, 244, 246, 0.72)";
}
