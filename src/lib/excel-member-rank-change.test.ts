import { describe, expect, it } from "vitest";
import type { Member } from "@/types";
import {
  buildMemberRankSnapshot,
  detectRankImprovement,
  isMemberRankChangeFxEnabled,
} from "@/lib/excel-member-rank-change";

const m = (id: string, name: string): Member => ({
  id,
  name,
  account: 0,
  toon: 0,
  contribution: 0,
});

describe("excel-member-rank-change", () => {
  it("buildMemberRankSnapshot maps member ids to ranks", () => {
    const snap = buildMemberRankSnapshot([
      { m: m("rep", "대표"), rank: null },
      { m: m("a", "A"), rank: 1 },
      { m: m("b", "B"), rank: 2 },
    ]);
    expect(snap.get("rep")).toBeNull();
    expect(snap.get("a")).toBe(1);
    expect(snap.get("b")).toBe(2);
  });

  it("detects rank improvement", () => {
    const prev = buildMemberRankSnapshot([
      { m: m("a", "A"), rank: 1 },
      { m: m("b", "BJ 아리"), rank: 2 },
      { m: m("c", "C"), rank: 3 },
    ]);
    const next = buildMemberRankSnapshot([
      { m: m("a", "A"), rank: 1 },
      { m: m("c", "C"), rank: 2 },
      { m: m("b", "BJ 아리"), rank: 3 },
    ]);
    const members = new Map([
      ["a", m("a", "A")],
      ["b", m("b", "BJ 아리")],
      ["c", m("c", "C")],
    ]);
    expect(detectRankImprovement(prev, next, members)).toEqual({
      memberId: "c",
      memberName: "C",
      oldRank: 3,
      newRank: 2,
      delta: 1,
    });
  });

  it("picks largest climb when multiple improve", () => {
    const prev = buildMemberRankSnapshot([
      { m: m("a", "A"), rank: 1 },
      { m: m("b", "B"), rank: 4 },
      { m: m("c", "C"), rank: 5 },
    ]);
    const next = buildMemberRankSnapshot([
      { m: m("b", "B"), rank: 2 },
      { m: m("a", "A"), rank: 1 },
      { m: m("c", "C"), rank: 3 },
    ]);
    const members = new Map([
      ["a", m("a", "A")],
      ["b", m("b", "B")],
      ["c", m("c", "C")],
    ]);
    const hit = detectRankImprovement(prev, next, members);
    expect(hit?.memberId).toBe("b");
    expect(hit?.delta).toBe(2);
  });

  it("ignores first snapshot and rank drops", () => {
    const next = buildMemberRankSnapshot([{ m: m("a", "A"), rank: 1 }]);
    const members = new Map([["a", m("a", "A")]]);
    expect(detectRankImprovement(null, next, members)).toBeNull();

    const prev = buildMemberRankSnapshot([{ m: m("a", "A"), rank: 1 }]);
    const dropped = buildMemberRankSnapshot([{ m: m("a", "A"), rank: 2 }]);
    expect(detectRankImprovement(prev, dropped, members)).toBeNull();
  });

  it("isMemberRankChangeFxEnabled defaults on", () => {
    expect(isMemberRankChangeFxEnabled(undefined)).toBe(true);
    expect(isMemberRankChangeFxEnabled("off")).toBe(false);
  });
});
