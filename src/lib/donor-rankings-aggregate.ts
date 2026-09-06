import {
  dedupeDonorRows,
  isDonorExcludedFromDonationTotals,
} from "@/lib/donation/apply-donation-state";
import { normalizeAnonymousDonorDisplayName } from "@/lib/donation/anonymous-donor-name";
import { normalizeComparableName } from "@/lib/donation/name-similarity";
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

/** 🏷️ 후원자 이름 통합 매칭 (동일인 분리 집계 방지용 key)
 *  - 익명 통일 → normalizeComparableName(공백/특문/대소문자/호칭 제거)
 *  - 최종 결과 표시는 가장 긴 display name (가장 상세한 이름) 을 대표로 선택하여 UX 보존 */
function resolveUnifiedDonorNameKey(name: string): { normalizedKey: string; displayName: string } {
  const displayName = normalizeAnonymousDonorDisplayName(name);
  const norm = normalizeComparableName(displayName);
  const normalizedKey = norm || displayName;
  return { normalizedKey, displayName };
}

/** 동일 닉네임 금액 합산 후 내림차순 (Unknown·anonymous → 익명으로 합침 + 공백/특문차이 동일인 통합) */
export function aggregateDonorRankingRows(rows: DonorRankingRow[]): DonorRankingRow[] {
  const byName = new Map<string, { amount: number; bestDisplayName: string }>();
  for (const row of rows) {
    const { normalizedKey, displayName } = resolveUnifiedDonorNameKey(row.name);
    const amt = Math.max(0, row.amount || 0);
    const prev = byName.get(normalizedKey);
    if (!prev) {
      byName.set(normalizedKey, { amount: amt, bestDisplayName: displayName });
      continue;
    }
    prev.amount += amt;
    if (displayName.length > prev.bestDisplayName.length) prev.bestDisplayName = displayName;
  }
  return Array.from(byName.entries())
    .map(([, v]) => ({ name: v.bestDisplayName, amount: v.amount }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ko"));
}

export function sliceDonorRankingTop(rows: DonorRankingRow[], top: number): DonorRankingRow[] {
  const n = Math.floor(top);
  if (!Number.isFinite(n) || n <= 0) return rows;
  return rows.slice(0, Math.max(1, Math.min(50, n)));
}

/** 관리자 「후원자별 누적」·순위 오버레이 공통 — dedupe·제외·익명 통일·계좌/투네 분리 (표시용, donors 원본 불변)
 *  ✅ 2026-09-06 Fix: 이름 normalize를 normalizeComparableName 기반으로 강화 →
 *  「지훈」 / 「지 훈」 / 「지훈_」 / 「지훈님」 등 공백/특문/호칭 차이를 동일인으로 통합 집계하여
 *  동일 후원 100원이 다른 name bucket으로 빠져서 누락되는 버그 해소. */
export function buildDonorTotalsByNameFromDonors(
  donors: Array<Record<string, unknown>>
): DonorTotalsByNameRow[] {
  const map = new Map<string, { row: DonorTotalsByNameRow; bestDisplayName: string }>();
  for (const d of dedupeDonorRows(donors)) {
    if (isDonorExcludedFromDonationTotals(d as { donationExcluded?: boolean })) continue;
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    /** 금액 0원 이하 — 실제 후원이 아닌 더미·잔여 쓰레기 row 이므로 집계에서 아예 제외 (count도 증가 X) */
    if (amount <= 0) continue;
    const { normalizedKey, displayName } = resolveUnifiedDonorNameKey(String(d.name || ""));
    const prev = map.get(normalizedKey);
    const isToon = normalizeDonorTarget(d) === "toon";
    if (!prev) {
      map.set(normalizedKey, {
        row: {
          name: displayName,
          account: isToon ? 0 : amount,
          toon: isToon ? amount : 0,
          total: amount,
          count: 1,
        },
        bestDisplayName: displayName,
      });
      continue;
    }
    prev.row.account += isToon ? 0 : amount;
    prev.row.toon += isToon ? amount : 0;
    prev.row.total += amount;
    prev.row.count += 1;
    if (displayName.length > prev.bestDisplayName.length) {
      prev.bestDisplayName = displayName;
      prev.row.name = displayName;
    }
  }
  return Array.from(map.values())
    .map((v) => v.row)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, "ko"));
}

export function buildDonorRankingsFromDonors(
  donors: Array<Record<string, unknown>>,
  top: number
): { accountTop: DonorRankingRow[]; toonTop: DonorRankingRow[]; unifiedTop: DonorRankingRow[] } {
  const accountRows: DonorRankingRow[] = [];
  const toonRows: DonorRankingRow[] = [];
  const allRows: DonorRankingRow[] = [];

  for (const d of dedupeDonorRows(donors)) {
    if (isDonorExcludedFromDonationTotals(d as { donationExcluded?: boolean })) continue;
    const amt = Math.max(0, Number(d.amount || 0));
    if (amt <= 0) continue;
    const row = {
      name: String(d.name || ""),
      amount: amt,
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
