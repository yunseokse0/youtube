import { describe, expect, it } from "vitest";
import { pickFresherAppState } from "./app-state-freshness";
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
});
