import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { syncMemberTotalsFromDonors } from "./apply-donation-state";
import {
  guardMemberTotalsAgainstAccidentalZeroWipe,
  isHighSocietySettingsOnlyPatch,
  shouldRefuseDonorShrinkOnMemberIdentityPatch,
  shouldRefuseMassEmptyAuthoritativeDonorWipe,
  wouldAccidentallyZeroRemainingMembers,
} from "./zero-wipe-guard";

describe("guardMemberTotalsAgainstAccidentalZeroWipe", () => {
  it("restores remaining member totals when sync zeroed but donors still hold amounts", () => {
    const baseline = {
      ...defaultState(),
      members: [
        { id: "m1", name: "A", account: 0, toon: 10_000, contribution: 10_000 },
        { id: "m2", name: "B", account: 0, toon: 20_000, contribution: 20_000 },
        { id: "m_del", name: "C", account: 0, toon: 5_000, contribution: 5_000 },
      ],
      donors: [
        { id: "d1", name: "후원1", amount: 10_000, memberId: "m1", at: 1, target: "toon" as const },
        { id: "d2", name: "후원2", amount: 20_000, memberId: "m2", at: 2, target: "toon" as const },
        { id: "d3", name: "후원3", amount: 5_000, memberId: "m_del", at: 3, target: "toon" as const },
      ],
    };
    const afterDeleteMembers = baseline.members.filter((m) => m.id !== "m_del");
    const afterDeleteDonors = baseline.donors.filter((d) => d.memberId !== "m_del");
    const wronglySynced = syncMemberTotalsFromDonors({
      ...baseline,
      members: afterDeleteMembers.map((m) => ({ ...m, account: 0, toon: 0, contribution: 0 })),
      donors: [],
    });
    expect(
      wronglySynced.members.find((m) => m.id === "m1")!.toon +
        wronglySynced.members.find((m) => m.id === "m2")!.toon
    ).toBe(0);

    const guarded = guardMemberTotalsAgainstAccidentalZeroWipe(
      {
        ...wronglySynced,
        members: afterDeleteMembers,
        donors: afterDeleteDonors,
      },
      baseline
    );
    expect(guarded.members.find((m) => m.id === "m1")?.toon).toBe(10_000);
    expect(guarded.members.find((m) => m.id === "m2")?.toon).toBe(20_000);
    expect(guarded.members.find((m) => m.id === "m_del")).toBeUndefined();
  });

  it("does not restore when donors truly lack remaining amounts", () => {
    const baseline = {
      ...defaultState(),
      members: [
        { id: "m1", name: "A", account: 0, toon: 10_000, contribution: 10_000 },
        { id: "m_del", name: "B", account: 0, toon: 5_000, contribution: 5_000 },
      ],
      donors: [
        { id: "d1", name: "후원1", amount: 10_000, memberId: "m1", at: 1, target: "toon" as const },
        { id: "d2", name: "후원2", amount: 5_000, memberId: "m_del", at: 2, target: "toon" as const },
      ],
    };
    const afterDelete = {
      ...baseline,
      members: baseline.members.filter((m) => m.id !== "m_del"),
      donors: [],
    };
    const synced = syncMemberTotalsFromDonors(afterDelete);
    const guarded = guardMemberTotalsAgainstAccidentalZeroWipe(synced, baseline);
    expect(guarded.members.find((m) => m.id === "m1")?.toon).toBe(0);
  });

  it("detects remote that zeroes remaining members while donors still hold amounts", () => {
    const local = {
      ...defaultState(),
      members: [
        { id: "m1", name: "A", account: 0, toon: 10_000, contribution: 10_000 },
        { id: "m2", name: "B", account: 0, toon: 20_000, contribution: 20_000 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 10_000, memberId: "m1", at: 1, target: "toon" as const },
        { id: "d2", name: "b", amount: 20_000, memberId: "m2", at: 2, target: "toon" as const },
      ],
    };
    const remote = {
      ...defaultState(),
      updatedAt: local.updatedAt + 1000,
      members: [{ id: "m1", name: "A", account: 0, toon: 0, contribution: 0 }],
      donors: [{ id: "d1", name: "a", amount: 10_000, memberId: "m1", at: 1, target: "toon" as const }],
    };
    expect(wouldAccidentallyZeroRemainingMembers(local, remote)).toBe(true);
  });
});

describe("shouldRefuseMassEmptyAuthoritativeDonorWipe", () => {
  const base = {
    donorsAuthoritative: true,
    settlementReset: false,
    donationInitReset: false,
    donorsInPatch: true,
    incomingDonorCount: 0,
    baseDonorCount: 2,
    highSocietySettingsInPatch: false,
  };

  it("refuses multi-donor wipe without settlement reset", () => {
    expect(shouldRefuseMassEmptyAuthoritativeDonorWipe(base)).toBe(true);
  });

  it("refuses single-donor wipe when high society settings are in patch (OFF/pause)", () => {
    expect(
      shouldRefuseMassEmptyAuthoritativeDonorWipe({
        ...base,
        baseDonorCount: 1,
        highSocietySettingsInPatch: true,
      })
    ).toBe(true);
  });

  it("allows intentional single-donor delete without HS patch", () => {
    expect(
      shouldRefuseMassEmptyAuthoritativeDonorWipe({
        ...base,
        baseDonorCount: 1,
        highSocietySettingsInPatch: false,
      })
    ).toBe(false);
  });

  it("allows wipe on settlement reset", () => {
    expect(
      shouldRefuseMassEmptyAuthoritativeDonorWipe({
        ...base,
        settlementReset: true,
      })
    ).toBe(false);
  });
});

describe("isHighSocietySettingsOnlyPatch", () => {
  it("detects territory pause style patch (HS settings, no donors/members authority)", () => {
    expect(
      isHighSocietySettingsOnlyPatch({
        highSocietySettingsInPatch: true,
        donorsInPatch: false,
        membersAuthoritative: false,
        settlementReset: false,
        donationInitReset: false,
      })
    ).toBe(true);
  });

  it("is false when donors are in patch", () => {
    expect(
      isHighSocietySettingsOnlyPatch({
        highSocietySettingsInPatch: true,
        donorsInPatch: true,
        membersAuthoritative: false,
        settlementReset: false,
        donationInitReset: false,
      })
    ).toBe(false);
  });
});

describe("shouldRefuseDonorShrinkOnMemberIdentityPatch", () => {
  const members = [
    { id: "m1", name: "A", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "m2", name: "B", account: 0, toon: 0, contribution: 0, operating: false },
  ];
  const renamed = [
    { id: "m1", name: "사기", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "m2", name: "히치", account: 0, toon: 0, contribution: 0, operating: false },
  ];

  it("refuses authoritative donor shrink when roster ids unchanged (rename)", () => {
    expect(
      shouldRefuseDonorShrinkOnMemberIdentityPatch({
        membersAuthoritative: true,
        donorsAuthoritative: true,
        donorsInPatch: true,
        settlementReset: false,
        donationInitReset: false,
        baseMembers: members,
        patchMembers: renamed,
        baseDonorCount: 10,
        incomingDonorCount: 2,
      })
    ).toBe(true);
  });

  it("allows shrink when member roster ids changed (delete/add)", () => {
    expect(
      shouldRefuseDonorShrinkOnMemberIdentityPatch({
        membersAuthoritative: true,
        donorsAuthoritative: true,
        donorsInPatch: true,
        settlementReset: false,
        donationInitReset: false,
        baseMembers: members,
        patchMembers: [renamed[0]!],
        baseDonorCount: 10,
        incomingDonorCount: 2,
      })
    ).toBe(false);
  });
});
