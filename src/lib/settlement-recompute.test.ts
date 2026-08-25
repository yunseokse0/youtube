import { describe, expect, it } from "vitest";
import type { SettlementMemberResult, SettlementRecord } from "@/types";
import { recomputeSettlementRecord, updateSettlementRecordAndRecompute } from "@/lib/settlement";

const member = (overrides: Partial<SettlementMemberResult> = {}): SettlementMemberResult => ({
  memberId: "m1",
  name: "A",
  account: 1_000_000,
  toon: 0,
  accountRatio: 0.7,
  toonRatio: 0.6,
  accountApplied: 0,
  toonApplied: 0,
  gross: 0,
  fee: 0,
  net: 0,
  ...overrides,
});

const record = (): SettlementRecord => ({
  id: "st_1",
  title: "테스트",
  createdAt: Date.now(),
  accountRatio: 0.7,
  toonRatio: 0.6,
  feeRate: 0.033,
  members: [member()],
  totalGross: 0,
  totalFee: 0,
  totalNet: 0,
  donors: [
    {
      id: "d1",
      name: "후원",
      amount: 1_000_000,
      memberId: "m1",
      at: Date.now(),
      target: "account",
    },
  ],
});

describe("recomputeSettlementRecord", () => {
  it("recomputes with changed global account ratio", () => {
    const base = record();
    const next = recomputeSettlementRecord(base, { accountRatio: 0.5 });
    expect(next.accountRatio).toBe(0.5);
    expect(next.members[0]!.accountApplied).toBeLessThan(
      recomputeSettlementRecord(base, { accountRatio: 0.7 }).members[0]!.accountApplied
    );
  });

  it("recomputes with per-member ratio override", () => {
    const base = record();
    const next = recomputeSettlementRecord(base, {
      memberRatioOverrides: { m1: { accountRatio: 0.5, toonRatio: 0.5 } },
    });
    expect(next.members[0]!.accountRatio).toBe(0.5);
    expect(next.members[0]!.toonRatio).toBe(0.5);
  });

  it("updateSettlementRecordAndRecompute toggles tax invoice flag", () => {
    const list = [record()];
    const next = updateSettlementRecordAndRecompute(list, "st_1", { taxInvoiceIssued: true });
    expect(next[0]!.taxInvoiceIssued).toBe(true);
  });

  it("stores per-member taxInvoiceIssued via ratio overrides", () => {
    const base = record();
    const next = recomputeSettlementRecord(base, {
      taxInvoiceIssued: false,
      memberRatioOverrides: { m1: { taxInvoiceIssued: true } },
    });
    expect(next.taxInvoiceIssued).toBe(false);
    expect(next.members[0]!.taxInvoiceIssued).toBe(true);
  });

  it("clears per-member taxInvoiceIssued when overrides emptied", () => {
    const base = recomputeSettlementRecord(record(), {
      memberRatioOverrides: { m1: { taxInvoiceIssued: true } },
    });
    expect(base.members[0]!.taxInvoiceIssued).toBe(true);
    const cleared = recomputeSettlementRecord(base, { memberRatioOverrides: {} });
    expect(cleared.members[0]!.taxInvoiceIssued).toBeUndefined();
  });
});
