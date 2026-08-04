import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONATION_GOAL,
  GOAL_AUTO_INCREASE_STEP,
  applyDonationGoalEscalationToState,
  computeEscalatedDonationGoal,
  computeLiveDonationTotalFromMembers,
  isDonationGoalAutoEscalateEnabled,
  isDonationInitGoalResetPatch,
  normalizeOverlayPresetDonationGoals,
  nextGoalTenPercentIncrease,
  mergeOverlayPresetsPreservingEscalatedGoals,
  resetOverlayPresetsGoalForDonationInit,
  unwindGoalForDonationReset,
} from "./goal-preset-math";

describe("isDonationInitGoalResetPatch", () => {
  const zeroMembers = [
    { account: 0, toon: 0 },
    { account: 0, toon: 0 },
  ];
  const goalPresets = [
    { id: "g", showGoal: true, goal: "2000000", goalBaseline: "2000000" },
  ];

  it("명시적 플래그 없이는 후원 초기화로 취급하지 않음", () => {
    expect(
      isDonationInitGoalResetPatch({
        donors: [],
        members: zeroMembers,
        overlayPresets: goalPresets,
      })
    ).toBe(false);
  });

  it("settlementReset 또는 donationInit 이 있을 때만 초기화로 인식", () => {
    expect(
      isDonationInitGoalResetPatch({
        donors: [],
        members: zeroMembers,
        overlayPresets: goalPresets,
        settlementReset: true,
      })
    ).toBe(true);
    expect(
      isDonationInitGoalResetPatch({
        donors: [],
        members: zeroMembers,
        overlayPresets: goalPresets,
        donationInit: true,
      })
    ).toBe(true);
  });
});

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
      { id: "a", showGoal: true, goal: "2000000", goalBaseline: "2000000", goalIncreaseStep: "2000000" },
      { id: "b", showGoal: true, goal: "4000000", goalBaseline: "2000000", goalIncreaseStep: "2000000" },
    ]);
  });

  it("커스텀 초기 목표·증가폭 유지", () => {
    expect(
      normalizeOverlayPresetDonationGoals([
        {
          id: "c",
          showGoal: true,
          goal: "5000000",
          goalBaseline: "3000000",
          goalIncreaseStep: "1000000",
        },
      ])
    ).toEqual([
      {
        id: "c",
        showGoal: true,
        goal: "5000000",
        goalBaseline: "3000000",
        goalIncreaseStep: "1000000",
      },
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
    expect(computeEscalatedDonationGoal(2_000_000, 13_131_313)).toBe(14_000_000);
  });

  it("커스텀 기준선·증가폭", () => {
    expect(computeEscalatedDonationGoal(3_000_000, 2_900_000, 3_000_000, 500_000)).toBe(3_000_000);
    expect(computeEscalatedDonationGoal(3_000_000, 3_000_000, 3_000_000, 500_000)).toBe(3_500_000);
    expect(computeEscalatedDonationGoal(3_000_000, 4_200_000, 3_000_000, 500_000)).toBe(4_500_000);
  });
});

describe("applyDonationGoalEscalationToState", () => {
  it("관리자 후원만 저장해도 목표 프리셋이 상향된다", () => {
    const members = [{ id: "m1", name: "A", account: 13_131_313, toon: 0, contribution: 13_131_313, operating: true }];
    expect(computeLiveDonationTotalFromMembers(members)).toBe(13_131_313);
    const state = {
      members,
      overlayPresets: [{ id: "goal1", showGoal: true, goal: "2000000", goalBaseline: "2000000", goalIncreaseStep: "2000000" }],
      updatedAt: 1,
    } as import("@/types").AppState;
    const out = applyDonationGoalEscalationToState(state);
    expect((out.overlayPresets?.[0] as { goal?: string })?.goal).toBe("14000000");
    expect(out.updatedAt).toBeGreaterThan(1);
  });

  it("커스텀 증가폭으로 상향", () => {
    const members = [{ id: "m1", name: "A", account: 3_100_000, toon: 0, contribution: 3_100_000, operating: true }];
    const state = {
      members,
      overlayPresets: [
        { id: "goal1", showGoal: true, goal: "3000000", goalBaseline: "3000000", goalIncreaseStep: "500000" },
      ],
      updatedAt: 1,
    } as import("@/types").AppState;
    const out = applyDonationGoalEscalationToState(state);
    expect((out.overlayPresets?.[0] as { goal?: string })?.goal).toBe("3500000");
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
