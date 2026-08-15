import { describe, expect, it } from "vitest";
import {
  buildCompactBroadcastOverlayParams,
  mergeOverlayPresetsPreferLocal,
  mergeOverlayPresetsPreferRemote,
  mergeOverlayPresetsForOverlayView,
  mergePresetBroadcastVisualParams,
  presetToParams,
  resolveOverlayTextSharpRender,
  shouldDefaultSharpRenderOnBroadcastHost,
  resolveTableBgColor,
  resolveTableFontFamilyId,
  resolveTableVerticalLines,
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

  it("OBS view keeps local excel theme when remote presets look default", () => {
    const remote: OverlayPresetLike[] = [
      { id: "ov_1", theme: "default", membersTheme: "auto", showMembers: true },
    ];
    const local: OverlayPresetLike[] = [
      { id: "ov_1", theme: "excelBlue", membersTheme: "excelBlue", showMembers: true },
    ];
    const sp = new URLSearchParams("host=obs&u=din&p=ov_1");
    const merged = mergeOverlayPresetsForOverlayView(remote, local, sp);
    expect(merged[0]?.theme).toBe("excelBlue");
    expect(merged[0]?.membersTheme).toBe("excelBlue");
  });

  it("OBS view applies remote rankTop3 even when local has custom theme", () => {
    const remote: OverlayPresetLike[] = [
      {
        id: "ov_1",
        theme: "default",
        membersTheme: "auto",
        rankTop3Mode: "text",
        rankTop3Effect: "glow",
        showMembers: true,
      },
    ];
    const local: OverlayPresetLike[] = [
      {
        id: "ov_1",
        theme: "excelBlue",
        membersTheme: "excelBlue",
        rankTop3Mode: "off",
        rankTop3Effect: "none",
        showMembers: true,
      },
    ];
    const sp = new URLSearchParams("host=obs&u=din&p=ov_1");
    const merged = mergeOverlayPresetsForOverlayView(remote, local, sp);
    expect(merged[0]?.theme).toBe("excelBlue");
    expect(merged[0]?.rankTop3Mode).toBe("text");
    expect(merged[0]?.rankTop3Effect).toBe("glow");
  });

  it("OBS view prefers remote theme when server has custom theme", () => {
    const remote: OverlayPresetLike[] = [
      { id: "ov_1", theme: "excelRose", membersTheme: "excelRose", showMembers: true },
    ];
    const local: OverlayPresetLike[] = [
      { id: "ov_1", theme: "excelBlue", membersTheme: "excelBlue", showMembers: true },
    ];
    const sp = new URLSearchParams("host=obs&u=din&p=ov_1");
    const merged = mergeOverlayPresetsForOverlayView(remote, local, sp);
    expect(merged[0]?.theme).toBe("excelRose");
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

  it("prefers timerDisplayStyles showHours over stale preset timerShowHours", () => {
    const preset: OverlayPresetLike = {
      id: "ov_stale_hours",
      showTimer: true,
      timerShowHours: false,
    };
    const style = resolveTimerOverlayStyle(
      new URLSearchParams(),
      preset,
      {
        fontFamily: "dohyeon",
        fontColor: "",
        bgColor: "",
        borderColor: "",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 40,
        scalePercent: 100,
        showHours: true,
      },
      { ready: true, timerOnlyDefaultShowHours: true }
    );
    expect(style.showHours).toBe(true);
  });

  it("prefers timerDisplayStyles font over stale preset mono", () => {
    const preset: OverlayPresetLike = {
      id: "ov_stale_font",
      showTimer: false,
      timerFontFamily: "mono",
    };
    const style = resolveTimerOverlayStyle(
      new URLSearchParams(),
      preset,
      {
        fontFamily: "gaegu",
        fontColor: "",
        bgColor: "",
        borderColor: "",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 40,
        scalePercent: 100,
        showHours: false,
      },
      { ready: true }
    );
    expect(style.fontFamily).toBe("gaegu");
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

  it("preset overlayTextSharpRender false disables default broadcast sharp", () => {
    const preset: OverlayPresetLike = {
      id: "ov_soft",
      overlayTextSharpRender: false,
    };
    expect(
      resolveOverlayTextSharpRender(new URLSearchParams("host=obs"), preset, {
        ready: true,
        defaultSharpOnBroadcast: true,
      })
    ).toBe(false);
  });

  it("shouldDefaultSharpRenderOnBroadcastHost is true for obs/prism including preview hosts", () => {
    expect(shouldDefaultSharpRenderOnBroadcastHost(new URLSearchParams("host=obs"))).toBe(true);
    expect(shouldDefaultSharpRenderOnBroadcastHost(new URLSearchParams("host=prism"))).toBe(true);
    expect(shouldDefaultSharpRenderOnBroadcastHost(new URLSearchParams())).toBe(false);
  });

  it("ignores stale URL tableFontFamily when ready and preset uses theme auto", () => {
    const preset: OverlayPresetLike = {
      id: "ov_font",
      tableFontFamily: "",
      showMembers: true,
    };
    const url = new URLSearchParams("tableFontFamily=sans");
    expect(resolveTableFontFamilyId(url, preset, { ready: true })).toBe("auto");
  });

  it("ignores stale URL tableBgColor when ready and preset uses theme auto", () => {
    const preset: OverlayPresetLike = {
      id: "ov_bg",
      tableBgColor: "",
      showMembers: true,
    };
    const url = new URLSearchParams("tableBgColor=%23ff0000");
    expect(resolveTableBgColor(url, preset, { ready: true })).toBe("");
  });

  it("prefers remote when broadcastMatch=1 even in admin preview", () => {
    const remote: OverlayPresetLike[] = [
      { id: "ov_1", theme: "excel", accountHeaderLabel: "캐시", showMembers: true },
    ];
    const local: OverlayPresetLike[] = [
      { id: "ov_1", theme: "excelRose", accountHeaderLabel: "계좌", showMembers: true },
    ];
    const sp = new URLSearchParams("adminPreviewEmbed=1&broadcastMatch=1&host=prism");
    const merged = mergeOverlayPresetsForOverlayView(remote, local, sp);
    expect(merged[0]?.theme).toBe("excel");
    expect(merged[0]?.accountHeaderLabel).toBe("캐시");
  });

  it("resolveTableVerticalLines defaults on and respects false", () => {
    expect(resolveTableVerticalLines(new URLSearchParams(), null, { ready: true })).toBe(true);
    expect(
      resolveTableVerticalLines(new URLSearchParams("tableVerticalLines=false"), null, {
        ready: true,
      })
    ).toBe(false);
    expect(
      resolveTableVerticalLines(new URLSearchParams(), { id: "x", tableVerticalLines: false }, {
        ready: true,
      })
    ).toBe(false);
  });
});
