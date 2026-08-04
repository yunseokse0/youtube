import { describe, expect, it } from "vitest";
import {
  buildCompactBroadcastOverlayParams,
  mergeOverlayPresetsPreferLocal,
  mergeOverlayPresetsPreferRemote,
  mergePresetBroadcastVisualParams,
  presetToParams,
  resolveOverlayTextSharpRender,
  resolveTimerOverlayStyle,
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

  it("prefers remote goal colors over stale local on OBS broadcast host", () => {
    const remote: OverlayPresetLike[] = [
      {
        id: "ov_goal",
        showGoal: true,
        goalBarBgColor: "#112233",
        goalBarFillColor: "#aabbcc",
        goalTextColor: "#ddeeff",
      },
    ];
    const local: OverlayPresetLike[] = [
      {
        id: "ov_goal",
        showGoal: true,
        goalBarBgColor: "#fde8f2",
        goalBarFillColor: "#ff6eb5",
        goalTextColor: "#6b2d4a",
      },
    ];
    const merged = mergeOverlayPresetsPreferRemote(remote, local);
    expect(merged[0]?.goalBarBgColor).toBe("#112233");
    expect(merged[0]?.goalBarFillColor).toBe("#aabbcc");
    expect(merged[0]?.goalTextColor).toBe("#ddeeff");
  });

  it("prefers preset timer colors over stale URL when ready", () => {
    const preset: OverlayPresetLike = {
      id: "ov_timer",
      showTimer: true,
      timerFontColor: "#ff3366",
      timerBgColor: "#112233",
    };
    const url = new URLSearchParams("timerFontColor=%23ffffff&timerBgColor=%23ffffff");
    const style = resolveTimerOverlayStyle(url, preset, null, { ready: true });
    expect(style.fontColor).toBe("#ff3366");
    expect(style.bgColor).toBe("#112233");
  });

  it("ignores stale URL timer colors when ready and preset is empty — uses timerDisplayStyles", () => {
    const preset: OverlayPresetLike = {
      id: "ov_timer_empty",
      showTimer: true,
      timerFontColor: "",
      timerBgColor: "",
    };
    const url = new URLSearchParams("timerFontColor=%23ffffff&timerBgColor=%23ffffff");
    const style = resolveTimerOverlayStyle(
      url,
      preset,
      {
        fontColor: "#00ff99",
        bgColor: "#101010",
        borderColor: "",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 40,
        scalePercent: 100,
        showHours: false,
      },
      { ready: true }
    );
    expect(style.fontColor).toBe("#00ff99");
    expect(style.bgColor).toBe("#101010");
  });

  it("falls back to timerDisplayStyles when preset timer colors are empty", () => {
    const style = resolveTimerOverlayStyle(new URLSearchParams(), null, {
      fontColor: "#aabbcc",
      bgColor: "transparent",
      borderColor: "",
      outlineColor: "",
      outlineWidth: 0.8,
      bgOpacity: 0,
      scalePercent: 120,
      showHours: true,
    }, { ready: true });
    expect(style.fontColor).toBe("#aabbcc");
    expect(style.bgOpacity).toBe(0);
    expect(style.scalePercent).toBe(120);
    expect(style.showHours).toBe(true);
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

  it("defaults sharp text render on broadcast host when no explicit override", () => {
    const sp = new URLSearchParams("host=obs");
    expect(
      resolveOverlayTextSharpRender(sp, null, {
        ready: true,
        defaultSharpOnBroadcast: true,
      })
    ).toBe(true);
    expect(
      resolveOverlayTextSharpRender(sp, null, {
        ready: true,
        defaultSharpOnBroadcast: false,
      })
    ).toBe(false);
  });

  it("textSharp=0 disables default broadcast sharp render", () => {
    const sp = new URLSearchParams("host=obs&textSharp=0");
    expect(
      resolveOverlayTextSharpRender(sp, null, {
        ready: true,
        defaultSharpOnBroadcast: true,
      })
    ).toBe(false);
  });

  it("preset overlayTextSharpRender enables sharp render when ready", () => {
    const preset: OverlayPresetLike = {
      id: "ov_sharp",
      overlayTextSharpRender: true,
    };
    expect(
      resolveOverlayTextSharpRender(new URLSearchParams(), preset, { ready: true })
    ).toBe(true);
  });
});
