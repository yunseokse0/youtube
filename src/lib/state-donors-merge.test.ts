import { describe, expect, it } from "vitest";
import {
  filterDonorsAfterSettlementReset,
  mergeDonorsForMultiTabSave,
  resolveRichestDonorsFromSources,
  mergeServerSaveApiBodies,
  rebumpDonorsPastSettlementReset,
} from "@/lib/state";
import type { Donor } from "@/types";

function donor(id: string, amount: number, at = 1000): Donor {
  return { id, name: "tester", amount, memberId: "m1", at, target: "toon" };
}

describe("isIntentionalDonorListShrink", () => {
  it("detects single-donor delete as intentional shrink", async () => {
    const { isIntentionalDonorListShrink } = await import("@/lib/state");
    const existing = [donor("a", 10000), donor("b", 20000)];
    const incoming = [donor("a", 10000)];
    expect(isIntentionalDonorListShrink(incoming, existing, 9000, 5000)).toBe(true);
  });

  it("does not treat manual add (new id) as shrink even if shorter than redis race", async () => {
    const { isIntentionalDonorListShrink } = await import("@/lib/state");
    const existing = [donor("toonation:1", 64000)];
    const incoming = [donor("d_manual_1", 50000, 2000)];
    expect(isIntentionalDonorListShrink(incoming, existing, 9000, 5000)).toBe(false);
  });

  it("does not treat add+keep as shrink", async () => {
    const { isIntentionalDonorListShrink } = await import("@/lib/state");
    const existing = [donor("toonation:1", 64000)];
    const incoming = [donor("toonation:1", 64000), donor("d_manual_1", 50000, 2000)];
    expect(isIntentionalDonorListShrink(incoming, existing, 9000, 5000)).toBe(false);
  });
});

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

  it("keeps reassigned memberId when local donor at is newer than remote", () => {
    const remote = [donor("d1", 100_000, 1000)];
    const local = [{ ...donor("d1", 100_000, 9000), memberId: "m2" }];
    const merged = mergeDonorsForMultiTabSave(remote, local, {
      incomingUpdatedAt: 5000,
      existingUpdatedAt: 9000,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.memberId).toBe("m2");
  });

  it("detects member reassignment for authoritative replace", async () => {
    const { isDonorListMemberReassignment } = await import("@/lib/state");
    const existing = [donor("d1", 100_000, 1000)];
    const incoming = [{ ...donor("d1", 100_000, 2000), memberId: "m2" }];
    expect(isDonorListMemberReassignment(incoming, existing)).toBe(true);
    expect(isDonorListMemberReassignment(existing, incoming)).toBe(true);
    expect(isDonorListMemberReassignment([donor("d1", 50_000, 2000)], existing)).toBe(false);
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

describe("mergeServerSaveApiBodies", () => {
  it("rebumps then filters donors after settlementReset queue merge", () => {
    const resetAt = 10_000;
    const prev = JSON.stringify({
      settlementReset: true,
      settlementResetAt: resetAt,
      donors: [],
      updatedAt: resetAt,
    });
    const next = JSON.stringify({
      donors: [donor("a", 1000, 5000), donor("b", 2000, 12_000)],
      updatedAt: resetAt + 100,
    });
    const merged = JSON.parse(mergeServerSaveApiBodies(prev, next)) as {
      donors: Donor[];
      settlementResetAt: number;
    };
    expect(merged.settlementResetAt).toBe(resetAt);
    expect(merged.donors.map((d) => d.id).sort()).toEqual(["a", "b"]);
    expect(Number(merged.donors.find((d) => d.id === "a")?.at)).toBeGreaterThanOrEqual(resetAt - 3000);
  });

  it("unions consecutive donorsAuthoritative saves so manual is not dropped by later toon", () => {
    const prev = JSON.stringify({
      donorsAuthoritative: true,
      donors: [donor("manual-1", 50_000, 1000)],
      updatedAt: 1000,
    });
    const next = JSON.stringify({
      donorsAuthoritative: true,
      donors: [donor("toon-1", 10_000, 2000)],
      updatedAt: 2000,
    });
    const merged = JSON.parse(mergeServerSaveApiBodies(prev, next)) as {
      donors: Donor[];
      donorsAuthoritative?: boolean;
    };
    expect(merged.donorsAuthoritative).toBe(true);
    expect(merged.donors.map((d) => d.id).sort()).toEqual(["manual-1", "toon-1"]);
  });

  it("keeps intentional authoritative delete as shrink replace", () => {
    const prev = JSON.stringify({
      donorsAuthoritative: true,
      donors: [donor("a", 1000, 1000), donor("b", 2000, 1000)],
      updatedAt: 1000,
    });
    const next = JSON.stringify({
      donorsAuthoritative: true,
      donors: [donor("a", 1000, 2000)],
      updatedAt: 2000,
    });
    const merged = JSON.parse(mergeServerSaveApiBodies(prev, next)) as {
      donors: Donor[];
    };
    expect(merged.donors.map((d) => d.id)).toEqual(["a"]);
  });

  it("donorsReplace keeps group-split list without union-reviving pre-split row flags", () => {
    const prev = JSON.stringify({
      donorsAuthoritative: true,
      donors: [donor("src", 90_000, 1000)],
      updatedAt: 1000,
    });
    const next = JSON.stringify({
      donorsAuthoritative: true,
      donorsReplace: true,
      donors: [
        { ...donor("src", 90_000, 1000), donationExcluded: true, groupSplitSource: true },
        { ...donor("src:split:m1", 30_000, 2000), groupSplit: true },
        { ...donor("src:split:m2", 30_000, 2000), groupSplit: true },
        { ...donor("src:split:m3", 30_000, 2000), groupSplit: true },
      ],
      updatedAt: 2000,
    });
    const merged = JSON.parse(mergeServerSaveApiBodies(prev, next)) as {
      donors: Donor[];
      donorsReplace?: boolean;
    };
    expect(merged.donorsReplace).toBe(true);
    expect(merged.donors.map((d) => d.id).sort()).toEqual([
      "src",
      "src:split:m1",
      "src:split:m2",
      "src:split:m3",
    ]);
    expect(merged.donors.find((d) => d.id === "src")?.donationExcluded).toBe(true);
  });
});

describe("resolveRichestDonorsFromSources", () => {
  it("unions donors from react, ref, and LS sources", () => {
    const react: Donor[] = [donor("a", 10000)];
    const ref: Donor[] = [donor("a", 10000), donor("b", 20000)];
    const ls: Donor[] = [donor("c", 30000)];
    const merged = resolveRichestDonorsFromSources([react, ref, ls], {
      incomingUpdatedAt: 9000,
      existingUpdatedAt: 5000,
    });
    expect(merged.map((d) => d.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("returns empty when all sources are empty", () => {
    expect(resolveRichestDonorsFromSources([[], undefined, null])).toEqual([]);
  });
});
