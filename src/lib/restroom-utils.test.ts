import { describe, expect, it } from "vitest";
import {
  applyRestroomCountDelta,
  buildRestroomMemberUpdate,
  normalizeRestroomCount,
} from "./restroom-utils";
import type { Member } from "@/types";

const members: Member[] = [
  { id: "m1", name: "A", account: 1000, toon: 0, contribution: 1000, restroom: 5 },
];

describe("restroom-utils", () => {
  it("normalizeRestroomCount treats 0 as zero", () => {
    expect(normalizeRestroomCount(0)).toBe(0);
    expect(normalizeRestroomCount("0")).toBe(0);
    expect(normalizeRestroomCount("")).toBe(0);
  });

  it("applyRestroomCountDelta can reach zero", () => {
    expect(applyRestroomCountDelta(3, -1, 3)).toBe(0);
    expect(applyRestroomCountDelta(2, -1, 5)).toBe(0);
    expect(applyRestroomCountDelta(0, -1, 1)).toBe(0);
  });

  it("buildRestroomMemberUpdate sets absolute zero", () => {
    const { members: next, log, changed } = buildRestroomMemberUpdate(members, "m1", 0, "초기화");
    expect(changed).toBe(true);
    expect(next[0]?.restroom).toBe(0);
    expect(log?.delta).toBe(-1);
    expect(log?.amount).toBe(5);
  });

  it("buildRestroomMemberUpdate is no-op when already zero", () => {
    const base = [{ ...members[0]!, restroom: 0 }];
    const { changed, log } = buildRestroomMemberUpdate(base, "m1", 0);
    expect(changed).toBe(false);
    expect(log).toBeNull();
  });
});
