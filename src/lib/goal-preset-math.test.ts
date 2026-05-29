import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONATION_GOAL,
  GOAL_AUTO_INCREASE_STEP,
  computeEscalatedDonationGoal,
  isDonationGoalAutoEscalateEnabled,
  normalizeOverlayPresetDonationGoals,
  nextGoalTenPercentIncrease,
  mergeOverlayPresetsPreservingEscalatedGoals,
  resetOverlayPresetsGoalForDonationInit,
  unwindGoalForDonationReset,
} from "./goal-preset-math";

describe("normalizeOverlayPresetDonationGoals", () => {
  it("기준선 200만 원, 3천만 원은 200만으로, 상향된 goal 은 유지", () => {
    expect(isDonationGoalAutoEscalateEnabled()).toBe(true);
    expect(GOAL_AUTO_INCREASE_STEP).toBe(DEFAULT_DONATION_GOAL);
    expect(
      normalizeOverlayPresetDonationGoals([
        { id: "a", showGoal: true, goal: "30000000", goalBaseline: "30000000" },
        { id: "b", showGoal: true, goal: "4000000", goalBaseline: "2000000" },
      ])
    ).toEqual([
      { id: "a", showGoal: true, goal: "2000000", goalBaseline: "2000000" },
      { id: "b", showGoal: true, goal: "4000000", goalBaseline: "2000000" },
    ]);
  });
});

describe("nextGoalTenPercentIncrease", () => {
  it("고정 +200만 원", () => {
    expect(nextGoalTenPercentIncrease(100)).toBe(100 + 2_000_000);
    expect(nextGoalTenPercentIncrease(1)).toBe(1 + 2_000_000);
    expect(nextGoalTenPercentIncrease(9_500_000)).toBe(9_500_000 + 2_000_000);
    expect(nextGoalTenPercentIncrease(15_000_000)).toBe(15_000_000 + 2_000_000);
  });
});

describe("computeEscalatedDonationGoal", () => {
  it("100% 달성마다 200만 원씩 연속 상향", () => {
    expect(computeEscalatedDonationGoal(2_000_000, 1_900_000)).toBe(2_000_000);
    expect(computeEscalatedDonationGoal(2_000_000, 2_000_000)).toBe(4_000_000);
    expect(computeEscalatedDonationGoal(2_000_000, 4_500_000)).toBe(6_000_000);
    expect(computeEscalatedDonationGoal(4_000_000, 5_500_000)).toBe(6_000_000);
    expect(computeEscalatedDonationGoal(2_000_000, 6_000_000)).toBe(8_000_000);
  });
});

describe("unwindGoalForDonationReset", () => {
  it("고정 200만 원 스텝으로 여러 단계 되감기", () => {
    const g0 = 3_000_000;
    const g1 = nextGoalTenPercentIncrease(g0);
    expect(g1 - g0).toBe(2_000_000);
  });

  it("unwind(초기화 시 목표 복원은 resetOverlay… 에서 goalBaseline 우선)", () => {
    let g = 2_000_000;
    g = nextGoalTenPercentIncrease(g);
    g = nextGoalTenPercentIncrease(g);
    expect(unwindGoalForDonationReset(g, 2)).toBe(2_000_000);
  });
});

describe("mergeOverlayPresetsPreservingEscalatedGoals", () => {
  it("서버 4M·클라이언트 2M 저장 시 4M 유지", () => {
    const base = [{ id: "a", showGoal: true, goal: "4000000", goalBaseline: "2000000" }];
    const patch = [{ id: "a", showGoal: true, goal: "2000000", goalBaseline: "2000000" }];
    const out = mergeOverlayPresetsPreservingEscalatedGoals(base, patch) as { goal: string }[];
    expect(out[0]!.goal).toBe("4000000");
  });
});

describe("resetOverlayPresetsGoalForDonationInit", () => {
  it("goalBaseline 있으면 goal 복구", () => {
    const out = resetOverlayPresetsGoalForDonationInit([
      { id: "a", goal: "4000000", goalBaseline: "2000000" },
    ]) as { goal: string }[];
    expect(out[0]!.goal).toBe("2000000");
  });

  it("goalBaseline 없으면 goal 유지", () => {
    const out = resetOverlayPresetsGoalForDonationInit([{ id: "a", goal: "36000000" }]) as { goal: string }[];
    expect(out[0]!.goal).toBe("36000000");
  });
});
