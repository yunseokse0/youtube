import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { computeDonorRankingsUpdatedAt } from "@/lib/donor-rankings-rev";
import { shouldSyncDonorRankingsFromStateUpdatedEvent } from "@/lib/overlay-pull-policy";

describe("donor-rankings-rev", () => {
  it("does not bump revision when only unrelated fields change", () => {
    const base = defaultState();
    const prev = base.donorRankingsUpdatedAt || base.updatedAt || 0;
    const next = { ...base, updatedAt: Date.now() + 1000 };
    const rev = computeDonorRankingsUpdatedAt(base, next, {}, false);
    expect(rev).toBe(prev);
  });

  it("bumps revision when member account/toon totals change", () => {
    const base = {
      ...defaultState(),
      donorRankingsUpdatedAt: 1000,
      members: [{ id: "m1", name: "a", account: 0, toon: 0, contribution: 0 }],
    };
    const next = {
      ...base,
      members: [{ id: "m1", name: "a", account: 5000, toon: 0, contribution: 5000 }],
    };
    const prev = base.donorRankingsUpdatedAt || 0;
    const rev = computeDonorRankingsUpdatedAt(base, next, { members: next.members }, false);
    expect(rev).toBeGreaterThan(prev);
  });

  it("bumps revision when donors change", () => {
    const base = { ...defaultState(), donorRankingsUpdatedAt: 1000 };
    const next = {
      ...base,
      donors: [
        {
          id: "d1",
          name: "a",
          amount: 1,
          at: 1,
          target: "account" as const,
          memberId: "m1",
        },
      ],
    };
    const prev = base.donorRankingsUpdatedAt || 0;
    const rev = computeDonorRankingsUpdatedAt(base, next, { donors: next.donors }, true);
    expect(rev).toBeGreaterThanOrEqual(prev);
    expect(rev).not.toBe(prev);
  });
});

describe("shouldSyncDonorRankingsFromStateUpdatedEvent", () => {
  it("ignores updatedAt-only events", () => {
    expect(shouldSyncDonorRankingsFromStateUpdatedEvent({ updatedAt: 999 }, 0)).toBe(false);
  });

  it("syncs when donorRankingsUpdatedAt advances", () => {
    expect(
      shouldSyncDonorRankingsFromStateUpdatedEvent({ updatedAt: 100, donorRankingsUpdatedAt: 200 }, 150)
    ).toBe(true);
  });
});
