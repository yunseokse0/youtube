import { describe, expect, it } from "vitest";
import { computeSettlement, toSettlementBaseAmount } from "@/lib/settlement-utils";
import type { Member } from "@/types";

describe("toSettlementBaseAmount", () => {
  it("returns floored amount when VAT not included", () => {
    expect(toSettlementBaseAmount(110_500, false)).toBe(110_500);
  });

  it(" converts VAT-inclusive amount to supply value", () => {
    expect(toSettlementBaseAmount(1_100_000, true)).toBe(1_000_000);
    expect(toSettlementBaseAmount(550_000, true)).toBe(500_000);
  });
});

describe("computeSettlement payment-statement formula", () => {
  const members: Member[] = [
    { id: "m1", name: "A", account: 1_100_000, toon: 0, operating: false },
  ];

  it("deducts account VAT then applies ratio when feeRate is 0", () => {
    const off = computeSettlement(members, 1, 1, 0, undefined, null, { vatIncluded: false });
    expect(off.members[0]?.account).toBe(1_100_000);
    // 1,100,000 − 부가세 110,000 = 990,000
    expect(off.members[0]?.gross).toBe(990_000);
    expect(off.members[0]?.net).toBe(990_000);
  });

  it("keeps supply snapshot when vatIncluded but payout uses original gross", () => {
    const on = computeSettlement(members, 1, 1, 0, undefined, null, { vatIncluded: true });
    expect(on.members[0]?.account).toBe(1_000_000);
    expect(on.members[0]?.accountSource).toBe(1_100_000);
    expect(on.members[0]?.gross).toBe(990_000);
    expect(on.vatIncluded).toBe(true);
  });

  it("matches 지급정산서 sample: account 1M + toon 1M → net 1,150,730", () => {
    const sample: Member[] = [
      { id: "m1", name: "BT태호", account: 1_000_000, toon: 1_000_000, operating: false },
    ];
    const r = computeSettlement(sample, 0.7, 0.7, 0.033);
    const m = r.members[0]!;
    expect(m.accountApplied).toBe(630_000);
    expect(m.toonApplied).toBe(560_000);
    expect(m.gross).toBe(1_190_000);
    expect(m.fee).toBe(39_270);
    expect(m.net).toBe(1_150_730);
  });
});
