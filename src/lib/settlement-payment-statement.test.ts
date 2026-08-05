import { describe, expect, it } from "vitest";
import type { SettlementMemberResult, SettlementRecord } from "@/types";
import {
  computeMemberPaymentStatement,
  formatBroadcastDateLabel,
  listPayableMembers,
} from "@/lib/settlement-payment-statement";

const member = (overrides: Partial<SettlementMemberResult> = {}): SettlementMemberResult => ({
  memberId: "m1",
  name: "테스트",
  realName: "홍길동",
  account: 1_000_000,
  toon: 1_000_000,
  accountRatio: 0.7,
  toonRatio: 0.7,
  accountApplied: 0,
  toonApplied: 0,
  gross: 0,
  fee: 0,
  net: 0,
  ...overrides,
});

const record = (overrides: Partial<SettlementRecord> = {}): SettlementRecord => ({
  id: "st_1",
  title: "2026.08.02. 매출 정산서",
  createdAt: new Date("2026-08-02T12:00:00+09:00").getTime(),
  accountRatio: 0.7,
  toonRatio: 0.7,
  feeRate: 0.033,
  members: [member()],
  totalGross: 0,
  totalFee: 0,
  totalNet: 0,
  ...overrides,
});

describe("computeMemberPaymentStatement (정산서.xlsx)", () => {
  it("matches sample: account 1M + toon 1M → payout 1,150,730", () => {
    const stmt = computeMemberPaymentStatement(record(), member());
    expect(stmt.accountGross).toBe(1_000_000);
    expect(stmt.accountPlatformFee).toBe(0);
    expect(stmt.accountVat).toBe(100_000);
    expect(stmt.accountNet).toBe(900_000);
    expect(stmt.accountStreamerShare).toBe(630_000);

    expect(stmt.toonGross).toBe(1_000_000);
    expect(stmt.toonPlatformFee).toBe(100_000);
    expect(stmt.toonVat).toBe(100_000);
    expect(stmt.toonNet).toBe(800_000);
    expect(stmt.toonStreamerShare).toBe(560_000);

    expect(stmt.pretaxTotal).toBe(1_190_000);
    expect(stmt.withholding).toBe(39_270);
    expect(stmt.payout).toBe(1_150_730);
  });

  it("uses accountSource/toonSource as gross when vat-included snapshot exists", () => {
    const stmt = computeMemberPaymentStatement(
      record(),
      member({
        account: 909_000,
        toon: 909_000,
        accountSource: 1_000_000,
        toonSource: 1_000_000,
      })
    );
    expect(stmt.accountGross).toBe(1_000_000);
    expect(stmt.toonGross).toBe(1_000_000);
    expect(stmt.payout).toBe(1_150_730);
  });

  it("formats broadcast date like 2026.08.02(일)", () => {
    expect(formatBroadcastDateLabel(new Date("2026-08-02T12:00:00+09:00").getTime())).toBe(
      "2026.08.02(일)"
    );
  });

  it("listPayableMembers skips empty rows", () => {
    const rec = record({
      members: [
        member({ memberId: "m1" }),
        member({
          memberId: "m2",
          name: "빈행",
          account: 0,
          toon: 0,
          accountApplied: 0,
          toonApplied: 0,
          gross: 0,
          fee: 0,
          net: 0,
        }),
      ],
    });
    expect(listPayableMembers(rec).map((m) => m.memberId)).toEqual(["m1"]);
  });
});
