import { describe, expect, it } from "vitest";
import { clampBattleRulesFontSize } from "@/components/battle/BattleRulesBox";

describe("clampBattleRulesFontSize", () => {
  it("defaults and clamps", () => {
    expect(clampBattleRulesFontSize(undefined)).toBe(16);
    expect(clampBattleRulesFontSize(8)).toBe(10);
    expect(clampBattleRulesFontSize(40)).toBe(36);
    expect(clampBattleRulesFontSize(20)).toBe(20);
  });
});
