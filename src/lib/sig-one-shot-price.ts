import { canonicalSigIdFromWheelSliceId, ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";

/** 당첨 시그 합계에서 판매 완료된 시그 금액을 차감한 한방 시그 가격 */
export function computeNetOneShotPrice(
  items: Array<{ id: string; price: number }>,
  soldIdSet: ReadonlySet<string>
): number {
  const total = items.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0);
  const deducted = items.reduce((sum, item) => {
    const canon = canonicalSigIdFromWheelSliceId(String(item.id || ""));
    if (!soldIdSet.has(item.id) && !soldIdSet.has(canon)) return sum;
    return sum + Math.max(0, Math.floor(Number(item.price || 0)));
  }, 0);
  return Math.max(0, total - deducted);
}

export function buildOneShotFromSelected(
  selected: Array<{ id: string; name: string; price: number }>
): { id: string; name: string; price: number } | null {
  if (selected.length < 2) return null;
  return {
    id: ONE_SHOT_SIG_ID,
    name: "한방 시그",
    price: selected.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0),
  };
}

function selectedGrossTotal(selected: Array<{ price: number }>): number {
  return selected.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0);
}

/**
 * 한방 표시 금액 — 당첨 시그 판매 시 차감.
 * `manualPriceInput` 비어 있으면 당첨 합계 기준, 있으면 입력값을 기준(동일하게 판매분 차감).
 */
export function resolveOneShotDisplayPrice(opts: {
  selected: Array<{ id: string; price: number }>;
  soldIdSet: ReadonlySet<string>;
  manualPriceInput?: string;
  fallbackName?: string;
}): { id: string; name: string; price: number } | null {
  const { selected, soldIdSet, manualPriceInput, fallbackName } = opts;
  if (selected.length < 2) return null;
  const net = computeNetOneShotPrice(selected, soldIdSet);
  const total = selectedGrossTotal(selected);
  const soldSum = Math.max(0, total - net);
  const raw = String(manualPriceInput || "").replace(/[^\d]/g, "");
  const price = raw
    ? Math.max(0, Math.floor(Number.parseInt(raw, 10) || 0) - soldSum)
    : net;
  const base = buildOneShotFromSelected(
    selected.map((x) => ({ ...x, name: "x" }))
  );
  return {
    id: ONE_SHOT_SIG_ID,
    name: String(fallbackName || "한방 시그").trim() || "한방 시그",
    price,
  };
}
