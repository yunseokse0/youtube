import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import type { AppState, Member } from "@/types";
import { mergeDonationApplyBase } from "./merge-donation-apply-base";

function members(names: string[]): Member[] {
  return names.map((name, idx) => ({
    id: `m${idx + 1}`,
    name,
    account: 0,
    toon: 0,
    contribution: 0,
  }));
}

describe("mergeDonationApplyBase", () => {
  it("keeps hint donors when server GET returns empty donors", () => {
    const hint: AppState = {
      ...defaultState(),
      members: members(["BT태호", "홍쓰"]),
      donors: [
        {
          id: "toonation:keep-1",
          name: "엔젤",
          amount: 50000,
          memberId: "m1",
          at: Date.now(),
          target: "toon",
        },
      ],
    };
    const fresh: AppState = {
      ...defaultState(),
      members: members(["멤버1", "멤버2", "멤버3"]),
      donors: [],
      updatedAt: Date.now() + 9999,
    };
    const merged = mergeDonationApplyBase(fresh, hint);
    expect(merged?.donors).toHaveLength(1);
    expect(merged?.donors[0]?.id).toBe("toonation:keep-1");
    expect(merged?.members.map((m) => m.name)).toEqual(["BT태호", "홍쓰"]);
  });

  it("unions donors from both snapshots with hint winning same id", () => {
    const hint: AppState = {
      ...defaultState(),
      members: members(["A"]),
      donors: [
        {
          id: "d1",
          name: "hint",
          amount: 1000,
          memberId: "m1",
          at: 2000,
          target: "toon",
        },
      ],
    };
    const fresh: AppState = {
      ...defaultState(),
      members: members(["A"]),
      donors: [
        {
          id: "d2",
          name: "fresh",
          amount: 2000,
          memberId: "m1",
          at: 3000,
          target: "toon",
        },
      ],
    };
    const merged = mergeDonationApplyBase(fresh, hint);
    expect(merged?.donors.map((d) => d.id).sort()).toEqual(["d1", "d2"]);
  });

  it("keeps hint overlay theme when server snapshot is default", () => {
    const hint: AppState = {
      ...defaultState(),
      members: members(["A"]),
      overlayPresets: [
        {
          id: "ov1",
          name: "방송",
          theme: "excelLive",
          membersTheme: "excelLive",
          totalTheme: "excelLive",
        } as AppState["overlayPresets"][number],
      ],
    };
    const fresh: AppState = {
      ...defaultState(),
      members: members(["A"]),
      overlayPresets: [{ id: "ov0", name: "기본", theme: "default" } as AppState["overlayPresets"][number]],
      updatedAt: Date.now() + 5000,
    };
    const merged = mergeDonationApplyBase(fresh, hint);
    expect(merged?.overlayPresets?.[0]?.theme).toBe("excelLive");
  });
});
