import { describe, expect, it } from "vitest";
import type { Member } from "@/types";
import {
  buildOverlayRankedMembers,
  buildRankLinkedMemberPositions,
  compareMembersByContribution,
  sortMembersForRanking,
  splitOverlayListAtHalf,
} from "./utils";

const members: Member[] = [
  { id: "m1", name: "멤버A", account: 1000, toon: 0, contribution: 1000 },
  { id: "m2", name: "멤버B", account: 5000, toon: 0, contribution: 5000 },
  { id: "rep", name: "패잡", account: 0, toon: 0, contribution: 0 },
  { id: "ops", name: "운영비", account: 0, toon: 0, contribution: 0, operating: true },
];

const positions = {
  m1: "인턴",
  m2: "인턴",
  rep: "대표",
  ops: "",
};

describe("buildOverlayRankedMembers", () => {
  it("pins representative at top and ranks others by contribution", () => {
    const unpinned = members.filter((m) => !m.operating);
    const ranked = buildOverlayRankedMembers(unpinned, positions);
    expect(ranked.map((r) => r.m.id)).toEqual(["rep", "m2", "m1"]);
    expect(ranked[0]?.rank).toBeNull();
    expect(ranked[1]?.rank).toBe(1);
    expect(ranked[2]?.rank).toBe(2);
  });

  it("uses member creation order when all contributions are zero", () => {
    const zeroMembers: Member[] = [
      { id: "z3", name: "Charlie", account: 0, toon: 0, contribution: 0 },
      { id: "z1", name: "Alpha", account: 0, toon: 0, contribution: 0 },
      { id: "z2", name: "Beta", account: 0, toon: 0, contribution: 0 },
    ];
    const ranked = buildOverlayRankedMembers(zeroMembers, {});
    expect(ranked.map((r) => r.m.id)).toEqual(["z3", "z1", "z2"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("keeps tied contributions in member creation order", () => {
    const tiedMembers: Member[] = [
      { id: "m-a", name: "A", account: 5000, toon: 0, contribution: 5000 },
      { id: "m-b", name: "B", account: 5000, toon: 0, contribution: 5000 },
    ];
    const ranked = buildOverlayRankedMembers(tiedMembers, {});
    expect(ranked.map((r) => r.m.id)).toEqual(["m-a", "m-b"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("ranks by contribution even when donation totals would reverse", () => {
    const rows: Member[] = [
      { id: "low-c", name: "금액많음", account: 90000, toon: 0, contribution: 1000 },
      { id: "high-c", name: "기여높음", account: 1000, toon: 0, contribution: 80000 },
    ];
    const ranked = buildOverlayRankedMembers(rows, {}, undefined, rows, undefined, "contribution");
    expect(ranked.map((r) => r.m.id)).toEqual(["high-c", "low-c"]);
  });

  it("can rank by donation total when metric=donation", () => {
    const rows: Member[] = [
      { id: "low-c", name: "금액많음", account: 90000, toon: 0, contribution: 1000 },
      { id: "high-c", name: "기여높음", account: 1000, toon: 0, contribution: 80000 },
    ];
    const ranked = buildOverlayRankedMembers(rows, {}, undefined, rows, undefined, "donation");
    expect(ranked.map((r) => r.m.id)).toEqual(["low-c", "high-c"]);
  });

  it("matches sortMembersForRanking on contribution order", () => {
    const tiedMembers: Member[] = [
      { id: "m-a", name: "A", account: 5050, toon: 0, contribution: 2000 },
      { id: "m-b", name: "B", account: 5099, toon: 0, contribution: 9000 },
    ];
    const overlayOrder = buildOverlayRankedMembers(tiedMembers, {}).map((r) => r.m.id);
    const listOrder = sortMembersForRanking(tiedMembers, {}, { mode: "fixed" }).map((r) => r.id);
    expect(overlayOrder).toEqual(["m-b", "m-a"]);
    expect(listOrder).toEqual(["m-b", "m-a"]);
  });

  it("uses getContribution override when provided", () => {
    const rows: Member[] = [
      { id: "a", name: "A", account: 1, toon: 0, contribution: 1 },
      { id: "b", name: "B", account: 1, toon: 0, contribution: 1 },
    ];
    const ranked = buildOverlayRankedMembers(rows, {}, undefined, rows, (m) =>
      m.id === "b" ? 999 : 1
    );
    expect(ranked.map((r) => r.m.id)).toEqual(["b", "a"]);
  });
});

describe("compareMembersByContribution", () => {
  it("breaks contribution ties with donation total", () => {
    const a: Member = { id: "a", name: "A", account: 10000, toon: 0, contribution: 5000 };
    const b: Member = { id: "b", name: "B", account: 1000, toon: 0, contribution: 5000 };
    expect(compareMembersByContribution(a, b)).toBeLessThan(0);
  });
});

describe("splitOverlayListAtHalf", () => {
  it("does not split at 5 items or fewer", () => {
    expect(splitOverlayListAtHalf([1, 2, 3, 4])).toEqual({
      left: [1, 2, 3, 4],
      right: [],
      split: false,
    });
    expect(splitOverlayListAtHalf([1, 2, 3, 4, 5])).toEqual({
      left: [1, 2, 3, 4, 5],
      right: [],
      split: false,
    });
  });

  it("splits 6+ items into fixed 5 + remainder (max 5 on right)", () => {
    expect(splitOverlayListAtHalf([1, 2, 3, 4, 5, 6])).toEqual({
      left: [1, 2, 3, 4, 5],
      right: [6],
      split: true,
    });
    expect(splitOverlayListAtHalf([1, 2, 3, 4, 5, 6, 7, 8])).toEqual({
      left: [1, 2, 3, 4, 5],
      right: [6, 7, 8],
      split: true,
    });
  });

  it("splits 10 items into 5 + 5", () => {
    expect(splitOverlayListAtHalf([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({
      left: [1, 2, 3, 4, 5],
      right: [6, 7, 8, 9, 10],
      split: true,
    });
  });
});

describe("sortMembersForRanking", () => {
  it("keeps representative first and operating rows at bottom", () => {
    const rows = sortMembersForRanking(members, positions, { mode: "fixed" });
    expect(rows.map((r) => r.id)).toEqual(["rep", "m2", "m1", "ops"]);
    expect(rows[0]?.position).toBe("대표");
    expect(rows[1]?.contributionAmount).toBe(5000);
  });
});

describe("buildRankLinkedMemberPositions", () => {
  it("snapshots rank labels onto members by contribution order", () => {
    const snapped = buildRankLinkedMemberPositions(
      members,
      { rep: "대표" },
      ["대표", "이사", "부장", "사원"],
      { rankingMetric: "contribution" }
    );
    expect(snapped).toEqual({
      rep: "대표",
      m2: "이사",
      m1: "부장",
      ops: "사원",
    });
  });

  it("uses donation totals when metric is donation", () => {
    const rows: Member[] = [
      { id: "low-c", name: "금액많음", account: 90000, toon: 0, contribution: 1000 },
      { id: "high-c", name: "기여높음", account: 1000, toon: 0, contribution: 80000 },
      { id: "rep", name: "대표", account: 0, toon: 0, contribution: 0 },
    ];
    const snapped = buildRankLinkedMemberPositions(
      rows,
      { rep: "대표" },
      ["대표", "1위직", "2위직"],
      { rankingMetric: "donation" }
    );
    expect(snapped["low-c"]).toBe("1위직");
    expect(snapped["high-c"]).toBe("2위직");
  });
});
