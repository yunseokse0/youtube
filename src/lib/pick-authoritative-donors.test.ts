import { describe, expect, it } from "vitest";
import {
  defaultState,
  pickAuthoritativeDonorsForEmptySession,
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
});
