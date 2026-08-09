import { describe, expect, it } from "vitest";
import type { SettlementMemberResult, SettlementRecord } from "@/types";
import {
  getMembersForExport,
  getTreasuryMembersForExport,
  toPaymentAlignedSettlement,
} from "@/lib/settlement";

const member = (overrides: Partial<SettlementMemberResult> = {}): SettlementMemberResult => ({
  memberId: "m1",
  name: "멤버A",
  realName: "",
  account: 100_000,
  toon: 0,
  accountRatio: 0.7,
  toonRatio: 0.6,
  accountApplied: 70_000,
  toonApplied: 0,
  gross: 70_000,
  fee: 2_000,
  net: 68_000,
  ...overrides,
});

const baseRecord = (overrides: Partial<SettlementRecord> = {}): SettlementRecord => ({
  id: "st_test",
  title: "테스트 정산",
  createdAt: Date.now(),
  accountRatio: 0.7,
  toonRatio: 0.6,
  feeRate: 0.033,
  members: [
    member({ memberId: "m1", name: "멤버A", net: 68_000, gross: 70_000, fee: 2_000 }),
    member({
      memberId: "tr",
      name: "국고",
      net: 30_000,
      gross: 31_000,
      fee: 1_000,
      accountApplied: 31_000,
    }),
  ],
  totalGross: 101_000,
  totalFee: 3_000,
  totalNet: 98_000,
  ...overrides,
});

describe("settlement treasury options", () => {
  it("getMembersForExport excludes treasury when omitTreasuryFromSettlement", () => {
    const rec = baseRecord({ omitTreasuryFromSettlement: true });
    const exported = getMembersForExport(rec);
    expect(exported.map((m) => m.memberId)).toEqual(["m1"]);
    expect(getTreasuryMembersForExport(rec).map((m) => m.memberId)).toEqual(["tr"]);
  });

  it("toPaymentAlignedSettlement totals exclude omitted treasury", () => {
    const withTreasury = toPaymentAlignedSettlement(baseRecord());
    const withoutTreasury = toPaymentAlignedSettlement(baseRecord({ omitTreasuryFromSettlement: true }));
    expect(withoutTreasury.members.map((m) => m.memberId)).toEqual(["m1"]);
    expect(withoutTreasury.totalNet).toBeLessThan(withTreasury.totalNet);
    expect(withTreasury.members.map((m) => m.memberId).sort()).toEqual(["m1", "tr"]);
  });

  it("includes treasury by default", () => {
    const exported = getMembersForExport(baseRecord());
    expect(exported.map((m) => m.memberId).sort()).toEqual(["m1", "tr"]);
  });
});
