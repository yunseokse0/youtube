import { describe, expect, it } from "vitest";
import type { Member } from "@/types";
import { buildOverlayRankedMembers, sortMembersForRanking } from "./utils";

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
  it("pins representative at top and ranks others below", () => {
    const unpinned = members.filter((m) => !m.operating);
    const ranked = buildOverlayRankedMembers(unpinned, positions);
    expect(ranked.map((r) => r.m.id)).toEqual(["rep", "m2", "m1"]);
    expect(ranked[0]?.rank).toBeNull();
    expect(ranked[1]?.rank).toBe(1);
    expect(ranked[2]?.rank).toBe(2);
  });

  it("uses member creation order when all donations are zero", () => {
    const zeroMembers: Member[] = [
      { id: "z3", name: "Charlie", account: 0, toon: 0, contribution: 0 },
      { id: "z1", name: "Alpha", account: 0, toon: 0, contribution: 0 },
      { id: "z2", name: "Beta", account: 0, toon: 0, contribution: 0 },
    ];
    const ranked = buildOverlayRankedMembers(zeroMembers, {});
    expect(ranked.map((r) => r.m.id)).toEqual(["z3", "z1", "z2"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("keeps tied donation totals in member creation order", () => {
    const tiedMembers: Member[] = [
      { id: "m-a", name: "A", account: 5000, toon: 0, contribution: 5000 },
      { id: "m-b", name: "B", account: 5000, toon: 0, contribution: 5000 },
    ];
    const ranked = buildOverlayRankedMembers(tiedMembers, {});
    expect(ranked.map((r) => r.m.id)).toEqual(["m-a", "m-b"]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("matches sortMembersForRanking when totals tie after 100원 버림", () => {
    const tiedMembers: Member[] = [
      { id: "m-a", name: "A", account: 5050, toon: 0, contribution: 5050 },
      { id: "m-b", name: "B", account: 5099, toon: 0, contribution: 5099 },
    ];
    const overlayOrder = buildOverlayRankedMembers(tiedMembers, {}).map((r) => r.m.id);
    const listOrder = sortMembersForRanking(tiedMembers, {}, { mode: "fixed" }).map((r) => r.id);
    expect(overlayOrder).toEqual(["m-a", "m-b"]);
    expect(listOrder).toEqual(["m-a", "m-b"]);
  });
});

describe("sortMembersForRanking", () => {
  it("keeps representative first and operating rows at bottom", () => {
    const rows = sortMembersForRanking(members, positions, { mode: "fixed" });
    expect(rows.map((r) => r.id)).toEqual(["rep", "m2", "m1", "ops"]);
    expect(rows[0]?.position).toBe("대표");
  });
});
