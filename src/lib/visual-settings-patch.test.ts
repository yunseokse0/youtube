import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultState, loadState, saveVisualSettingsPatchAsync, storageKey } from "@/lib/state";

describe("saveVisualSettingsPatchAsync", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", {
      localStorage: ls,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      fetch: vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, updatedAt: Date.now() }) })),
    });
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      }
    );
  });

  it("keeps donation totals when foundation has empty donors but LS has amounts", async () => {
    const userId = "visual-patch-test";
    const rich = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 60000, toon: 0, contribution: 60000 }],
      donors: [
        {
          id: "d1",
          name: "익명5",
          amount: 60000,
          memberId: "m1",
          at: Date.now(),
          target: "account" as const,
        },
      ],
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(rich));

    const emptyFoundation = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
      donorRankingsTheme: {
        ...defaultState().donorRankingsTheme,
        amountColor: "#ff0000",
      },
      updatedAt: Date.now(),
    };

    await saveVisualSettingsPatchAsync(
      { donorRankingsTheme: emptyFoundation.donorRankingsTheme },
      userId,
      emptyFoundation
    );

    const saved = loadState(userId);
    expect(saved.donors).toHaveLength(1);
    expect(saved.members[0]?.account).toBe(60000);
    expect(saved.donorRankingsTheme.amountColor).toBe("#ff0000");
  });

  it("keeps expanded sig inventory when foundation has default inventory", async () => {
    const userId = "visual-patch-sig-inv";
    const rich = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 1000, toon: 0, contribution: 1000 }],
      sigInventory: [
        { id: "s1", name: "버터플라이", price: 1000000, imageUrl: "/a.gif", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
        { id: "s2", name: "하트", price: 5000, imageUrl: "/b.gif", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
        { id: "s3", name: "댄스", price: 3000, imageUrl: "/c.gif", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      ],
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(rich));

    const emptyFoundation = {
      ...defaultState(),
      members: rich.members,
      donorRankingsTheme: {
        ...defaultState().donorRankingsTheme,
        amountColor: "#00ff00",
      },
      updatedAt: Date.now(),
    };

    await saveVisualSettingsPatchAsync(
      { donorRankingsTheme: emptyFoundation.donorRankingsTheme },
      userId,
      emptyFoundation
    );

    const saved = loadState(userId);
    expect(saved.sigInventory?.some((x) => x.id === "s1")).toBe(true);
    expect((saved.sigInventory || []).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps custom timer font color when saving other visual options", async () => {
    const userId = "visual-patch-timer-color";
    const rich = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 1000, toon: 0, contribution: 1000 }],
      timerDisplayStyles: {
        general: {
          ...defaultState().timerDisplayStyles.general,
          fontColor: "#ff66aa",
          bgColor: "#112233",
        },
      },
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(rich));

    const foundationWithoutTimerColors = {
      ...defaultState(),
      members: rich.members,
      donorRankingsTheme: {
        ...defaultState().donorRankingsTheme,
        nameColor: "#abcdef",
      },
      updatedAt: Date.now(),
    };

    await saveVisualSettingsPatchAsync(
      { donorRankingsTheme: foundationWithoutTimerColors.donorRankingsTheme },
      userId,
      foundationWithoutTimerColors
    );

    const saved = loadState(userId);
    expect(saved.timerDisplayStyles.general.fontColor).toBe("#ff66aa");
    expect(saved.timerDisplayStyles.general.bgColor).toBe("#112233");
    expect(saved.donorRankingsTheme.nameColor).toBe("#abcdef");
  });
});
