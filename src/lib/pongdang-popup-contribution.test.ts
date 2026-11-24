import { describe, expect, it } from "vitest";
import type { AppState, Donor } from "@/types";
import { collectPongdangPopupAutoContributionByMember } from "./pongdang-popup-contribution";

function makeState(donors: Donor[]): AppState {
  return { donors, contributionLogs: [], pongdangResetAt: 0 } as unknown as AppState;
}

describe("collectPongdangPopupAutoContributionByMember", () => {
  it("parses comma-formatted and Unicode-negative donor amounts without turning totals into zero", () => {
    const donors = [
      {
        id: "positive",
        memberId: "m1",
        amount: 92000,
        sigPrice: "92,000",
        isSigCredit: true,
        at: 1,
      },
      {
        id: "negative",
        memberId: "m1",
        amount: 120000,
        sigPrice: "−120,000",
        isSigCredit: true,
        at: 2,
      },
    ] as unknown as Donor[];

    expect(collectPongdangPopupAutoContributionByMember(makeState(donors)).get("m1"))
      .toBe(-28000);
  });

  it("applies the pongdang minus flag to formatted positive amounts", () => {
    const donors = [
      {
        id: "minus",
        memberId: "m1",
        amount: 50000,
        sigPrice: "50,000",
        isSigCredit: true,
        pongdangMinus: true,
        at: 1,
      },
    ] as unknown as Donor[];

    expect(collectPongdangPopupAutoContributionByMember(makeState(donors)).get("m1"))
      .toBe(-50000);
  });

  it("continues to exclude pre-reset and unassigned donations", () => {
    const state = {
      pongdangResetAt: 100,
      contributionLogs: [],
      donors: [
        { id: "old", memberId: "m1", sigPrice: 10000, isSigCredit: true, at: 99 },
        {
          id: "pending",
          memberId: "m1",
          sigPrice: 20000,
          isSigCredit: true,
          memberAutoAssigned: true,
          at: 101,
        },
        { id: "current", memberId: "m1", sigPrice: 30000, isSigCredit: true, at: 102 },
      ],
    } as unknown as AppState;

    expect(collectPongdangPopupAutoContributionByMember(state).get("m1")).toBe(30000);
  });
});
