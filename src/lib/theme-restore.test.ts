import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import type { AppState } from "@/types";
import {
  applyThemeRestorePatch,
  describeOverlayThemeLabel,
  pickBestThemeRestoreCandidate,
  scoreThemeRestoreFields,
  shouldOfferThemeRestore,
  type ThemeRestoreCandidate,
} from "@/lib/theme-restore";

describe("theme-restore", () => {
  it("scores custom overlay presets higher than default", () => {
    const custom = scoreThemeRestoreFields({
      overlayPresets: [{ id: "ov1", name: "방송", theme: "excelLive" } as AppState["overlayPresets"][number]],
    });
    const basic = scoreThemeRestoreFields({
      overlayPresets: [{ id: "ov0", name: "기본", theme: "default" } as AppState["overlayPresets"][number]],
    });
    expect(custom).toBeGreaterThan(basic);
  });

  it("offers restore when current is default and backup is custom", () => {
    const current = defaultState();
    const candidate: ThemeRestoreCandidate = {
      source: "test",
      score: 140,
      updatedAt: 1,
      overlayPresets: [{ id: "ov1", name: "방송", theme: "excelLive" } as AppState["overlayPresets"][number]],
    };
    expect(shouldOfferThemeRestore(current, candidate)).toBe(true);
  });

  it("applies theme patch without touching donors", () => {
    const base: AppState = {
      ...defaultState(),
      donors: [{ id: "d1", name: "a", amount: 1000, memberId: "m1", at: 1, target: "toon" }],
    };
    const candidate: ThemeRestoreCandidate = {
      source: "test",
      score: 140,
      updatedAt: 1,
      overlayPresets: [{ id: "ov1", name: "방송", theme: "excelLive" } as AppState["overlayPresets"][number]],
    };
    const next = applyThemeRestorePatch(base, candidate);
    expect(next.overlayPresets?.[0]?.theme).toBe("excelLive");
    expect(next.donors).toHaveLength(1);
  });

  it("picks best candidate by score", () => {
    const best = pickBestThemeRestoreCandidate([
      { source: "a", score: 60, updatedAt: 1, overlayPresets: [{ id: "1", theme: "excel" } as AppState["overlayPresets"][number]] },
      { source: "b", score: 140, updatedAt: 2, overlayPresets: [{ id: "2", theme: "excelLive" } as AppState["overlayPresets"][number]] },
    ]);
    expect(best?.source).toBe("b");
  });

  it("describes overlay theme label", () => {
    expect(
      describeOverlayThemeLabel([{ id: "1", name: "방송 엑셀", theme: "excelLive" }])
    ).toBe("방송 엑셀");
  });
});
