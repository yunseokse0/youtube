import { describe, expect, it } from "vitest";
import { applySettlementResetToState } from "@/lib/settlement-reset-apply";
import { defaultState, totalCombined } from "@/lib/state";
import type { AppState } from "@/types";

function richState(): AppState {
  return {
    ...defaultState(),
    settlementResetAt: 1000,
    updatedAt: 2000,
    members: [
      { id: "m1", name: "헛치", account: 50000, toon: 10000, contribution: 60000 },
      { id: "m2", name: "현민", account: 20000, toon: 0, contribution: 20000 },
    ],
    donors: [
      {
        id: "d1",
        name: "후원",
        amount: 50000,
        memberId: "m1",
        at: 1500,
        target: "account",
      },
      {
        id: "d2",
        name: "투네",
        amount: 10000,
        memberId: "m1",
        at: 1600,
        target: "toon",
      },
    ],
    sigMatch: { m1: 5000, m2: -2000 },
    mealMatch: { m1: 12000, m2: 8000 },
    sigMatchSettings: {
      ...defaultState().sigMatchSettings,
      donationLinks: {
        m1: { active: true, startedAt: 1000 },
        m2: { active: true, startedAt: 1000 },
      },
      overlayTimerEndAt: Date.now() + 60_000,
    },
  };
}

describe("applySettlementResetToState", () => {
  it("keep: clears donors and amounts but preserves member names", () => {
    const next = applySettlementResetToState(richState(), {
      mode: "keep",
      resetAt: 9000,
    });
    expect(next.donors).toHaveLength(0);
    expect(totalCombined(next)).toBe(0);
    expect(next.members.map((m) => m.name)).toEqual(["헛치", "현민"]);
    expect(next.members.every((m) => m.account === 0 && m.toon === 0)).toBe(true);
    expect(next.sigMatch).toEqual({});
    expect(next.mealMatch).toEqual({});
    expect(next.sigMatchSettings?.overlayTimerEndAt).toBeNull();
    expect(next.sigMatchSettings?.donationLinks?.m1?.startedAt).toBe(9000);
    expect(next.settlementResetAt).toBe(9000);
    expect(next.intentionalDonationClearAt).toBe(9000);
  });

  it("init: replaces roster with placeholders and clears donations", () => {
    const next = applySettlementResetToState(richState(), {
      mode: "init",
      memberSlotCount: 3,
      resetAt: 9000,
    });
    expect(next.donors).toHaveLength(0);
    expect(totalCombined(next)).toBe(0);
    expect(next.members).toHaveLength(3);
    expect(next.members[0]?.name).toBe("멤버1");
    expect(next.sigMatch).toEqual({});
    expect(next.mealMatch).toEqual({});
    expect(next.settlementResetAt).toBe(9000);
    expect(next.intentionalDonationClearAt).toBe(9000);
  });
});
