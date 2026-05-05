import { describe, expect, it } from "vitest";
import {
  findLargestPredecessorForTarget,
  nextGoalTenPercentIncrease,
  resetOverlayPresetsGoalForDonationInit,
  unwindGoalForDonationReset,
} from "./goal-preset-math";

describe("nextGoalTenPercentIncrease", () => {
  it("max(g+1, ceil(1.1g)) 규칙", () => {
    expect(nextGoalTenPercentIncrease(100)).toBe(111);
    expect(nextGoalTenPercentIncrease(1)).toBe(2);
  });
});

describe("findLargestPredecessorForTarget / unwindGoalForDonationReset", () => {
  it("역함수 한 단계", () => {
    const g0 = 3_000_000;
    const g1 = nextGoalTenPercentIncrease(g0);
    expect(findLargestPredecessorForTarget(g1)).toBe(g0);
  });

  it("unwind는 역추적 유틸로만 사용(초기화 시 목표 복원에는 goalBaseline 사용)", () => {
    let g = 2_000_000;
    g = nextGoalTenPercentIncrease(g);
    g = nextGoalTenPercentIncrease(g);
    expect(unwindGoalForDonationReset(g, 2)).toBe(2_000_000);
  });
});

describe("resetOverlayPresetsGoalForDonationInit", () => {
  it("goalBaseline 있으면 goal 복구", () => {
    const out = resetOverlayPresetsGoalForDonationInit([
      { id: "a", goal: "36000000", goalBaseline: "30000000" },
    ]) as { goal: string }[];
    expect(out[0]!.goal).toBe("30000000");
  });

  it("goalBaseline 없으면 goal 유지", () => {
    const out = resetOverlayPresetsGoalForDonationInit([{ id: "a", goal: "36000000" }]) as { goal: string }[];
    expect(out[0]!.goal).toBe("36000000");
  });
});
