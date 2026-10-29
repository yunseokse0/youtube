import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { MANUAL_SIG_BROADCAST_STATE_KEY } from "@/lib/manual-sig-broadcast-state";
import { MANUAL_SIG_DRAFT_STATE_KEY } from "@/lib/manual-sig-workbench";
import { resolveSigNeonMenuOverlayItems } from "@/lib/sig-neon-menu-items";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";

describe("resolveSigNeonMenuOverlayItems", () => {
  it("uses rolled LANDED picks so reroll updates neon board", () => {
    const base = defaultState();
    const state = {
      ...base,
      sigInventory: [
        {
          id: "s1",
          name: "알파",
          price: 10_000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
        {
          id: "s2",
          name: "베타",
          price: 20_000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
        {
          id: "s3",
          name: "감마",
          price: 30_000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
        {
          id: ONE_SHOT_SIG_ID,
          name: "한방",
          price: 99_000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: false,
          isActive: true,
        },
      ],
      overlaySettings: {
        sigSalesManualPickCount: 2,
        [MANUAL_SIG_BROADCAST_STATE_KEY]: {
          phase: "LANDED",
          selectedSigs: [
            {
              id: "s2",
              name: "베타",
              price: 20_000,
              imageUrl: "",
              memberId: "",
              maxCount: 1,
              soldCount: 0,
              isRolling: true,
              isActive: true,
            },
            {
              id: "s1",
              name: "알파",
              price: 10_000,
              imageUrl: "",
              memberId: "",
              maxCount: 1,
              soldCount: 0,
              isRolling: true,
              isActive: true,
            },
          ],
          oneShotResult: { id: ONE_SHOT_SIG_ID, name: "한방", price: 99_000 },
          overlayReloadNonce: 3,
        },
        [MANUAL_SIG_DRAFT_STATE_KEY]: {
          drafts: [
            { sourceSigId: "s2", name: "베타", priceInput: "22200", imageUrl: "" },
            { sourceSigId: "s1", name: "알파", priceInput: "11100", imageUrl: "" },
          ],
          oneShotName: "한방",
          oneShotPriceInput: "99000",
          oneShotImageUrl: "",
          sigSoldFlags: [true, false],
          oneShotMarkSold: false,
          sigBuyerMemberIds: ["m1", null],
        },
      },
      members: [{ id: "m1", name: "수린", account: 0, toon: 0, contribution: 0 }],
    };
    const items = resolveSigNeonMenuOverlayItems(state, "din");
    expect(items).toHaveLength(2);
    expect(items.map((x) => x.name)).toEqual(["베타", "알파"]);
    expect(items[0]?.price).toBe(22_200);
    expect(items[0]?.sold).toBe(true);
    expect(items[0]?.buyerName).toBe("수린");
    expect(items[1]?.sold).toBe(false);
  });

  it("falls back to full active pool when idle", () => {
    const state = {
      ...defaultState(),
      sigInventory: [
        {
          id: "s1",
          name: "전체A",
          price: 5_000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
        {
          id: "s2",
          name: "전체B",
          price: 8_000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
      ],
      overlaySettings: {
        [MANUAL_SIG_BROADCAST_STATE_KEY]: { phase: "IDLE", selectedSigs: [], overlayReloadNonce: 0 },
      },
    };
    const items = resolveSigNeonMenuOverlayItems(state, "din");
    expect(items.map((x) => x.name).sort()).toEqual(["전체A", "전체B"]);
  });
});
