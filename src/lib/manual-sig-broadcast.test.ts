import { describe, expect, it } from "vitest";
import {
  buildManualSigSalesConfirmState,
  buildManualSigSoldPersistState,
  findDisplaySigForManualDraftRow,
  hydrateManualOverlaySigItem,
  patchManualOverlaySigImagesFromDraft,
  pickRandomManualSigBundle,
  resolveManualDraftRowForSigItem,
  resolveManualOneShotDisplayFromState,
  resolveManualOneShotOverlayImageUrl,
  resolveManualOneShotStoredImageUrl,
  resolveManualOverlaySelectedSigs,
} from "@/lib/manual-sig-broadcast";
import { DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE } from "@/lib/constants";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { AppState, SigItem } from "@/types";

describe("patchManualOverlaySigImagesFromDraft", () => {
  it("fills empty selectedSigs.imageUrl from draft + inventory (dc4b569 regression)", () => {
    const inventory: SigItem[] = [
      {
        id: "sig_a",
        name: "독주",
        price: 21000,
        imageUrl: "/uploads/sigs/finalent/1730000000_abc12345.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const drafts = [
      { sourceSigId: "sig_a", name: "독주", priceInput: "21000", imageUrl: "" },
      { sourceSigId: "", name: "B", priceInput: "22000", imageUrl: "" },
      { sourceSigId: "", name: "C", priceInput: "23000", imageUrl: "" },
      { sourceSigId: "", name: "D", priceInput: "24000", imageUrl: "" },
      { sourceSigId: "", name: "E", priceInput: "25000", imageUrl: "" },
    ];
    const selected: SigItem[] = [
      {
        id: "manual_sig_1",
        name: "독주",
        price: 21000,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const out = patchManualOverlaySigImagesFromDraft(selected, drafts, inventory, "finalent");
    expect(out[0]?.imageUrl).toBe("/uploads/sigs/finalent/1730000000_abc12345.gif");
  });
});

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

  it("uses inventory upload URL when selected price differs from inventory", () => {
    const inventory: SigItem[] = [
      {
        id: "sig_naruto",
        name: "나루토",
        price: 35000,
        imageUrl: "/uploads/sigs/finalent/1730000000_abcd1234.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const item: SigItem = {
      id: "sig_naruto",
      name: "나루토",
      price: 40100,
      imageUrl: "/images/sig/naruto.png",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    };
    const out = hydrateManualOverlaySigItem(item, inventory, "finalent");
    expect(out.imageUrl).toBe("/uploads/sigs/finalent/1730000000_abcd1234.gif");
  });

  it("ignores legacy romanized imageUrl and uses from-drive by sig name", () => {
    const inventory: SigItem[] = [
      {
        id: "sig_ski",
        name: "스키",
        price: 32500,
        imageUrl: "/images/sigs/bogdance.png",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const item: SigItem = {
      id: "sig_ski",
      name: "스키",
      price: 32500,
      imageUrl: "/images/sig/bogdance.png",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    };
    const out = hydrateManualOverlaySigItem(item, inventory, "finalent");
    expect(out.imageUrl).toContain("/images/sigs/from-drive/");
    expect(out.imageUrl).toContain(encodeURIComponent("스키"));
  });

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

  it("ignores draft oneShotImageUrl when it matches a winner sig upload", () => {
    const state = {
      overlaySettings: {
        sigSalesManualDraftV1: {
          drafts: [],
          oneShotName: "한방 시그",
          oneShotPriceInput: "",
          oneShotImageUrl: "/uploads/sigs/finalent/winner.gif",
          sigSoldFlags: [],
          oneShotMarkSold: false,
        },
      },
    } as AppState;
    const stored = resolveManualOneShotStoredImageUrl({
      state,
      selectedSigs: [winner],
    });
    expect(stored).toContain("한방시그.gif");
    expect(stored).not.toContain("winner.gif");
  });

  it("prefers draft oneShotImageUrl when set", () => {
    const state = {
      overlaySettings: {
        sigSalesManualDraftV1: {
          drafts: [],
          oneShotName: "한방 시그",
          oneShotPriceInput: "",
          oneShotImageUrl: "/uploads/sigs/finalent/custom_한방.gif",
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
    expect(url).toContain("custom_한방.gif");
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

describe("pickRandomManualSigBundle", () => {
  const mkSig = (id: string, name: string, price: number): SigItem => ({
    id,
    name,
    price,
    imageUrl: "",
    memberId: "",
    maxCount: 1,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  });

  it("picks up to 4 when pool has only 4 active sigs", () => {
    const state = {
      sigInventory: [
        mkSig("s1", "A", 10000),
        mkSig("s2", "B", 20000),
        mkSig("s3", "C", 30000),
        mkSig("s4", "D", 40000),
      ],
      rouletteState: { phase: "IDLE" },
    } as AppState;
    const bundle = pickRandomManualSigBundle(state, "finalent");
    expect(bundle).not.toBeNull();
    expect(bundle!.selected.length).toBe(4);
    expect(bundle!.oneShot.price).toBeGreaterThan(0);
  });
});

describe("buildManualSigSalesConfirmState", () => {
  it("bumps soldCount for checked sigs", () => {
    const state = {
      sigInventory: [
        {
          id: "sig_a",
          name: "A",
          price: 10000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
      ],
      rouletteState: { phase: "LANDED", selectedSigs: [] },
    } as AppState;
    const selected: SigItem[] = [
      {
        id: "sig_a",
        name: "A",
        price: 10000,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
      {
        id: "sig_b",
        name: "B",
        price: 20000,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const next = buildManualSigSalesConfirmState(state, {
      selected,
      sigSoldFlags: [true, false, false, false, false],
      oneShotMarkSold: false,
    });
    const row = next.sigInventory?.find((x) => x.id === "sig_a");
    expect(row?.soldCount).toBe(1);
    expect(next.rouletteState?.phase).toBe("CONFIRMED");
  });

  it("confirms sold sig when draft slot index differs from display order", () => {
    const state = {
      sigInventory: [
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
      overlaySettings: {
        sigSalesManualDraftV1: {
          drafts: [
            { sourceSigId: "sig_b", name: "옴브리뉴", priceInput: "25200", imageUrl: "" },
            { sourceSigId: "sig_a", name: "픽션", priceInput: "24900", imageUrl: "" },
          ],
          oneShotName: "한방 시그",
          oneShotPriceInput: "",
          oneShotImageUrl: "",
          sigSoldFlags: [false, true, false, false, false],
          oneShotMarkSold: false,
        },
      },
      rouletteState: { phase: "LANDED", selectedSigs: [] },
    } as AppState;
    const selected: SigItem[] = [
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
    const next = buildManualSigSalesConfirmState(state, {
      selected,
      sigSoldFlags: [false, true, false, false, false],
      oneShotMarkSold: false,
      userId: "finalent",
    });
    expect(next.sigInventory?.find((x) => x.id === "sig_a")?.soldCount).toBe(1);
    expect(next.sigInventory?.find((x) => x.id === "sig_b")?.soldCount).toBe(0);
  });

  it("partial confirm keeps LANDED and does not double-count inventory", () => {
    const state = {
      sigInventory: [
        {
          id: "sig_a",
          name: "A",
          price: 10000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
        {
          id: "sig_b",
          name: "B",
          price: 20000,
          imageUrl: "",
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        },
      ],
      overlaySettings: {
        sigSalesManualDraftV1: {
          drafts: [],
          oneShotName: "한방",
          oneShotPriceInput: "",
          oneShotImageUrl: "",
          sigSoldFlags: [true, false, false, false, false],
          oneShotMarkSold: false,
        },
      },
      rouletteState: { phase: "LANDED", selectedSigs: [] },
    } as AppState;
    const selected: SigItem[] = [
      {
        id: "sig_a",
        name: "A",
        price: 10000,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 1,
        isRolling: true,
        isActive: false,
      },
      {
        id: "sig_b",
        name: "B",
        price: 20000,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const first = buildManualSigSalesConfirmState(state, {
      selected,
      sigSoldFlags: [true, false, false, false, false],
      oneShotMarkSold: false,
      previousSoldFlags: [false, false, false, false, false],
      closeRound: false,
    });
    expect(first.rouletteState?.phase).toBe("LANDED");
    expect(first.sigInventory?.find((x) => x.id === "sig_a")?.soldCount).toBe(1);

    const second = buildManualSigSalesConfirmState(first, {
      selected,
      sigSoldFlags: [true, true, false, false, false],
      oneShotMarkSold: false,
      previousSoldFlags: [true, false, false, false, false],
      closeRound: false,
    });
    expect(second.rouletteState?.phase).toBe("LANDED");
    expect(second.sigInventory?.find((x) => x.id === "sig_a")?.soldCount).toBe(1);
    expect(second.sigInventory?.find((x) => x.id === "sig_b")?.soldCount).toBe(1);
  });

  it("syncs oneShotResult price when sold flags are toggled", () => {
    const selected: SigItem[] = [
      {
        id: "sig_a",
        name: "A",
        price: 100_000,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
      {
        id: "sig_b",
        name: "B",
        price: 50_000,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const state = {
      overlaySettings: {
        sigSalesManualDraftV1: {
          drafts: [
            { sourceSigId: "sig_a", name: "A", priceInput: "100000", imageUrl: "" },
            { sourceSigId: "sig_b", name: "B", priceInput: "50000", imageUrl: "" },
          ],
          oneShotName: "한방 시그",
          oneShotPriceInput: "",
          oneShotImageUrl: "",
          sigSoldFlags: [false, false, false, false, false],
          oneShotMarkSold: false,
        },
      },
      rouletteState: {
        phase: "LANDED",
        selectedSigs: selected,
        oneShotResult: { id: ONE_SHOT_SIG_ID, name: "한방 시그", price: 150_000 },
      },
    } as AppState;
    const next = buildManualSigSoldPersistState(state, {
      sigSoldFlags: [true, false, false, false, false],
      oneShotMarkSold: false,
      userId: "finalent",
    });
    expect(next.rouletteState?.oneShotResult?.price).toBe(50_000);
    const display = resolveManualOneShotDisplayFromState(next, selected, "finalent");
    expect(display?.price).toBe(50_000);
  });
});
