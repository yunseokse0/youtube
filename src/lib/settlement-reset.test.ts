import { describe, expect, it } from "vitest";
import {
  coalesceSettlementResetAt,
  defaultState,
  filterDonorsAfterSettlementReset,
  mergeDonorsForMultiTabSave,
  shouldAvoidOverwritingLocalStateWithRemote,
  wouldShrinkDonationData,
} from "@/lib/state";
import type { AppState, Donor } from "@/types";

function donor(id: string, amount: number, at = 1000): Donor {
  return { id, name: "tester", amount, memberId: "m1", at, target: "toon" };
}

describe("settlement reset guards", () => {
  it("drops pre-reset donors by at timestamp", () => {
    const resetAt = 10_000;
    const filtered = filterDonorsAfterSettlementReset(
      [donor("old", 1000, 5000), donor("new", 2000, 11_000)],
      resetAt
    );
    expect(filtered.map((d) => d.id)).toEqual(["new"]);
  });

  it("does not restore old donors onto empty server after reset", () => {
    const resetAt = 10_000;
    const stale = [donor("old", 1000, 5000), donor("old2", 2000, 6000)];
    const filtered = filterDonorsAfterSettlementReset(stale, resetAt);
    const merged = mergeDonorsForMultiTabSave(filtered, [], {
      incomingUpdatedAt: 20_000,
      existingUpdatedAt: resetAt,
    });
    expect(merged).toEqual([]);
  });

  it("clears donors when donorsAuthoritative empty save", () => {
    const existing = [donor("old", 1000, 5000)];
    const merged = mergeDonorsForMultiTabSave([], existing, {
      donorsAuthoritative: true,
      incomingUpdatedAt: 20_000,
      existingUpdatedAt: 10_000,
    });
    expect(merged).toEqual([]);
  });

  it("drops pre-reset donors even when filtering authoritative payloads", () => {
    const resetAt = 10_000;
    const mixed = [donor("old", 1000, 5000), donor("new", 2000, 12_000)];
    const filtered = filterDonorsAfterSettlementReset(mixed, resetAt);
    expect(filtered.map((d) => d.id)).toEqual(["new"]);
  });

  it("keeps newer settlementResetAt when stale browser posts older value", () => {
    expect(
      coalesceSettlementResetAt({
        baseResetAt: 20_000,
        patchResetAt: 5_000,
      })
    ).toBe(20_000);
  });

  it("ignores client raising settlementResetAt without settlementReset flag", () => {
    expect(
      coalesceSettlementResetAt({
        baseResetAt: 20_000,
        patchResetAt: 99_000,
      })
    ).toBe(20_000);
  });

  it("allows settlementReset to advance stamp", () => {
    expect(
      coalesceSettlementResetAt({
        baseResetAt: 20_000,
        patchResetAt: 5_000,
        settlementReset: true,
        resetStamp: 30_000,
      })
    ).toBe(30_000);
  });

  it("allows remote reset to overwrite richer local donations", () => {
    const local: AppState = {
      ...defaultState(),
      settlementResetAt: 1_000,
      donors: [donor("old", 1_000_000, 500)],
      members: [{ id: "m1", name: "A", account: 1_000_000, toon: 0 }],
    };
    const remote: AppState = {
      ...defaultState(),
      settlementResetAt: 20_000,
      donors: [],
      members: [{ id: "m1", name: "A", account: 0, toon: 0 }],
    };
    expect(shouldAvoidOverwritingLocalStateWithRemote(local, remote)).toBe(false);
    expect(wouldShrinkDonationData(local, remote)).toBe(true);
  });
});
