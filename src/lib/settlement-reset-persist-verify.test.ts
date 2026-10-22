import { describe, expect, it } from "vitest";
import type { AppState } from "@/types";
import {
  settlementResetSavedStateStillDirty,
  verifySettlementResetPersisted,
} from "@/lib/settlement-reset-persist-verify";

function baseState(partial: Partial<AppState>): AppState {
  return {
    members: [{ id: "m1", name: "A", account: 0, toon: 0, contribution: 0 }],
    donors: [],
    updatedAt: Date.now(),
    settlementResetAt: 0,
    ...partial,
  } as AppState;
}

describe("verifySettlementResetPersisted", () => {
  it("fails when reload is missing", () => {
    expect(
      verifySettlementResetPersisted({
        beforeResetAt: 100,
        expectedResetAt: 200,
        reloaded: null,
      }).reason
    ).toBe("reload_missing");
  });

  it("fails when donors remain", () => {
    const r = verifySettlementResetPersisted({
      beforeResetAt: 100,
      expectedResetAt: 200,
      reloaded: baseState({
        settlementResetAt: 200,
        donors: [{ id: "d1", name: "x", amount: 1000, at: 250, memberId: "m1" }],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("donors_remain");
  });

  it("fails when member totals remain", () => {
    const r = verifySettlementResetPersisted({
      beforeResetAt: 100,
      expectedResetAt: 200,
      reloaded: baseState({
        settlementResetAt: 200,
        members: [{ id: "m1", name: "A", account: 5000, toon: 0, contribution: 0 }],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("totals_remain");
  });

  it("fails when stamp did not advance past before/expected", () => {
    expect(
      verifySettlementResetPersisted({
        beforeResetAt: 300,
        expectedResetAt: 200,
        reloaded: baseState({ settlementResetAt: 250 }),
      }).reason
    ).toBe("stamp_not_advanced");
    expect(
      verifySettlementResetPersisted({
        beforeResetAt: 100,
        expectedResetAt: 200,
        reloaded: baseState({ settlementResetAt: 100 }),
      }).reason
    ).toBe("stamp_not_advanced");
  });

  it("passes when stamp advanced and roster empty", () => {
    const r = verifySettlementResetPersisted({
      beforeResetAt: 100,
      expectedResetAt: 200,
      reloaded: baseState({ settlementResetAt: 200, donors: [] }),
    });
    expect(r).toMatchObject({ ok: true, donorsCount: 0, total: 0, settlementResetAt: 200 });
  });
});

describe("settlementResetSavedStateStillDirty", () => {
  it("detects leftover donors or totals", () => {
    expect(settlementResetSavedStateStillDirty(null)).toBe(true);
    expect(settlementResetSavedStateStillDirty(baseState({}))).toBe(false);
    expect(
      settlementResetSavedStateStillDirty(
        baseState({
          donors: [{ id: "d1", name: "x", amount: 1, at: 1, memberId: "m1" }],
        })
      )
    ).toBe(true);
  });
});
