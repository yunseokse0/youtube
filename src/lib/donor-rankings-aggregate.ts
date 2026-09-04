import {
  dedupeDonorRows,
  isDonorExcludedFromDonationTotals,
} from "@/lib/donation/apply-donation-state";
import { normalizeAnonymousDonorDisplayName } from "@/lib/donation/anonymous-donor-name";
import { resolveEffectiveDonorTarget } from "@/lib/state";

export type DonorRankingRow = {
  name: string;
  amount: number;
};

export type DonorTotalsByNameRow = {
  name: string;
  account: number;
  toon: number;
  total: number;
  count: number;
};

/** @deprecated dedupeDonorRows 사용 */
export function dedupeDonorRowsForRanking(donors: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return dedupeDonorRows(donors) as Array<Record<string, unknown>>;
}

/**
 * donor.target → 투네/계좌 분류 (절대 틀리지 않는 3계층 추론)
 *   1. donor.target === "toon" → toon
 *   2. donor.id 접두사 "toonation:" → toon, "bank:"/"account:" → account
 *   3. fallback → account
 * → target 필드 누락(undefined) 되어도 id만 보고 정확히 분류 (과거 적재 데이터·경합 상태에서 안전)
 */
export function normalizeDonorTarget(donor: Record<string, unknown>): "account" | "toon" {
  return resolveEffectiveDonorTarget(donor);
}

/** 동일 닉네임 금액 합산 후 내림차순 (Unknown·anonymous → 익명으로 합침) */
export function aggregateDonorRankingRows(rows: DonorRankingRow[]): DonorRankingRow[] {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeAnonymousDonorDisplayName(row.name);
    byName.set(key, (byName.get(key) || 0) + Math.max(0, row.amount || 0));
  }
  return Array.from(byName.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ko"));
}

export function sliceDonorRankingTop(rows: DonorRankingRow[], top: number): DonorRankingRow[] {
  const n = Math.floor(top);
  if (!Number.isFinite(n) || n <= 0) return rows;
  return rows.slice(0, Math.max(1, Math.min(50, n)));
}

/** 관리자 「후원자별 누적」·순위 오버레이 공통 — dedupe·제외·익명 통일·계좌/투네 분리 (표시용, donors 원본 불변) */
export function buildDonorTotalsByNameFromDonors(
  donors: Array<Record<string, unknown>>
): DonorTotalsByNameRow[] {
  const map = new Map<string, DonorTotalsByNameRow>();
  for (const d of dedupeDonorRows(donors)) {
    if (isDonorExcludedFromDonationTotals(d as { donationExcluded?: boolean })) continue;
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    /** 금액 0원 이하 — 실제 후원이 아닌 더미·잔여 쓰레기 row 이므로 집계에서 아예 제외 (count도 증가 X) */
    if (amount <= 0) continue;
    const name = normalizeAnonymousDonorDisplayName(String(d.name || ""));
    const prev = map.get(name) || { name, account: 0, toon: 0, total: 0, count: 0 };
    const isToon = normalizeDonorTarget(d) === "toon";
    map.set(name, {
      name,
      account: prev.account + (isToon ? 0 : amount),
      toon: prev.toon + (isToon ? amount : 0),
      total: prev.total + amount,
      count: prev.count + 1,
    });
  }
  return Array.from(map.values()).sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko")
  );
}

export function buildDonorRankingsFromDonors(
  donors: Array<Record<string, unknown>>,
  top: number
): { accountTop: DonorRankingRow[]; toonTop: DonorRankingRow[]; unifiedTop: DonorRankingRow[] } {
  const accountRows: DonorRankingRow[] = [];
  const toonRows: DonorRankingRow[] = [];
  const allRows: DonorRankingRow[] = [];

  for (const d of dedupeDonorRows(donors)) {
    if (d && typeof d === "object" && (d as { donationExcluded?: boolean }).donationExcluded) continue;
    const row = {
      name: normalizeAnonymousDonorDisplayName(String(d.name || "")),
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
