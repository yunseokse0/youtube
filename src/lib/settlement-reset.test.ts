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

const RESET_AT = Date.UTC(2026, 9, 7, 4, 2, 58);
const MIN = 60_000;

function donor(id: string, amount: number, at = RESET_AT - 60 * MIN): Donor {
  return { id, name: "tester", amount, memberId: "m1", at, target: "toon" };
}

describe("settlement reset guards", () => {
  it("drops pre-reset donors by at timestamp", () => {
    const filtered = filterDonorsAfterSettlementReset(
      [donor("old", 1000, RESET_AT - 10 * MIN), donor("new", 2000, RESET_AT + MIN)],
      RESET_AT
    );
    expect(filtered.map((d) => d.id)).toEqual(["new"]);
  });

  it("drops the last test donation even if it is only a minute before reset", () => {
    const filtered = filterDonorsAfterSettlementReset(
      [donor("last-test", 1000, RESET_AT - MIN), donor("after", 2000, RESET_AT + 1)],
      RESET_AT
    );
    expect(filtered.map((d) => d.id)).toEqual(["after"]);
  });

  it("does not restore old donors onto empty server after reset", () => {
    const stale = [donor("old", 1000, RESET_AT - 30 * MIN), donor("old2", 2000, RESET_AT - 20 * MIN)];
    const filtered = filterDonorsAfterSettlementReset(stale, RESET_AT);
    const merged = mergeDonorsForMultiTabSave(filtered, [], {
      incomingUpdatedAt: RESET_AT + 10 * MIN,
      existingUpdatedAt: RESET_AT,
    });
    expect(merged).toEqual([]);
  });

  it("clears donors when donorsAuthoritative empty save", () => {
    const existing = [donor("old", 1000)];
    const merged = mergeDonorsForMultiTabSave([], existing, {
      donorsAuthoritative: true,
      incomingUpdatedAt: RESET_AT + 10 * MIN,
      existingUpdatedAt: RESET_AT,
    });
    expect(merged).toEqual([]);
  });

  it("drops pre-reset donors even when filtering authoritative payloads", () => {
    const mixed = [donor("old", 1000, RESET_AT - 10 * MIN), donor("new", 2000, RESET_AT + 2 * MIN)];
    const filtered = filterDonorsAfterSettlementReset(mixed, RESET_AT);
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

  it("does not treat missing member totals as an implicit reset", () => {
    expect(
      coalesceSettlementResetAt({
        baseResetAt: 20_000,
        patchResetAt: 99_000,
        donorCount: 3,
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
      settlementResetAt: RESET_AT - 24 * 60 * MIN,
      donors: [donor("old", 1_000_000, RESET_AT - 60 * MIN)],
      members: [{ id: "m1", name: "A", account: 1_000_000, toon: 0 }],
    };
    const remote: AppState = {
      ...defaultState(),
      settlementResetAt: RESET_AT,
      donors: [],
      members: [{ id: "m1", name: "A", account: 0, toon: 0 }],
    };
    expect(shouldAvoidOverwritingLocalStateWithRemote(local, remote)).toBe(false);
    expect(wouldShrinkDonationData(local, remote)).toBe(false);
  });
});
