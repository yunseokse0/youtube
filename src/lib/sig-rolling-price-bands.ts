import type { SigRollingItem } from "@/types";

/** 시그 롤링: 이 금액 이상이면 좌측(고액) 밴드 */
export const SIG_ROLLING_HIGH_PRICE_MIN = 300_000;

export type SigRollingPriceBand = "high" | "low";

export type SigRollingItemWithPrice = SigRollingItem & {
  /** 인벤 가격(원). 없으면 0 → 저액 */
  price: number;
};

export function normalizeSigRollingItemPrice(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function classifySigRollingPriceBand(
  price: number,
  highMin = SIG_ROLLING_HIGH_PRICE_MIN
): SigRollingPriceBand {
  return normalizeSigRollingItemPrice(price) >= highMin ? "high" : "low";
}

export function splitSigRollingByPriceBand(
  items: Array<SigRollingItem & { price?: number }>,
  highMin = SIG_ROLLING_HIGH_PRICE_MIN
): { high: SigRollingItemWithPrice[]; low: SigRollingItemWithPrice[] } {
  const high: SigRollingItemWithPrice[] = [];
  const low: SigRollingItemWithPrice[] = [];
  for (const item of items) {
    const price = normalizeSigRollingItemPrice(item.price);
    const row: SigRollingItemWithPrice = {
      id: item.id,
      url: item.url,
      label: item.label,
      price,
    };
    if (classifySigRollingPriceBand(price, highMin) === "high") high.push(row);
    else low.push(row);
  }
  return { high, low };
}

/** 인덱스 순환. 목록이 비면 0 유지 */
export function nextSigRollingIndex(index: number, length: number, step = 1): number {
  const n = Math.max(0, Math.floor(length));
  if (n <= 0) return 0;
  const i = Math.floor(index);
  const s = Math.max(1, Math.floor(step));
  return ((i % n) + s) % n;
}

export function pickSigRollingAt(items: SigRollingItemWithPrice[], index: number): SigRollingItemWithPrice | null {
  const n = items.length;
  if (!n) return null;
  return items[((Math.floor(index) % n) + n) % n] ?? null;
}
