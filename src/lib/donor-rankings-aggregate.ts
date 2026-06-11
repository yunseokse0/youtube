import { dedupeDonorRows } from "@/lib/donation/apply-donation-state";

export type DonorRankingRow = {
  name: string;
  amount: number;
};

/** @deprecated dedupeDonorRows 사용 */
export function dedupeDonorRowsForRanking(donors: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return dedupeDonorRows(donors) as Array<Record<string, unknown>>;
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

  for (const d of dedupeDonorRows(donors)) {
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
