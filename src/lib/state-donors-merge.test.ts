import { describe, expect, it } from "vitest";
import {
  filterDonorsAfterSettlementReset,
  mergeDonorsForMultiTabSave,
  rebumpDonorsPastSettlementReset,
} from "@/lib/state";
import type { Donor } from "@/types";

function donor(id: string, amount: number, at = 1000): Donor {
  return { id, name: "tester", amount, memberId: "m1", at, target: "toon" };
}

describe("mergeDonorsForMultiTabSave", () => {
  it("does not restore deleted donors from a stale tab save", () => {
    const existing = [donor("toonation:1", 51000), donor("toonation:2", 10000)];
    const staleIncoming = [donor("toonation:1", 51000), donor("toonation:2", 10000), donor("toonation:3", 50900)];
    const merged = mergeDonorsForMultiTabSave(staleIncoming, existing, {
      incomingUpdatedAt: 1000,
      existingUpdatedAt: 5000,
    });
    expect(merged.map((d) => d.id).sort()).toEqual(["toonation:1", "toonation:2"]);
  });

  it("keeps existing donors when incoming save is empty (stale tab after deploy)", () => {
    const existing = [donor("toonation:1", 51000), donor("toonation:2", 10000)];
    const merged = mergeDonorsForMultiTabSave([], existing, {
      incomingUpdatedAt: 9000,
      existingUpdatedAt: 5000,
    });
    expect(merged.map((d) => d.id).sort()).toEqual(["toonation:1", "toonation:2"]);
  });

  it("unions donors when newer snapshot adds and removes without authoritative flag", () => {
    const existing = [donor("toonation:1", 51000), donor("toonation:2", 10000)];
    const incoming = [donor("toonation:2", 10000), donor("toonation:4", 3000, 2000)];
    const merged = mergeDonorsForMultiTabSave(incoming, existing, {
      incomingUpdatedAt: 9000,
      existingUpdatedAt: 5000,
    });
    expect(merged.map((d) => d.id).sort()).toEqual(["toonation:1", "toonation:2", "toonation:4"]);
  });

  it("does not drop donors on partial subset without authoritative flag", () => {
    const existing = [
      donor("toonation:1", 10000),
      donor("toonation:2", 10000),
      donor("toonation:3", 10000),
      donor("toonation:4", 10000),
    ];
    const incoming = [donor("toonation:1", 10000), donor("toonation:2", 10000), donor("toonation:3", 10000)];
    const merged = mergeDonorsForMultiTabSave(incoming, existing, {
      incomingUpdatedAt: 9000,
      existingUpdatedAt: 5000,
    });
    expect(merged.map((d) => d.id).sort()).toEqual(["toonation:1", "toonation:2", "toonation:3", "toonation:4"]);
  });

  it("applies intentional delete when incoming is newer (1 of 2)", () => {
    const existing = [donor("toonation:1", 51000), donor("toonation:2", 10000)];
    const incoming = [donor("toonation:2", 10000)];
    const merged = mergeDonorsForMultiTabSave(incoming, existing, {
      incomingUpdatedAt: 9000,
      existingUpdatedAt: 5000,
      donorsAuthoritative: true,
    });
    expect(merged.map((d) => d.id)).toEqual(["toonation:2"]);
  });

  it("applies authoritative empty donors (delete all)", () => {
    const existing = [donor("toonation:1", 51000)];
    const merged = mergeDonorsForMultiTabSave([], existing, {
      incomingUpdatedAt: 9000,
      existingUpdatedAt: 5000,
      donorsAuthoritative: true,
    });
    expect(merged).toEqual([]);
  });
});

describe("rebumpDonorsPastSettlementReset", () => {
  it("bumps pre-reset donor at so filter keeps them", () => {
    const resetAt = 10_000;
    const donors = [donor("a", 1000, 5000), donor("b", 2000, 12_000)];
    const bumped = rebumpDonorsPastSettlementReset(donors, resetAt);
    expect(filterDonorsAfterSettlementReset(bumped, resetAt).map((d) => d.id)).toEqual(["a", "b"]);
    expect(Number(bumped[0]?.at)).toBeGreaterThanOrEqual(resetAt - 3000);
    expect(Number(bumped[1]?.at)).toBe(12_000);
  });
});
