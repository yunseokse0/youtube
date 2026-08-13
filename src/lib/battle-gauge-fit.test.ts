import { describe, expect, it } from "vitest";
import { battleGaugeScoreWidthCqw } from "./battle-gauge-fit";

describe("battleGaugeScoreWidthCqw", () => {
  it("shrinks for longer labels", () => {
    expect(battleGaugeScoreWidthCqw(1)).toBe(28);
    expect(battleGaugeScoreWidthCqw(7)).toBeCloseTo(15, 0);
    expect(battleGaugeScoreWidthCqw(12)).toBe(9);
  });
});
