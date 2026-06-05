import { describe, expect, it } from "vitest";
import { buildSigSalesManualApiPatch, defaultState } from "@/lib/state";
import { MANUAL_SIG_DRAFT_STATE_KEY } from "@/lib/manual-sig-workbench";
import { MANUAL_OVERLAY_SESSION_ID } from "@/lib/sig-sales-manual-round";
import type { AppState } from "@/types";

describe("buildSigSalesManualApiPatch", () => {
  it("does not include members donors or overlayPresets", () => {
    const base = defaultState();
    const next: AppState = {
      ...base,
      members: [{ id: "m1", name: "패자", account: 0, toon: 0, contribution: 0 }],
      donors: [{ id: "d1", name: "후원", amount: 1000, memberId: "m1", at: 1 }],
      overlayPresets: [{ id: "ov1", name: "테스트" }],
      sigInventory: [{ id: "s1", name: "A", price: 1, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true }],
      overlaySettings: {
        [MANUAL_SIG_DRAFT_STATE_KEY]: {
          inputMode: "inventory",
          drafts: [],
          oneShotName: "한방",
          oneShotPriceInput: "100",
          oneShotImageUrl: "/images/sigs/한방시그.gif",
          sigSoldFlags: [false, false, false, false, false],
          oneShotMarkSold: false,
        },
      },
      rouletteState: {
        ...base.rouletteState,
        phase: "LANDED",
        sessionId: MANUAL_OVERLAY_SESSION_ID,
        selectedSigs: [{ id: "s1", name: "A", price: 1, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true }],
      },
      updatedAt: 123,
    };
    const patch = buildSigSalesManualApiPatch(next, "finalent") as Record<string, unknown>;
    expect(patch.members).toBeUndefined();
    expect(patch.donors).toBeUndefined();
    expect(patch.overlayPresets).toBeUndefined();
    expect(Array.isArray(patch.sigInventory)).toBe(true);
    expect(patch.rouletteState).toBeTruthy();
  });
});
