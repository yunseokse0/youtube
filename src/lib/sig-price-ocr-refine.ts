/** Tesseract가 자주 틀리는 시그 가격(근접 값이면 정답으로 보정) */
const SIG_PRICE_MISREAD_SNAP: ReadonlyArray<{ from: number; to: number; tolerance: number }> = [
  { from: 34200, to: 31200, tolerance: 500 },
  { from: 35700, to: 38700, tolerance: 3100 },
];

/** GIF에서 숫자 OCR이 거의 안 되거나 자주 틀리는 시그 — 이름 기준 보정 */
const SIG_PRICE_BY_NAME: ReadonlyArray<{
  match: (name: string) => boolean;
  price: number;
  /** OCR이 이 값이면 price로 교체 */
  replaceWhen?: ReadonlyArray<number>;
  /** OCR 실패(너무 작은 값) 시 price 사용 */
  fallbackWhenBelow?: number;
}> = [
  {
    match: (n) => n.includes("간바레") || n.includes("센빠이") || n.includes("센베이"),
    price: 31200,
    fallbackWhenBelow: 20_000,
  },
  {
    match: (n) => /^APT$/i.test(n),
    price: 38900,
    replaceWhen: [38700, 39000],
  },
];

export function refineCommonSigOcrMisreads(price: number): number {
  for (const { from, to, tolerance } of SIG_PRICE_MISREAD_SNAP) {
    if (Math.abs(price - from) <= tolerance) return to;
  }
  return price;
}

export function applySigNamePriceFallback(sigName: string | undefined, price: number | null): number | null {
  const name = String(sigName || "").trim();
  if (!name) return price;
  for (const rule of SIG_PRICE_BY_NAME) {
    if (!rule.match(name)) continue;
    if (price == null) return rule.price;
    if (rule.fallbackWhenBelow != null && price < rule.fallbackWhenBelow) return rule.price;
    if (rule.replaceWhen?.includes(price)) return rule.price;
  }
  return price;
}
