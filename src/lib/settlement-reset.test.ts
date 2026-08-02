import { describe, expect, it } from "vitest";
import { filterDonorsAfterSettlementReset, mergeDonorsForMultiTabSave } from "@/lib/state";
import type { Donor } from "@/types";

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
});
