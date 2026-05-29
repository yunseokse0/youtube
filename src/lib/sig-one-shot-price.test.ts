import { describe, expect, it } from "vitest";
import { computeNetOneShotPrice, resolveOneShotDisplayPrice } from "./sig-one-shot-price";

describe("computeNetOneShotPrice", () => {
  const items = [
    { id: "a", price: 100_000 },
    { id: "b", price: 200_000 },
    { id: "c", price: 300_000 },
  ];

  it("returns full total when nothing sold", () => {
    expect(computeNetOneShotPrice(items, new Set())).toBe(600_000);
  });

  it("deducts sold item prices", () => {
    expect(computeNetOneShotPrice(items, new Set(["b"]))).toBe(400_000);
  });
});

describe("resolveOneShotDisplayPrice", () => {
  const selected = [
    { id: "a", price: 1_000_000 },
    { id: "b", price: 333_333 },
  ];

  it("uses net when manual input empty", () => {
    const r = resolveOneShotDisplayPrice({ selected, soldIdSet: new Set(["a"]) });
    expect(r?.price).toBe(333_333);
  });

  it("deducts sold sum from manual base", () => {
    const r = resolveOneShotDisplayPrice({
      selected,
      soldIdSet: new Set(["a"]),
      manualPriceInput: "2000000",
    });
    expect(r?.price).toBe(1_000_000);
  });
});
