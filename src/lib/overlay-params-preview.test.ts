import { describe, expect, it } from "vitest";
import {
  mergeOverlayPresetsPreferLocal,
  presetToParams,
  stripAdminPreviewHotReloadParams,
  type OverlayPresetLike,
} from "./overlay-params";

describe("admin preview hot-reload params", () => {
  it("strips theme keys so preview iframe src stays stable across theme changes", () => {
    const preset: OverlayPresetLike = {
      id: "ov_1",
      theme: "excelBlue",
      membersTheme: "excelBlue",
      totalTheme: "excelBlue",
      scale: "1.1",
      memberSize: "24",
      showMembers: true,
      showTotal: true,
      tableOnly: true,
      layout: "center-fixed",
    };
    const stripped = stripAdminPreviewHotReloadParams(presetToParams(preset));
    expect(stripped.get("theme")).toBeNull();
    expect(stripped.get("membersTheme")).toBeNull();
    expect(stripped.get("scale")).toBeNull();
    expect(stripped.get("memberSize")).toBeNull();
    expect(stripped.get("showMembers")).toBe("true");
    expect(stripped.get("tableOnly")).toBe("true");
    expect(stripped.get("layout")).toBe("center-fixed");
  });

  it("prefers local preset theme over stale remote snapshot", () => {
    const remote: OverlayPresetLike[] = [
      { id: "ov_1", theme: "excel", membersTheme: "excel", showMembers: true },
    ];
    const local: OverlayPresetLike[] = [
      { id: "ov_1", theme: "excelBlue", membersTheme: "excelBlue", showMembers: true },
    ];
    const merged = mergeOverlayPresetsPreferLocal(remote, local);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.theme).toBe("excelBlue");
    expect(merged[0]?.membersTheme).toBe("excelBlue");
  });

  it("keeps structural params needed for member table when stripping hot-reload keys", () => {
    const preset: OverlayPresetLike = {
      id: "ov_1",
      theme: "retro",
      membersTheme: "retro",
      showMembers: true,
      showTotal: true,
      tableOnly: true,
      showTableSumRow: false,
    };
    const stripped = stripAdminPreviewHotReloadParams(presetToParams(preset));
    expect(stripped.get("theme")).toBeNull();
    expect(stripped.get("showMembers")).toBe("true");
    expect(stripped.get("tableOnly")).toBe("true");
  });
});
