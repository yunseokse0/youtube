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
