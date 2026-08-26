import { describe, expect, it } from "vitest";
import {
  applySettlementTestSeed,
  buildSettlementTestRecord,
  ensureSettlementTestMembers,
} from "@/lib/dev/seed-settlement-test";
import { defaultState } from "@/lib/state";

describe("seed-settlement-test", () => {
  it("ensureSettlementTestMembers adds default roster when empty", () => {
    const base = defaultState();
    base.members = [];
    const next = ensureSettlementTestMembers(base);
    expect(next.members.length).toBeGreaterThanOrEqual(2);
  });

  it("applySettlementTestSeed creates donors and settlement", () => {
    const { state, donorsAdded, settlement } = applySettlementTestSeed(defaultState());
    expect(donorsAdded).toBeGreaterThan(0);
    expect(state.donors.length).toBeGreaterThan(0);
    expect(settlement).not.toBeNull();
    expect(settlement!.totalNet).toBeGreaterThan(0);
    expect(settlement!.donors?.length).toBeGreaterThan(0);
  });

  it("buildSettlementTestRecord respects ratio options", () => {
    const { state } = applySettlementTestSeed(defaultState(), { createSettlement: false });
    const rec = buildSettlementTestRecord(state, { accountRatio: 0.5, toonRatio: 0.4 });
    expect(rec.accountRatio).toBe(0.5);
    expect(rec.toonRatio).toBe(0.4);
  });
});
