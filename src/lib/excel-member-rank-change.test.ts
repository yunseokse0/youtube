import { describe, expect, it } from "vitest";
import type { Member } from "@/types";
import {
  buildMemberRankSnapshot,
  buildRankChangeSessionSnapshot,
  detectRankImprovement,
  detectRankImprovementForFx,
  isMemberRankChangeFxEnabled,
  isRankImprovementFromDonationDeletion,
} from "@/lib/excel-member-rank-change";

const m = (id: string, name: string, account = 0, toon = 0): Member => ({
  id,
  name,
  account,
  toon,
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

  it("detectRankImprovementForFx ignores rank up from donation deletion shuffle", () => {
    const prevRank = buildMemberRankSnapshot([
      { m: m("a", "A", 5000), rank: 1 },
      { m: m("b", "B", 3000), rank: 2 },
      { m: m("c", "C", 1000), rank: 3 },
    ]);
    const nextRank = buildMemberRankSnapshot([
      { m: m("a", "A", 5000), rank: 1 },
      { m: m("c", "C", 1000), rank: 2 },
      { m: m("b", "B", 0), rank: 3 },
    ]);
    const prevMembers = [m("a", "A", 5000), m("b", "B", 3000), m("c", "C", 1000)];
    const nextMembers = [m("a", "A", 5000), m("b", "B", 0), m("c", "C", 1000)];
    const prevSession = buildRankChangeSessionSnapshot(prevMembers, [{ id: "d1" }, { id: "d2" }, { id: "d3" }]);
    const nextSession = buildRankChangeSessionSnapshot(nextMembers, [{ id: "d1" }, { id: "d3" }]);
    const members = new Map([
      ["a", nextMembers[0]!],
      ["b", nextMembers[1]!],
      ["c", nextMembers[2]!],
    ]);
    const raw = detectRankImprovement(prevRank, nextRank, members);
    expect(raw?.memberId).toBe("c");
    expect(
      detectRankImprovementForFx(prevRank, nextRank, members, prevSession, nextSession)
    ).toBeNull();
    expect(
      isRankImprovementFromDonationDeletion(prevSession, nextSession, raw!)
    ).toBe(true);
  });

  it("detectRankImprovementForFx allows rank up when member gained donation", () => {
    const prevRank = buildMemberRankSnapshot([
      { m: m("a", "A", 5000), rank: 1 },
      { m: m("b", "B", 3000), rank: 2 },
    ]);
    const nextRank = buildMemberRankSnapshot([
      { m: m("b", "B", 6000), rank: 1 },
      { m: m("a", "A", 5000), rank: 2 },
    ]);
    const prevMembers = [m("a", "A", 5000), m("b", "B", 3000)];
    const nextMembers = [m("a", "A", 5000), m("b", "B", 6000)];
    const prevSession = buildRankChangeSessionSnapshot(prevMembers, [{ id: "d1" }, { id: "d2" }]);
    const nextSession = buildRankChangeSessionSnapshot(nextMembers, [{ id: "d1" }, { id: "d2" }, { id: "d3" }]);
    const members = new Map([
      ["a", nextMembers[0]!],
      ["b", nextMembers[1]!],
    ]);
    const hit = detectRankImprovementForFx(prevRank, nextRank, members, prevSession, nextSession);
    expect(hit?.memberId).toBe("b");
    expect(hit?.newRank).toBe(1);
  });
});
