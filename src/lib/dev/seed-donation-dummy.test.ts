import { describe, expect, it } from "vitest";
import { applyDonationDummySeed, buildDummyDonationRows } from "@/lib/dev/seed-donation-dummy";
import { defaultState } from "@/lib/state";

describe("seed-donation-dummy", () => {
  it("builds group-split candidate and per-member dummies", () => {
    const base = defaultState();
    base.members = [
      { id: "m1", name: "태호", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "홍쓰", account: 0, toon: 0, contribution: 0 },
      { id: "m3", name: "국고", account: 0, toon: 0, contribution: 0 },
    ];
    base.memberPositions = { m3: "국고" };
    const rows = buildDummyDonationRows(base, { now: 1_700_000_000_000 });
    expect(rows.some((d) => d.name === "단체짠더미")).toBe(true);
    expect(rows.some((d) => d.name === "국고더미" && d.memberId === "m3")).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it("replace mode recalculates member totals", () => {
    const base = defaultState();
    base.members = [
      { id: "m1", name: "A", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "B", account: 0, toon: 0, contribution: 0 },
    ];
    const { state, added, mode } = applyDonationDummySeed(base, { mode: "replace", now: 1000 });
    expect(mode).toBe("replace");
    expect(added.length).toBeGreaterThan(0);
    expect(state.donors.length).toBe(added.length);
    const total = state.members.reduce((s, m) => s + (m.account || 0) + (m.toon || 0), 0);
    expect(total).toBeGreaterThan(0);
  });
});
