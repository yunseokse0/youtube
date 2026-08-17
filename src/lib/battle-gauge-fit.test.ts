import { describe, expect, it } from "vitest";
import { battleGaugeScoreWidthCqw } from "./battle-gauge-fit";

describe("battleGaugeScoreWidthCqw", () => {
  it("shrinks for longer labels", () => {
    expect(battleGaugeScoreWidthCqw(1)).toBe(16);
    expect(battleGaugeScoreWidthCqw(7)).toBeCloseTo(10.29, 1);
    expect(battleGaugeScoreWidthCqw(12)).toBe(7);
  });
});
