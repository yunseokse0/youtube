import { describe, expect, it } from "vitest";
import {
  buildCompactBroadcastOverlayParams,
  mergeOverlayPresetsPreferLocal,
  mergePresetBroadcastVisualParams,
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
    expect(stripped.get("showMembers")).toBeNull();
    expect(stripped.get("layout")).toBeNull();
    expect(stripped.get("tableOnly")).toBe("true");
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
    expect(stripped.get("showMembers")).toBeNull();
    expect(stripped.get("tableOnly")).toBe("true");
  });

  it("buildCompactBroadcastOverlayParams keeps only p/u/host/vertical", () => {
    const q = buildCompactBroadcastOverlayParams({
      presetId: "ov_1785324281876_3jj4",
      userId: "bttaeho",
      host: "prism",
      vertical: false,
    });
    expect(q.toString()).toBe("p=ov_1785324281876_3jj4&u=bttaeho&host=prism");
    expect([...q.keys()].sort()).toEqual(["host", "p", "u"]);
  });

  it("mergePresetBroadcastVisualParams skips style keys now loaded from preset", () => {
    const preset: OverlayPresetLike = {
      id: "ov_1",
      theme: "excelRose",
      membersTheme: "excelLive",
      scale: "1.1",
      memberSize: "24",
      showMembers: true,
      tableOnly: true,
      accountHeaderLabel: "계좌",
    };
    const q = new URLSearchParams();
    mergePresetBroadcastVisualParams(q, preset);
    expect(q.get("theme")).toBeNull();
    expect(q.get("scale")).toBeNull();
    expect(q.get("memberSize")).toBeNull();
    expect(q.get("accountHeaderLabel")).toBeNull();
  });
});
