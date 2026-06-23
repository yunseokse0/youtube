import { describe, expect, it } from "vitest";
import { mergeDonorsForMultiTabSave } from "@/lib/state";
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

  it("applies a newer snapshot that deletes and adds donors", () => {
    const existing = [donor("toonation:1", 51000), donor("toonation:2", 10000)];
    const incoming = [donor("toonation:2", 10000), donor("toonation:4", 3000, 2000)];
    const merged = mergeDonorsForMultiTabSave(incoming, existing, {
      incomingUpdatedAt: 9000,
      existingUpdatedAt: 5000,
    });
    expect(merged.map((d) => d.id).sort()).toEqual(["toonation:2", "toonation:4"]);
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
