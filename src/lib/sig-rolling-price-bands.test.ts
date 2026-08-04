import { describe, expect, it } from "vitest";
import {
  SIG_ROLLING_HIGH_PRICE_MIN,
  classifySigRollingPriceBand,
  nextSigRollingIndex,
  splitSigRollingByPriceBand,
} from "./sig-rolling-price-bands";

describe("sig-rolling-price-bands", () => {
  it("uses 300000 as default high threshold", () => {
    expect(SIG_ROLLING_HIGH_PRICE_MIN).toBe(300_000);
    expect(classifySigRollingPriceBand(299_999)).toBe("low");
    expect(classifySigRollingPriceBand(300_000)).toBe("high");
    expect(classifySigRollingPriceBand(1_000_000)).toBe("high");
  });

  it("splits rolling items into high/low bands", () => {
    const { high, low } = splitSigRollingByPriceBand([
      { id: "a", url: "/a.gif", label: "A", price: 300_000 },
      { id: "b", url: "/b.gif", label: "B", price: 50_000 },
      { id: "c", url: "/c.gif", label: "C", price: 999_999 },
      { id: "d", url: "/d.gif", label: "D", price: 0 },
    ]);
    expect(high.map((x) => x.id)).toEqual(["a", "c"]);
    expect(low.map((x) => x.id)).toEqual(["b", "d"]);
  });

  it("advances rolling index circularly", () => {
    expect(nextSigRollingIndex(0, 3)).toBe(1);
    expect(nextSigRollingIndex(2, 3)).toBe(0);
    expect(nextSigRollingIndex(0, 0)).toBe(0);
  });
});
