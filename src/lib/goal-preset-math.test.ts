import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONATION_GOAL,
  DONATION_GOAL_FORCE_LOCK,
  normalizeOverlayPresetDonationGoals,
  nextGoalTenPercentIncrease,
  resetOverlayPresetsGoalForDonationInit,
  unwindGoalForDonationReset,
} from "./goal-preset-math";

describe("normalizeOverlayPresetDonationGoals", () => {
  it("목표바 ON 프리셋을 200만 원으로 강제한다", () => {
    expect(DONATION_GOAL_FORCE_LOCK).toBe(true);
    expect(
      normalizeOverlayPresetDonationGoals([
        { id: "a", showGoal: true, goal: "30000000", goalBaseline: "36000000" },
        { id: "b", showGoal: false, goal: "5000000" },
      ])[0]
    ).toMatchObject({ goal: String(DEFAULT_DONATION_GOAL), goalBaseline: String(DEFAULT_DONATION_GOAL) });
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
