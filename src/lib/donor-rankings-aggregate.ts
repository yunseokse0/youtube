import { normalizeDonationEventId } from "@/lib/donation/apply-donation-state";

export type DonorRankingRow = {
  name: string;
  amount: number;
};

/** 순위 집계 전 — 동일 투네 후원 id(검토 큐 `::review` 등) 중복 행 1건만 남김 */
export function dedupeDonorRowsForRanking(donors: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const d of donors) {
    const rawId = String(d.id || "").trim();
    const baseId = normalizeDonationEventId(rawId);
    const toonationMatch = /^toonation:(.+)$/i.exec(baseId);
    const key = toonationMatch?.[1]
      ? `toonation:${toonationMatch[1].toLowerCase()}`
      : baseId
        ? `id:${baseId}`
        : `fallback:${String(d.name || "").trim()}|${Number(d.at || 0)}|${Math.floor(Number(d.amount || 0))}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, d);
      continue;
    }
    const prevAt = Number(prev.at || 0);
    const nextAt = Number(d.at || 0);
    if (nextAt >= prevAt) map.set(key, d);
  }
  return Array.from(map.values());
}

export function normalizeDonorTarget(donor: Record<string, unknown>): "account" | "toon" {
  const rawType = String(donor.type || "").trim();
  if (rawType === "계좌") return "account";
  if (rawType === "투네이션") return "toon";
  const rawTarget = String(donor.target || "").trim().toLowerCase();
  return rawTarget === "toon" ? "toon" : "account";
}

/** 동일 닉네임 금액 합산 후 내림차순 */
export function aggregateDonorRankingRows(rows: DonorRankingRow[]): DonorRankingRow[] {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const key = row.name.trim() || "무명";
    byName.set(key, (byName.get(key) || 0) + Math.max(0, row.amount || 0));
  }
  return Array.from(byName.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function sliceDonorRankingTop(rows: DonorRankingRow[], top: number): DonorRankingRow[] {
  const n = Math.floor(top);
  if (!Number.isFinite(n) || n <= 0) return rows;
  return rows.slice(0, Math.max(1, Math.min(50, n)));
}

export function buildDonorRankingsFromDonors(
  donors: Array<Record<string, unknown>>,
  top: number
): { accountTop: DonorRankingRow[]; toonTop: DonorRankingRow[]; unifiedTop: DonorRankingRow[] } {
  const accountRows: DonorRankingRow[] = [];
  const toonRows: DonorRankingRow[] = [];
  const allRows: DonorRankingRow[] = [];

  for (const d of dedupeDonorRowsForRanking(donors)) {
    const row = {
      name: String(d.name || "무명"),
      amount: Number(d.amount || 0),
    };
    allRows.push(row);
    if (normalizeDonorTarget(d) === "toon") toonRows.push(row);
    else accountRows.push(row);
  }

  return {
    accountTop: sliceDonorRankingTop(aggregateDonorRankingRows(accountRows), top),
    toonTop: sliceDonorRankingTop(aggregateDonorRankingRows(toonRows), top),
    unifiedTop: sliceDonorRankingTop(aggregateDonorRankingRows(allRows), top),
  };
}
