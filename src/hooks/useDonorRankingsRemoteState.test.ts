import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { shouldKeepLocalDonorsOverRemote } from "@/hooks/useDonorRankingsRemoteState";

describe("shouldKeepLocalDonorsOverRemote", () => {
  it("does not keep local when remote has fewer but non-empty donors", () => {
    const local = {
      ...defaultState(),
      settlementResetAt: 500,
      donorRankingsUpdatedAt: 1000,
      donors: [
        { id: "d1", name: "익명", amount: 251000, memberId: "m1", at: 1, target: "account" as const },
        { id: "d2", name: "익명", amount: 200000, memberId: "m2", at: 2, target: "account" as const },
        { id: "d3", name: "익명", amount: 100000, memberId: "m3", at: 3, target: "account" as const },
      ],
      members: [{ id: "m1", name: "멤버1", account: 251000, toon: 0, contribution: 251000 }],
    };
    const remote = {
      ...defaultState(),
      settlementResetAt: 500,
      donorRankingsUpdatedAt: 2000,
      donors: [
        { id: "d9", name: "익명", amount: 150000, memberId: "m1", at: 9, target: "account" as const },
      ],
      members: [{ id: "m1", name: "멤버1", account: 150000, toon: 0, contribution: 150000 }],
    };
    expect(shouldKeepLocalDonorsOverRemote(local, remote)).toBe(false);
  });

  it("keeps local when remote donors are empty without newer reset", () => {
    const local = {
      ...defaultState(),
      settlementResetAt: 500,
      donorRankingsUpdatedAt: 2000,
      donors: [
        { id: "d1", name: "익명", amount: 150000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "멤버1", account: 150000, toon: 0, contribution: 150000 }],
    };
    const remote = {
      ...defaultState(),
      settlementResetAt: 500,
      donorRankingsUpdatedAt: 1000,
      donors: [] as typeof local.donors,
      members: [{ id: "m1", name: "멤버1", account: 0, toon: 0, contribution: 0 }],
    };
    expect(shouldKeepLocalDonorsOverRemote(local, remote)).toBe(true);
  });

  it("keeps local when empty remote only has newer rankings revision (territory patch race)", () => {
    const local = {
      ...defaultState(),
      settlementResetAt: 500,
      donorRankingsUpdatedAt: 1000,
      donors: [
        { id: "d1", name: "익명", amount: 150000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "멤버1", account: 150000, toon: 0, contribution: 150000 }],
    };
    const remote = {
      ...defaultState(),
      settlementResetAt: 500,
      donorRankingsUpdatedAt: 9999,
      donors: [] as typeof local.donors,
      members: [{ id: "m1", name: "멤버1", account: 0, toon: 0, contribution: 0 }],
    };
    expect(shouldKeepLocalDonorsOverRemote(local, remote)).toBe(true);
  });
});
