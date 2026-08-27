import { describe, expect, it } from "vitest";
import { pickFresherAppState } from "./app-state-freshness";
import { coalesceAppStateRedisAndMemory } from "./app-state-server-load";
import { defaultState, totalCombined } from "@/lib/state";
import type { AppState } from "@/types";

function snap(
  partial: Partial<AppState> & { updatedAt: number; donorsLen?: number; settlementResetAt?: number }
): AppState {
  const donors = Array.from({ length: partial.donorsLen ?? 0 }, (_, i) => ({
    id: `d${i}`,
    name: "n",
    amount: 1000,
    memberId: "m1",
    at: partial.updatedAt,
    target: "toon" as const,
  }));
  return {
    members: [{ id: "m1", name: "A", account: 0, toon: 0, contribution: 0 }],
    donors,
    updatedAt: partial.updatedAt,
    donorRankingsUpdatedAt: partial.donorRankingsUpdatedAt,
    settlementResetAt: partial.settlementResetAt,
  } as AppState;
}

describe("pickFresherAppState", () => {
  it("prefers memory when updatedAt is newer than redis", () => {
    const redis = snap({ updatedAt: 1000, donorsLen: 0 });
    const memory = snap({ updatedAt: 2000, donorsLen: 1 });
    expect(pickFresherAppState(redis, memory)?.updatedAt).toBe(2000);
    expect(pickFresherAppState(redis, memory)?.donors).toHaveLength(1);
  });

  it("prefers more donors when timestamps tie (first-donation race)", () => {
    const redis = snap({ updatedAt: 1000, donorRankingsUpdatedAt: 1000, donorsLen: 0 });
    const memory = snap({ updatedAt: 1000, donorRankingsUpdatedAt: 1000, donorsLen: 1 });
    expect(pickFresherAppState(redis, memory)?.donors).toHaveLength(1);
  });

  it("prefers redis when redis is clearly newer", () => {
    const redis = snap({ updatedAt: 3000, donorsLen: 2 });
    const memory = snap({ updatedAt: 1000, donorsLen: 1 });
    expect(pickFresherAppState(redis, memory)?.updatedAt).toBe(3000);
  });

  it("does not prefer newer empty snapshot over richer manuals (same reset)", () => {
    const redis = snap({ updatedAt: 5000, donorsLen: 0, settlementResetAt: 100 });
    const memory = snap({ updatedAt: 1000, donorsLen: 5, settlementResetAt: 100 });
    expect(pickFresherAppState(redis, memory)?.donors).toHaveLength(5);
  });

  it("prefers higher settlementResetAt even when empty", () => {
    const redis = snap({ updatedAt: 5000, donorsLen: 0, settlementResetAt: 900 });
    const memory = snap({ updatedAt: 1000, donorsLen: 5, settlementResetAt: 100 });
    expect(pickFresherAppState(redis, memory)?.settlementResetAt).toBe(900);
    expect(pickFresherAppState(redis, memory)?.donors).toHaveLength(0);
  });

  it("does not prefer higher reset when winner is accidental placeholder wipe", () => {
    const wiped = {
      ...snap({ updatedAt: 9000, donorsLen: 0, settlementResetAt: 900 }),
      members: [
        { id: "m1", name: "멤버1", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "멤버2", account: 0, toon: 0, contribution: 0 },
      ],
    } as AppState;
    const rich = {
      ...snap({ updatedAt: 1000, donorsLen: 5, settlementResetAt: 100 }),
      members: [{ id: "m1", name: "홍쓰", account: 50000, toon: 0, contribution: 50000 }],
    } as AppState;
    expect(pickFresherAppState(wiped, rich)?.donors).toHaveLength(5);
    expect(pickFresherAppState(wiped, rich)?.members[0]?.name).toBe("홍쓰");
  });

  it("prefers meaningful member roster over newer placeholder", () => {
    const placeholder = {
      ...snap({ updatedAt: 9000, donorsLen: 0, settlementResetAt: 100 }),
      members: [
        { id: "m1", name: "멤버1", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "멤버2", account: 0, toon: 0, contribution: 0 },
      ],
    } as AppState;
    const real = {
      ...snap({ updatedAt: 1000, donorsLen: 0, settlementResetAt: 100 }),
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 0, contribution: 0 }],
    } as AppState;
    expect(pickFresherAppState(placeholder, real)?.members[0]?.name).toBe("홍쓰");
  });

  it("prefers non-zero member totals over newer zero totals", () => {
    const zero = {
      ...snap({ updatedAt: 9000, donorsLen: 0, settlementResetAt: 100 }),
      members: [{ id: "m1", name: "홍쓰", account: 0, toon: 0, contribution: 0 }],
    } as AppState;
    const rich = {
      ...snap({ updatedAt: 1000, donorsLen: 0, settlementResetAt: 100 }),
      members: [{ id: "m1", name: "홍쓰", account: 40000, toon: 0, contribution: 40000 }],
    } as AppState;
    expect(pickFresherAppState(zero, rich)?.members[0]?.account).toBe(40000);
  });
});

