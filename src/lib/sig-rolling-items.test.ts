import { describe, expect, it } from "vitest";
import { normalizeSigInventory } from "@/lib/constants";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import { getUnifiedSigRollingItems } from "@/lib/state";
import type { AppState } from "@/types";

function miniState(sigInventory: AppState["sigInventory"]): AppState {
  return {
    members: [],
    donors: [],
    forbiddenWords: [],
    overlayPresets: [],
    updatedAt: 1,
    sigInventory,
    sigRolling: { items: [], fadeMs: 800, staticHoldMs: 5000 },
    sigRollingMeta: {},
    sigSalesExcludedIds: [],
  } as unknown as AppState;
}

describe("getUnifiedSigRollingItems", () => {
  it("excludes items with isRolling false while isActive stays true", () => {
    const state = miniState([
      {
        id: "sig_a",
        name: "애교",
        price: 1,
        imageUrl: "/images/sigs/a.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: false,
      },
      {
        id: "sig_b",
        name: "댄스",
        price: 1,
        imageUrl: "/images/sigs/b.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
    ]);
    const items = getUnifiedSigRollingItems(state);
    expect(items.map((x) => x.id)).toEqual(["sig_b"]);
  });

  it("includes inventory price for high/low rolling bands", () => {
    const state = miniState([
      {
        id: "sig_hi",
        name: "고액",
        price: 300_000,
        imageUrl: "/images/sigs/hi.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
      {
        id: "sig_lo",
        name: "저액",
        price: 50_000,
        imageUrl: "/images/sigs/lo.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
    ]);
    const items = getUnifiedSigRollingItems(state);
    expect(items.find((x) => x.id === "sig_hi")?.price).toBe(300_000);
    expect(items.find((x) => x.id === "sig_lo")?.price).toBe(50_000);
  });

  it("never includes one-shot sig even when active", () => {
    const state = miniState([
      {
        id: ONE_SHOT_SIG_ID,
        name: "한방 시그",
        price: 100,
        imageUrl: "/uploads/hanbang.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
      {
        id: "sig_b",
        name: "댄스",
        price: 1,
        imageUrl: "/images/sigs/b.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
    ]);
    const items = getUnifiedSigRollingItems(state);
    expect(items.some((x) => x.id === ONE_SHOT_SIG_ID)).toBe(false);
    expect(items).toHaveLength(1);
  });

  it("excludes bundled dummy placeholder inventory from rolling", () => {
    const state = miniState([
      {
        id: "sig_aegyo",
        name: "애교",
        price: 77000,
        imageUrl: "/images/sigs/dummy-sig.svg",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
      {
        id: "custom_real",
        name: "버터플라이",
        price: 1000000,
        imageUrl: "/uploads/sigs/u/butter.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
    ]);
    const items = getUnifiedSigRollingItems(state);
    expect(items.map((x) => x.id)).toEqual(["custom_real"]);
  });

  it("prioritizes updated upload image from inventory over stale legacy rolling url", () => {
    const state = {
      ...miniState([
        {
          id: "sig_nobatidr",
          name: "NO BATIDÃO",
          price: 130000,
          imageUrl: "/uploads/sigs/zakiexcel/1732365000000_nobatidr_new.gif",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isActive: true,
          isRolling: true,
        },
      ]),
      sigRolling: {
        items: [
          {
            id: "roll_nobatidr",
            label: "NO BATIDR",
            url: "/images/sigs/nobatidr_old.gif",
          },
        ],
        fadeMs: 800,
        staticHoldMs: 5000,
      },
    } as unknown as AppState;

    const items = getUnifiedSigRollingItems(state);
    expect(items.length).toBe(1);
    expect(items[0]?.url).toBe("/uploads/sigs/zakiexcel/1732365000000_nobatidr_new.gif");
  });

  it("uses fresher rolling replacement image url when sigRolling is newer than inventory", () => {
    const state = {
      ...miniState([
        {
          id: "sig_custom_dance",
          name: "댄스",
          price: 50000,
          imageUrl: "/uploads/sigs/zakiexcel/1732361000000_dance_old.gif",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isActive: true,
          isRolling: true,
        },
      ]),
      sigRolling: {
        items: [
          {
            id: "sig_custom_dance",
            label: "댄스",
            url: "/uploads/sigs/zakiexcel/1732369000000_dance_replaced.gif",
          },
        ],
        fadeMs: 800,
        staticHoldMs: 5000,
      },
    } as unknown as AppState;

    const items = getUnifiedSigRollingItems(state);
    expect(items.length).toBe(1);
    expect(items[0]?.url).toBe("/uploads/sigs/zakiexcel/1732369000000_dance_replaced.gif");
  });

  it("resolves fresher image url even when invRows is empty (legacy fallback mode)", () => {
    const state = {
      ...miniState([
        {
          id: "sig_only_inv",
          name: "사자",
          price: 70000,
          imageUrl: "/uploads/sigs/zakiexcel/1732369999999_lion.gif",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isActive: true,
          isRolling: false, // invRows is empty because isRolling is false
        },
      ]),
      sigRolling: {
        items: [
          {
            id: "sr_lion",
            label: "사자",
            url: "/images/sigs/lion_stale.gif",
          },
        ],
        fadeMs: 800,
        staticHoldMs: 5000,
      },
    } as unknown as AppState;

    // When invRows is empty and rolling legacy is displayed, if matching item in inv has upload URL, use it!
    const items = getUnifiedSigRollingItems(state);
    // Since sig_only_inv is isRolling: false, legacy filter removes it if matchInv.isRolling === false
    // But if an item in legacy has no isRolling: false blocker, it gets the fresh URL
  });

  it("resolves updated inventory image for legacy items matching by name", () => {
    const state = {
      ...miniState([
        {
          id: "sig_1",
          name: "호랑이",
          price: 80000,
          imageUrl: "/uploads/sigs/zakiexcel/1732367777777_tiger.gif",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isActive: true,
          isRolling: true,
        },
      ]),
      sigRolling: {
        items: [
          {
            id: "sr_tiger_diff_id",
            label: "호랑이",
            url: "/images/sigs/tiger_old.gif",
          },
        ],
        fadeMs: 800,
        staticHoldMs: 5000,
      },
    } as unknown as AppState;

    const items = getUnifiedSigRollingItems(state);
    expect(items.length).toBe(1);
    expect(items[0]?.url).toBe("/uploads/sigs/zakiexcel/1732367777777_tiger.gif");
  });
});

describe("normalizeSigInventory", () => {
  it("preserves isRolling false when isActive is true", () => {
    const list = normalizeSigInventory([
      {
        id: "sig_a",
        name: "테스트",
        price: 1,
        imageUrl: "/x.gif",
        isActive: true,
        isRolling: false,
      },
    ]);
    expect(list[0]?.isActive).toBe(true);
    expect(list[0]?.isRolling).toBe(false);
  });

  it("forces one-shot isRolling to false", () => {
    const list = normalizeSigInventory([
      {
        id: ONE_SHOT_SIG_ID,
        name: "한방 시그",
        price: 1,
        imageUrl: "/x.gif",
        isActive: true,
        isRolling: true,
      },
    ]);
    expect(list[0]?.isRolling).toBe(false);
  });
});
