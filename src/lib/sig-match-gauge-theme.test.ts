import { describe, expect, it } from "vitest";
import {
  clampSigMatchGaugeDisplayPct,
  DEFAULT_SIG_MATCH_GAUGE_THEME,
  parseSigMatchGaugeThemeId,
} from "@/lib/sig-match-gauge-theme";

describe("sig-match-gauge-theme", () => {
  it("parses known themes and falls back to default", () => {
    expect(parseSigMatchGaugeThemeId("cyberpunk")).toBe("cyberpunk");
    expect(parseSigMatchGaugeThemeId("GOLD-LUXURY")).toBe("gold-luxury");
    expect(parseSigMatchGaugeThemeId("nope")).toBe(DEFAULT_SIG_MATCH_GAUGE_THEME);
  });

  it("clamps display pct to 15~85 while summing to 100", () => {
    expect(clampSigMatchGaugeDisplayPct(5)).toEqual({ leftPct: 15, rightPct: 85 });
    expect(clampSigMatchGaugeDisplayPct(95)).toEqual({ leftPct: 85, rightPct: 15 });
    const mid = clampSigMatchGaugeDisplayPct(60);
    expect(mid.leftPct + mid.rightPct).toBeCloseTo(100, 5);
    expect(mid.leftPct).toBeGreaterThanOrEqual(15);
    expect(mid.leftPct).toBeLessThanOrEqual(85);
  });
});
