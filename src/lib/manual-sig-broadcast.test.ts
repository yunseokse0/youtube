import { describe, expect, it } from "vitest";
import {
  findDisplaySigForManualDraftRow,
  hydrateManualOverlaySigItem,
  resolveManualDraftRowForSigItem,
  resolveManualOneShotOverlayImageUrl,
  resolveManualOverlaySelectedSigs,
} from "@/lib/manual-sig-broadcast";
import { DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE } from "@/lib/constants";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { AppState, SigItem } from "@/types";

describe("hydrateManualOverlaySigItem", () => {
  const inventory: SigItem[] = [
    {
      id: "sig_a",
      name: "독주",
      price: 21000,
      imageUrl: "/uploads/sigs/finalent/1730000000_abc12345.gif",
      memberId: "m1",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    },
  ];

  it("prefers inventory upload path over coerced /images/sigs flat path", () => {
    const item: SigItem = {
      id: "manual_sig_1",
      name: "독주",
      price: 21000,
      imageUrl: "/images/sigs/1730000000_abc12345.gif",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    };
    const out = hydrateManualOverlaySigItem(item, inventory, "finalent", {
      sourceSigId: "sig_a",
      imageUrl: "/images/sigs/1730000000_abc12345.gif",
    });
    expect(out.imageUrl).toBe("/uploads/sigs/finalent/1730000000_abc12345.gif");
    expect(out.memberId).toBe("");
  });
});

describe("resolveManualOneShotOverlayImageUrl", () => {
  const winner: SigItem = {
    id: "sig_win",
    name: "유튜버카누",
    price: 25200,
    imageUrl: "/uploads/sigs/finalent/winner.gif",
    memberId: "",
    maxCount: 1,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  };

  it("uses bundled 한방시그.gif instead of 당첨 시그 폴백", () => {
    const state = {
      sigInventory: [
        {
          id: ONE_SHOT_SIG_ID,
          name: "한방 시그",
          price: 0,
          imageUrl: "/images/sigs/from-drive/유튜버카누.gif",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: false,
          isActive: true,
        },
      ],
    } as AppState;
    const url = resolveManualOneShotOverlayImageUrl({
      state,
      selectedSigs: [winner],
      userId: "finalent",
    });
    expect(url).toContain("한방시그.gif");
    expect(url).not.toContain("winner.gif");
    expect(url).not.toContain("유튜버카누");
  });

  it("prefers draft oneShotImageUrl when set", () => {
    const state = {
      overlaySettings: {
        sigSalesManualDraftV1: {
          drafts: [],
          oneShotName: "한방 시그",
          oneShotPriceInput: "",
          oneShotImageUrl: "/uploads/sigs/finalent/custom_hanbang.gif",
          sigSoldFlags: [],
          oneShotMarkSold: false,
        },
      },
    } as AppState;
    const url = resolveManualOneShotOverlayImageUrl({
      state,
      selectedSigs: [winner],
      userId: "finalent",
    });
    expect(url).toContain("custom_hanbang.gif");
    expect(url).not.toContain(DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE.split("/").pop()!);
  });
});

describe("resolveManualDraftRowForSigItem", () => {
  it("matches by sourceSigId when draft row index differs from display order", () => {
    const drafts = [
      { sourceSigId: "sig_b", name: "옴브리뉴", priceInput: "25200", imageUrl: "/uploads/b.gif" },
      { sourceSigId: "sig_a", name: "픽션", priceInput: "24900", imageUrl: "/uploads/a.gif" },
    ];
    const row = resolveManualDraftRowForSigItem(
      {
        id: "sig_a",
        name: "픽션",
        price: 24900,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
      drafts
    );
    expect(row?.sourceSigId).toBe("sig_a");
    expect(row?.name).toBe("픽션");
  });

  it("resolveManualOverlaySelectedSigs does not swap images by draft index", () => {
    const inventory: SigItem[] = [
      {
        id: "sig_a",
        name: "픽션",
        price: 24900,
        imageUrl: "/uploads/sigs/finalent/a.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
      {
        id: "sig_b",
        name: "옴브리뉴",
        price: 25200,
        imageUrl: "/uploads/sigs/finalent/b.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const state = {
      sigInventory: inventory,
      overlaySettings: {
        sigSalesManualDraftV1: {
          drafts: [
            { sourceSigId: "sig_b", name: "옴브리뉴", priceInput: "25200", imageUrl: "" },
            { sourceSigId: "sig_a", name: "픽션", priceInput: "24900", imageUrl: "" },
          ],
          oneShotName: "한방 시그",
          oneShotPriceInput: "",
          oneShotImageUrl: "",
          sigSoldFlags: [],
          oneShotMarkSold: false,
        },
      },
      rouletteState: {
        phase: "LANDED",
        selectedSigs: [
          {
            id: "sig_a",
            name: "픽션",
            price: 24900,
            imageUrl: "",
            memberId: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: true,
            isActive: true,
          },
          {
            id: "sig_b",
            name: "옴브리뉴",
            price: 25200,
            imageUrl: "",
            memberId: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: true,
            isActive: true,
          },
        ],
      },
    } as AppState;
    const out = resolveManualOverlaySelectedSigs(state, "finalent");
    expect(out[0]?.name).toBe("픽션");
    expect(out[0]?.imageUrl).toBe("/uploads/sigs/finalent/a.gif");
    expect(out[1]?.name).toBe("옴브리뉴");
    expect(out[1]?.imageUrl).toBe("/uploads/sigs/finalent/b.gif");
  });

  it("findDisplaySigForManualDraftRow finds display card by draft sourceSigId", () => {
    const display: SigItem[] = [
      {
        id: "sig_a",
        name: "픽션",
        price: 24900,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
      {
        id: "sig_b",
        name: "옴브리뉴",
        price: 25200,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const hit = findDisplaySigForManualDraftRow(
      { sourceSigId: "sig_b", name: "옴브리뉴", priceInput: "25200", imageUrl: "" },
      { name: "옴브리뉴", price: 25200, imageUrl: "" },
      display
    );
    expect(hit?.id).toBe("sig_b");
  });
});
