import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import type { AppState, Member } from "@/types";
import {
  enrichStateBeforeAuthoritativeDonationSave,
  mergeDonationApplyBase,
} from "./merge-donation-apply-base";

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

  it("keeps newer settlementResetAt from server when hint has stale stamp", () => {
    const hint: AppState = {
      ...defaultState(),
      members: members(["A"]),
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 10000,
          memberId: "m1",
          at: 1000,
          target: "account",
        },
      ],
      settlementResetAt: 5_000,
    };
    const fresh: AppState = {
      ...defaultState(),
      members: members(["A"]),
      donors: [],
      settlementResetAt: 20_000,
      updatedAt: 20_000,
    };
    const merged = mergeDonationApplyBase(fresh, hint);
    expect(merged?.settlementResetAt).toBe(20_000);
    expect(merged?.donors).toHaveLength(1);
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
    /** 힌트 멤버 금액이 0이어도 병합 donors 합계로 엑셀 금액 반영 */
    expect(merged?.members.find((m) => m.id === "m1")?.toon).toBe(3000);
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

describe("enrichStateBeforeAuthoritativeDonationSave", () => {
  it("prevents unmatched-apply wipe when API apply base lost prior donors", () => {
    const prior: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "BT태호", account: 0, toon: 120000, contribution: 120000 },
        { id: "m2", name: "연비서", account: 100000, toon: 0, contribution: 100000 },
      ],
      donors: [
        {
          id: "toonation:old-1",
          name: "철수",
          amount: 120000,
          memberId: "m1",
          at: 1,
          target: "toon",
        },
        {
          id: "toonation:old-2",
          name: "익명",
          amount: 100000,
          memberId: "m2",
          at: 2,
          target: "account",
        },
      ],
    };
    /** 미매칭 반영 직후 — GET 빈 스냅샷 위에 새 1건만 있는 상태 */
    const appliedOnlyNew: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "BT태호", account: 0, toon: 1000, contribution: 1000 },
        { id: "m2", name: "연비서", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [
        {
          id: "toonation:new-unmatched",
          name: "후원",
          amount: 1000,
          memberId: "m1",
          at: 3,
          target: "toon",
        },
      ],
    };
    const emptyApi: AppState = { ...defaultState(), donors: [], members: members(["BT태호", "연비서"]) };
    const enriched = enrichStateBeforeAuthoritativeDonationSave(appliedOnlyNew, [prior, emptyApi]);
    expect(enriched.donors.map((d) => d.id).sort()).toEqual([
      "toonation:new-unmatched",
      "toonation:old-1",
      "toonation:old-2",
    ]);
    expect(enriched.members.find((m) => m.id === "m1")?.toon).toBe(121000);
    expect(enriched.members.find((m) => m.id === "m2")?.account).toBe(100000);
  });

  it("keeps applied roster when server members share names but different ids", () => {
    const applied: AppState = {
      ...defaultState(),
      members: [
        { id: "admin-bt", name: "BT태호", account: 0, toon: 100000, contribution: 100000 },
        { id: "admin-yb", name: "연비서", account: 100000, toon: 0, contribution: 100000 },
      ],
      donors: [
        {
          id: "d-toon",
          name: "철수",
          amount: 100000,
          memberId: "admin-bt",
          at: 10,
          target: "toon",
        },
        {
          id: "d-acc",
          name: "익명",
          amount: 100000,
          memberId: "admin-yb",
          at: 9,
          target: "account",
        },
      ],
    };
    /** 서버 GET — 이름은 같으나 id 가 m1/m2 (엑셀 0 버그의 원인) */
    const serverRoster: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "BT태호", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "연비서", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [],
      updatedAt: Date.now() + 99999,
    };
    const enriched = enrichStateBeforeAuthoritativeDonationSave(applied, [serverRoster]);
    expect(enriched.members.find((m) => m.id === "admin-bt")?.toon).toBe(100000);
    expect(enriched.members.find((m) => m.id === "admin-yb")?.account).toBe(100000);
    expect(enriched.members.some((m) => m.id === "m1")).toBe(false);
  });
});
