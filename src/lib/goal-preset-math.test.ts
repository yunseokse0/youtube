import { describe, expect, it } from "vitest";
import {
  nextGoalTenPercentIncrease,
  resetOverlayPresetsGoalForDonationInit,
} from "./goal-preset-math";

describe("nextGoalTenPercentIncrease", () => {
  it("max(g+1, ceil(1.1g)) 규칙", () => {
    expect(nextGoalTenPercentIncrease(100)).toBe(111);
    expect(nextGoalTenPercentIncrease(1)).toBe(2);
  });
});

describe("resetOverlayPresetsGoalForDonationInit", () => {
  it("goalBaseline 이 있으면 goal 을 그 값으로 되돌린다", () => {
    const out = resetOverlayPresetsGoalForDonationInit([
      { id: "a", goal: "36000000", goalBaseline: "30000000" },
    ]) as { goal: string; goalBaseline?: string }[];
    expect(out[0]!.goal).toBe("30000000");
  });

  it("goalBaseline 이 없으면 goal 을 유지한다", () => {
    const out = resetOverlayPresetsGoalForDonationInit([{ id: "a", goal: "36000000" }]) as { goal: string }[];
    expect(out[0]!.goal).toBe("36000000");
  });
});
