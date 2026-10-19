import type { SigItem } from "@/types";
import { ONE_SHOT_SIG_ID, sigMatchesMemberFilter } from "@/lib/sig-roulette";
import type { ManualSigRandomPoolItem } from "@/lib/manual-sig-random";

import { SIG_SALES_TRACK_INVENTORY_STOCK } from "@/lib/sig-sales-stock";

/** `/uploads/sigs/<otherUser>/` 경로면 타 계정 업로드로 보고 제외 */
export function isForeignUserSigUpload(imageUrl: string, userId?: string | null): boolean {
  const uid = String(userId || "").trim();
  if (!uid) return false;
  const url = String(imageUrl || "").trim();
  const m = url.match(/\/uploads\/sigs\/([^/?#]+)\//i);
  if (!m?.[1]) return false;
  let owner = m[1];
  try {
    owner = decodeURIComponent(owner);
  } catch {
    /* keep raw */
  }
  return owner !== uid;
}

/** 한방 시그 제외 — 판매 중 시그 목록(재고·완판 무시, 제외·멤버 필터만) */
export function listActiveManualSigPool(
  inventory: SigItem[] | undefined,
  opts?: {
    memberFilterId?: string;
    sigSalesExcludedIds?: string[];
    ignoreStock?: boolean;
    /** 있으면 다른 계정 `/uploads/sigs/<uid>/` 시그 제외 */
    ownerUserId?: string | null;
  }
): ManualSigRandomPoolItem[] {
  const excluded = new Set((opts?.sigSalesExcludedIds || []).map((x) => String(x).trim()));
  const out: ManualSigRandomPoolItem[] = [];
  for (const row of inventory || []) {
    if (row.id === ONE_SHOT_SIG_ID) continue;
    if (excluded.has(row.id)) continue;
    if (isForeignUserSigUpload(String(row.imageUrl || ""), opts?.ownerUserId)) continue;
    if (!SIG_SALES_TRACK_INVENTORY_STOCK) {
      /* 재고 개념 없음 — isActive·soldCount 필터 생략 */
    } else {
      const ignoreStock = opts?.ignoreStock === true;
      if (!ignoreStock && !row?.isActive) continue;
      if (!ignoreStock) {
        const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
        const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
        if (soldCount >= maxCount) continue;
      }
    }
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
