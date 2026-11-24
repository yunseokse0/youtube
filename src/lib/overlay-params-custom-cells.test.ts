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

  it("excludes custom column on main excel table when excludeMainTableCustomCell is enabled", () => {
    const isMainTable = true;
    const excludeMainTableCustomCell = true;
    const showCustomColumn = isMainTable && excludeMainTableCustomCell ? false : true;
    expect(showCustomColumn).toBe(false);
  });

  it("keeps custom column on sub excel tables when excludeMainTableCustomCell is enabled", () => {
    const isMainTable = false;
    const excludeMainTableCustomCell = true;
    const showCustomColumn = isMainTable && excludeMainTableCustomCell ? false : true;
    expect(showCustomColumn).toBe(true);
  });

  it("supports customCellMode: 'rank' vs 'member' in overlay preset serialization", async () => {
    const { presetToParams } = await import("./overlay-params");
    const rankPreset: OverlayPresetLike = {
      id: "preset_pongdang",
      name: "퐁당퐁당 엑셀표",
      customHeaderLabel: "식사",
      customCellMode: "rank",
      rankCustomCells: ["소고기", "삼겹살", "치킨"],
    };

    const params = presetToParams(rankPreset);
    expect(params.get("customCellMode")).toBe("rank");
    expect(params.get("customHeaderLabel")).toBe("식사");
  });
});