describe("coalesceAppStateRedisAndMemory", () => {
  it("does not re-union old donors after settlement reset wins", () => {
    const resetAt = 9_000;
    const cleared: AppState = {
      ...defaultState(),
      settlementResetAt: resetAt,
      updatedAt: resetAt,
      members: [{ id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const stale: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      updatedAt: 1_000,
      members: [{ id: "m1", name: "자키", account: 50000, toon: 0, contribution: 50000 }],
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 50000,
          memberId: "m1",
          at: 500,
          target: "account",
        },
      ],
    };
    const merged = coalesceAppStateRedisAndMemory(cleared, stale);
    expect(merged?.settlementResetAt).toBe(resetAt);
    expect(merged?.donors).toHaveLength(0);
    expect(totalCombined(merged!)).toBe(0);
  });

  it("unions redis group-split donors when memory wins freshness", () => {
    const redis: AppState = {
      members: [
        { id: "m1", name: "A", account: 25000, toon: 0, contribution: 25000 },
        { id: "m2", name: "B", account: 25000, toon: 0, contribution: 25000 },
      ],
      donors: [
        {
          id: "src",
          name: "단체짠",
          amount: 50000,
          memberId: "m1",
          at: 1000,
          target: "account",
          donationExcluded: true,
          groupSplitSource: true,
        },
        {
          id: "src:split:m1",
          name: "단체짠",
          amount: 25000,
          memberId: "m1",
          at: 1001,
          target: "account",
          groupSplit: true,
        },
        {
          id: "src:split:m2",
          name: "단체짠",
          amount: 25000,
          memberId: "m2",
          at: 1001,
          target: "account",
          groupSplit: true,
        },
      ],
      updatedAt: 1000,
      settlementResetAt: 100,
    } as AppState;
    const memory: AppState = {
      members: [
        { id: "m1", name: "A", account: 0, toon: 10000, contribution: 10000 },
        { id: "m2", name: "B", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [
        {
          id: "toonation:new",
          name: "투네",
          amount: 10000,
          memberId: "m1",
          at: 5000,
          target: "toon",
        },
      ],
      updatedAt: 5000,
      settlementResetAt: 100,
    } as AppState;
    expect(pickFresherAppState(redis, memory)?.donors.length).toBeGreaterThan(0);
    const coalesced = coalesceAppStateRedisAndMemory(redis, memory);
    expect(coalesced?.donors.map((d) => d.id).sort()).toEqual([
      "src",
      "src:split:m1",
      "src:split:m2",
      "toonation:new",
    ]);
    expect(coalesced?.members.find((m) => m.id === "m1")?.account).toBe(25000);
    expect(coalesced?.members.find((m) => m.id === "m1")?.toon).toBe(10000);
  });
});
