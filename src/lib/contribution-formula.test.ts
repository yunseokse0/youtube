import { describe, expect, it } from "vitest";
import {
  computeContributionPoints,
  contributionFormulaFromPreset,
  contributionFormulaPresetId,
  describeContributionFormula,
  isDefaultContributionFormula,
  normalizeContributionFormula,
} from "./contribution-formula";

describe("contribution-formula", () => {
  it("defaults to 100/100", () => {
    expect(normalizeContributionFormula(null)).toEqual({
      accountWeightPct: 100,
      toonWeightPct: 100,
    });
    expect(isDefaultContributionFormula(undefined)).toBe(true);
  });

  it("clamps weights to 0..200", () => {
    expect(
      normalizeContributionFormula({ accountWeightPct: -10, toonWeightPct: 999 })
    ).toEqual({ accountWeightPct: 0, toonWeightPct: 200 });
  });

  it("computes points by target weight", () => {
    const formula = { accountWeightPct: 100, toonWeightPct: 50 };
    expect(computeContributionPoints(10_000, "account", formula)).toBe(10_000);
    expect(computeContributionPoints(10_000, "toon", formula)).toBe(5_000);
    expect(computeContributionPoints(10_000, "toon", { accountWeightPct: 0, toonWeightPct: 0 })).toBe(0);
  });

  it("maps presets", () => {
    expect(contributionFormulaPresetId(contributionFormulaFromPreset("account"))).toBe("account");
    expect(contributionFormulaPresetId(contributionFormulaFromPreset("toon"))).toBe("toon");
    expect(contributionFormulaPresetId({ accountWeightPct: 80, toonWeightPct: 50 })).toBe("custom");
    expect(describeContributionFormula({ accountWeightPct: 100, toonWeightPct: 100 })).toContain("계좌+투네");
  });
});
