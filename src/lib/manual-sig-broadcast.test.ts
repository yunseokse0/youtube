import { describe, expect, it } from "vitest";
import { resolveManualOneShotOverlayImageUrl } from "@/lib/manual-sig-broadcast";
import { MANUAL_SIG_DRAFT_STATE_KEY } from "@/lib/manual-sig-workbench";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { AppState } from "@/types";

describe("resolveManualOneShotOverlayImageUrl", () => {
  it("prefers sig_one_shot inventory image over first winner", () => {
    const state = {
      sigInventory: [
        { id: ONE_SHOT_SIG_ID, name: "한방", price: 1, imageUrl: "/uploads/oneshot.gif", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
        { id: "sig_a", name: "곡선", price: 1, imageUrl: "/uploads/curve.gif", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
      ],
    } as unknown as AppState;
    const url = resolveManualOneShotOverlayImageUrl({
      state,
      selectedSigs: [{ id: "sig_a", name: "곡선", price: 24900, imageUrl: "/uploads/curve.gif", maxCount: 1, soldCount: 0, isRolling: true, isActive: true }],
      userId: "finalent",
    });
    expect(url).toContain("oneshot.gif");
    expect(url).not.toContain("curve.gif");
  });

  it("uses manual draft oneShotImageUrl when inventory empty", () => {
    const state = {
      sigInventory: [{ id: ONE_SHOT_SIG_ID, name: "한방", price: 1, imageUrl: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true }],
      overlaySettings: {
        [MANUAL_SIG_DRAFT_STATE_KEY]: {
          drafts: [],
          oneShotName: "한방",
          oneShotPriceInput: "",
          oneShotImageUrl: "/images/sigs/hanbang.gif",
          sigSoldFlags: [],
          oneShotMarkSold: false,
        },
      },
    } as unknown as AppState;
    const url = resolveManualOneShotOverlayImageUrl({
      state,
      selectedSigs: [],
      userId: "finalent",
    });
    expect(url).toContain("hanbang.gif");
  });
});
