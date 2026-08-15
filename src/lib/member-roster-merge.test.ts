import { describe, expect, it } from "vitest";
import type { Member } from "@/types";
import {
  mergeManualMemberFieldsFromPatch,
  mergeMemberRosterPreservingAmounts,
  resolveMembersAgainstZeroWipe,
} from "./member-roster-merge";

const m = (partial: Partial<Member> & { id: string; name: string }): Member => ({
  account: 0,
  toon: 0,
  contribution: 0,
  restroom: 0,
  ...partial,
});

describe("member-roster-merge", () => {
  it("appends newly added members instead of dropping them", () => {
    const base = [m({ id: "a", name: "알파", account: 1000 })];
    const patch = [
      m({ id: "a", name: "알파", account: 1000 }),
      m({ id: "b", name: "신규", account: 0 }),
    ];
    const merged = mergeManualMemberFieldsFromPatch(base, patch);
    expect(merged.map((x) => x.id)).toEqual(["a", "b"]);
    expect(merged[1]?.name).toBe("신규");
  });

  it("does not append placeholder roster onto real members", () => {
    const base = [m({ id: "a", name: "알파", account: 1000 })];
    const patch = [
      m({ id: "m1", name: "멤버1" }),
      m({ id: "m2", name: "멤버2" }),
      m({ id: "m3", name: "멤버3" }),
    ];
    const merged = mergeManualMemberFieldsFromPatch(base, patch);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.name).toBe("알파");
  });

  it("accepts member add under zero-wipe with amounts preserved", () => {
    const base = [m({ id: "a", name: "알파", account: 5000, toon: 2000 })];
    const patch = [
      m({ id: "a", name: "알파", account: 0, toon: 0 }),
      m({ id: "b", name: "베타", account: 0, toon: 0 }),
    ];
    const result = resolveMembersAgainstZeroWipe({ baseMembers: base, patchMembers: patch });
    expect(result.blockedWipe).toBe(true);
    expect(result.rosterChanged).toBe(true);
    expect(result.members.map((x) => x.id)).toEqual(["a", "b"]);
    expect(result.members[0]?.account).toBe(5000);
    expect(result.members[0]?.toon).toBe(2000);
    expect(result.members[1]?.name).toBe("베타");
  });

  it("does not shrink roster on zero-wipe when patch is shorter", () => {
    const base = [
      m({ id: "a", name: "자키", account: 5000, toon: 2000 }),
      m({ id: "b", name: "수지", account: 0, toon: 0 }),
    ];
    const patch = [m({ id: "a", name: "자키", account: 0, toon: 0 })];
    const result = resolveMembersAgainstZeroWipe({ baseMembers: base, patchMembers: patch });
    expect(result.blockedWipe).toBe(true);
    expect(result.members.map((x) => x.id)).toEqual(["a", "b"]);
    expect(result.members[0]?.account).toBe(5000);
    expect(result.members[1]?.name).toBe("수지");
  });

  it("preserves amounts onto patch roster order", () => {
    const base = [m({ id: "a", name: "옛이름", account: 9000 })];
    const patch = [m({ id: "a", name: "새이름", account: 0 })];
    const merged = mergeMemberRosterPreservingAmounts(base, patch);
    expect(merged[0]?.name).toBe("새이름");
    expect(merged[0]?.account).toBe(9000);
  });

  it("keeps existing member totals when adding a new zero member", () => {
    const base = [
      m({ id: "a", name: "헛치", account: 10000, toon: 5000 }),
      m({ id: "b", name: "현민", account: 3000, toon: 0 }),
    ];
    const patch = [
      m({ id: "a", name: "헛치", account: 0, toon: 0 }),
      m({ id: "b", name: "현민", account: 0, toon: 0 }),
      m({ id: "c", name: "신규", account: 0, toon: 0 }),
    ];
    const merged = mergeMemberRosterPreservingAmounts(base, patch);
    expect(merged.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(merged[0]?.account).toBe(10000);
    expect(merged[0]?.toon).toBe(5000);
    expect(merged[1]?.account).toBe(3000);
    expect(merged[2]?.account).toBe(0);
  });
});
