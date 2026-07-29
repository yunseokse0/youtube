import { describe, expect, it } from "vitest";
import {
  battleDonationRankingTotals,
  battleRankRowBg,
  buildBattleDonationRows,
  formatBattleDonationAmount,
} from "./battle-donation-ranking";
import type { Member } from "@/types";

const members: Member[] = [
  { id: "m1", name: "동근이TV", account: 1000, toon: 4919100, contribution: 4920100 },
  { id: "m2", name: "봉달이", account: 0, toon: 0 },
  { id: "op", name: "운영비", account: 999, toon: 999, operating: true },
];

describe("battle-donation-ranking", () => {
  it("buildBattleDonationRows excludes operating and sorts by total", () => {
    const rows = buildBattleDonationRows(members, { m1: "게스트", m2: "게스트" });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.memberId).toBe("m1");
    expect(rows[0]!.category).toBe("[게스트]");
    expect(rows[0]!.total).toBe(4920100);
    expect(rows[1]!.total).toBe(0);
  });

  it("uses member creation order when totals tie at zero", () => {
    const tied: Member[] = [
      { id: "a", name: "C", account: 0, toon: 0 },
      { id: "b", name: "A", account: 0, toon: 0 },
      { id: "c", name: "B", account: 0, toon: 0 },
    ];
    const rows = buildBattleDonationRows(tied, {});
    expect(rows.map((r) => r.memberId)).toEqual(["a", "b", "c"]);
  });

  it("battleDonationRankingTotals sums columns", () => {
    const rows = buildBattleDonationRows(members, {});
    const t = battleDonationRankingTotals(rows);
    expect(t.total).toBe(4920100);
    expect(t.account).toBe(1000);
    expect(t.toon).toBe(4919100);
  });

  it("formatBattleDonationAmount uses ko-KR grouping", () => {
    expect(formatBattleDonationAmount(4920100)).toBe("4,920,100");
  });

  it("battleRankRowBg assigns medal colors for top 3", () => {
    expect(battleRankRowBg(0)).toContain("254, 240, 138");
    expect(battleRankRowBg(1)).toContain("254, 215, 170");
    expect(battleRankRowBg(2)).toContain("187, 247, 208");
  });
});
