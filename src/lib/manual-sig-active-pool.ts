import type { SigItem } from "@/types";
import { ONE_SHOT_SIG_ID, sigMatchesMemberFilter } from "@/lib/sig-roulette";
import type { ManualSigRandomPoolItem } from "@/lib/manual-sig-random";

/** 한방 시그 제외 · 판매 가능(활성·재고 남음) 시그만 — 수동 랜덤 풀 */
export function listActiveManualSigPool(
  inventory: SigItem[] | undefined,
  opts?: { memberFilterId?: string; sigSalesExcludedIds?: string[] }
): ManualSigRandomPoolItem[] {
  const excluded = new Set((opts?.sigSalesExcludedIds || []).map((x) => String(x).trim()));
  const out: ManualSigRandomPoolItem[] = [];
  for (const row of inventory || []) {
    if (!row?.isActive || row.id === ONE_SHOT_SIG_ID) continue;
    if (excluded.has(row.id)) continue;
    const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
    const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
    if (soldCount >= maxCount) continue;
    if (!sigMatchesMemberFilter(row, opts?.memberFilterId)) continue;
    const name = String(row.name || "").trim();
    const price = Math.max(0, Math.floor(Number(row.price || 0)));
    if (!name || price <= 0) continue;
    out.push({
      id: row.id,
      name,
      price,
      imageUrl: String(row.imageUrl || "").trim(),
    });
  }
  return out;
}
