import { describe, expect, it } from "vitest";
import {
  applyMealBattleDonationToParticipants,
  mealBattleDonationScoreDelta,
} from "./meal-battle-donation";

describe("mealBattleDonationScoreDelta", () => {
  it("returns 0 for non-positive amounts", () => {
    expect(mealBattleDonationScoreDelta(0)).toBe(0);
    expect(mealBattleDonationScoreDelta(-100)).toBe(0);
  });

  it("converts won to score (10k = 1 point, min 1)", () => {
    expect(mealBattleDonationScoreDelta(5_000)).toBe(1);
    expect(mealBattleDonationScoreDelta(10_000)).toBe(1);
    expect(mealBattleDonationScoreDelta(25_000)).toBe(3);
  });
});

describe("applyMealBattleDonationToParticipants", () => {
  const base = [
    {
      memberId: "m1",
      name: "A",
      score: 2,
      goal: 100,
      color: "#fff",
      donationLinkActive: true,
      donationLinkStartedAt: 1_000,
    },
    {
      memberId: "m2",
      name: "B",
      score: 5,
      goal: 100,
      color: "#000",
      donationLinkActive: false,
    },
  ];

  it("adds score only when link is active and after startedAt", () => {
    const out = applyMealBattleDonationToParticipants(base, "m1", 10_000, 1, 2_000);
    expect(out.find((p) => p.memberId === "m1")?.score).toBe(3);
    expect(out.find((p) => p.memberId === "m2")?.score).toBe(5);
  });

  it("ignores donations before donationLinkStartedAt", () => {
    const out = applyMealBattleDonationToParticipants(base, "m1", 10_000, 1, 500);
    expect(out.find((p) => p.memberId === "m1")?.score).toBe(2);
  });
});
