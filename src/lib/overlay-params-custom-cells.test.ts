import { describe, expect, it } from "vitest";
import type { OverlayPresetLike } from "./overlay-params";

describe("Per-preset Custom Column Linking", () => {
  it("allows preset to specify its own rankCustomCells and customHeaderLabel", () => {
    const preset: OverlayPresetLike = {
      id: "preset_main",
      name: "메인 엑셀",
      customHeaderLabel: "벌칙 메모",
      rankCustomCells: ["물마시기", "10초 정지", "노래 1곡"],
      customCellLinkMode: "preset",
    };

    expect(preset.customCellLinkMode).toBe("preset");
    expect(preset.customHeaderLabel).toBe("벌칙 메모");
    expect(preset.rankCustomCells).toEqual(["물마시기", "10초 정지", "노래 1곡"]);
  });

  it("identifies global fallback when customCellLinkMode is global or unset", () => {
    const globalPreset: OverlayPresetLike = {
      id: "preset_sub",
      name: "서브 엑셀",
      customCellLinkMode: "global",
    };

    const isDedicated = Boolean(
      globalPreset.customCellLinkMode === "preset" ||
        (Array.isArray(globalPreset.rankCustomCells) && globalPreset.rankCustomCells.length > 0) ||
        Boolean(globalPreset.customHeaderLabel)
    );

    expect(isDedicated).toBe(false);
  });
});
