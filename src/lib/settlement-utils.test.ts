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

describe("computeSettlement vatIncluded", () => {
  const members: Member[] = [
    { id: "m1", name: "A", account: 1_100_000, toon: 0, operating: false },
  ];

  it("uses gross amounts when vatIncluded is false", () => {
    const off = computeSettlement(members, 1, 1, 0, undefined, null, { vatIncluded: false });
    expect(off.members[0]?.account).toBe(1_100_000);
    expect(off.members[0]?.gross).toBe(1_100_000);
  });

  it("uses supply value when vatIncluded is true", () => {
    const on = computeSettlement(members, 1, 1, 0, undefined, null, { vatIncluded: true });
    expect(on.members[0]?.account).toBe(1_000_000);
    expect(on.members[0]?.accountSource).toBe(1_100_000);
    expect(on.members[0]?.gross).toBe(1_000_000);
    expect(on.vatIncluded).toBe(true);
  });
});
