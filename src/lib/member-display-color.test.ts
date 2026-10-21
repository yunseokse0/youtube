import { describe, expect, it } from "vitest";
import {
  MEMBER_DISPLAY_COLOR_PALETTE,
  resolveMemberDisplayColor,
} from "@/lib/member-display-color";

describe("resolveMemberDisplayColor", () => {
  it("returns stable color for the same member id", () => {
    const a = resolveMemberDisplayColor("mem_alpha");
    const b = resolveMemberDisplayColor("mem_alpha");
    expect(a).toBe(b);
    expect(MEMBER_DISPLAY_COLOR_PALETTE).toContain(a);
  });

  it("prefers override / colorByMemberId", () => {
    expect(resolveMemberDisplayColor("m1", { override: "#ff0000" })).toBe("#ff0000");
    expect(
      resolveMemberDisplayColor("m1", { colorByMemberId: { m1: "#00ff00" } })
    ).toBe("#00ff00");
  });

  it("uses roster index when provided", () => {
    const ids = ["a", "b", "c"];
    expect(resolveMemberDisplayColor("a", { memberIds: ids })).toBe(
      MEMBER_DISPLAY_COLOR_PALETTE[0]
    );
    expect(resolveMemberDisplayColor("c", { memberIds: ids })).toBe(
      MEMBER_DISPLAY_COLOR_PALETTE[2]
    );
  });

  it("assigns different colors across a small roster", () => {
    const ids = ["m0", "m1", "m2", "m3"];
    const colors = ids.map((id) => resolveMemberDisplayColor(id, { memberIds: ids }));
    expect(new Set(colors).size).toBe(4);
  });
});
