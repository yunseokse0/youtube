import { describe, expect, it } from "vitest";
import {
  buildUiStateFromServerDonorPull,
  defaultState,
  normalizeDonorsArray,
  pickAuthoritativeDonorsForEmptySession,
  totalCombined,
  type AppState,
} from "@/lib/state";

describe("pickAuthoritativeDonorsForEmptySession", () => {
  it("rebumps pre-reset server donors when local session is empty", () => {
    const resetAt = 1_700_000_000_000;
    const local: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "자키", account: 0, toon: 0 },
        { id: "m2", name: "빡수아", account: 0, toon: 0 },
      ],
      donors: [],
      settlementResetAt: resetAt,
    };
    const serverDonors = [
      {
        id: "d1",
        name: "후원자",
        amount: 10_000,
        memberId: "m1",
        at: resetAt - 86_400_000,
      },
    ];
    const picked = pickAuthoritativeDonorsForEmptySession(local, serverDonors, [], resetAt);
    expect(picked).toHaveLength(1);
    expect(picked[0]?.at).toBeGreaterThanOrEqual(resetAt);
  });

  it("prefers server donors over empty local spread merge", () => {
    const local: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "자키", account: 0, toon: 0 }],
      donors: [],
    };
    const serverDonors = [
      { id: "d1", name: "A", amount: 5000, memberId: "m1", at: Date.now() },
      { id: "d2", name: "B", amount: 7000, memberId: "m1", at: Date.now() },
    ];
    expect(pickAuthoritativeDonorsForEmptySession(local, serverDonors).length).toBe(2);
  });

  it("prefers server donors when UI has fewer rows", () => {
    const local: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "자키", account: 0, toon: 0 }],
      donors: [{ id: "d1", name: "A", amount: 5000, memberId: "m1", at: Date.now() }],
    };
    const serverDonors = [
      { id: "d1", name: "A", amount: 5000, memberId: "m1", at: Date.now() },
      { id: "d2", name: "B", amount: 7000, memberId: "m1", at: Date.now() },
      { id: "d3", name: "C", amount: 3000, memberId: "m1", at: Date.now() },
    ];
    expect(pickAuthoritativeDonorsForEmptySession(local, serverDonors).length).toBe(3);
  });
});

describe("buildUiStateFromServerDonorPull", () => {
  it("restores server donors when UI list is empty but member totals are stale", () => {
    const remote: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "자키", account: 5000, toon: 0 }],
      donors: [
        { id: "d1", name: "A", amount: 5000, memberId: "m1", at: Date.now() },
        { id: "d2", name: "B", amount: 7000, memberId: "m1", at: Date.now() },
      ],
      updatedAt: Date.now(),
    };
    const local: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "자키", account: 99_999, toon: 0 }],
      donors: [],
      updatedAt: Date.now() - 60_000,
    };
    const pulled = buildUiStateFromServerDonorPull(local, remote);
    expect(pulled).not.toBeNull();
    expect(normalizeDonorsArray(pulled?.donors).length).toBe(2);
    expect(totalCombined(pulled!)).toBe(12_000);
  });

  it("restores when UI has fewer donor rows even if stale member total is higher", () => {
    const remote: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "자키", account: 0, toon: 12_000 }],
      donors: [
        { id: "d1", name: "A", amount: 5000, memberId: "m1", at: Date.now() },
        { id: "d2", name: "B", amount: 7000, memberId: "m1", at: Date.now() },
      ],
      updatedAt: Date.now(),
    };
    const local: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "자키", account: 0, toon: 99_999 }],
      donors: [{ id: "d1", name: "A", amount: 5000, memberId: "m1", at: Date.now() }],
      updatedAt: Date.now(),
    };
    const pulled = buildUiStateFromServerDonorPull(local, remote);
    expect(normalizeDonorsArray(pulled?.donors).length).toBe(2);
  });
});
