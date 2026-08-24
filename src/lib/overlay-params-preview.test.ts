import { describe, expect, it, vi } from "vitest";
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
  resolveTableGridLines,
  resolveTimerOverlayStyle,
  applyTimerBackgroundOpacity,
  getTimerPillPaddingPx,
  isTimerBackgroundHidden,
  isTimerBorderVisuallyHidden,
  isHiddenTimerDisplayStyle,
  restoreTimerBackgroundOpacity,
  TIMER_PILL_BORDER_PX,
  stripAdminPreviewHotReloadParams,
  type OverlayPresetLike,
} from "./overlay-params";
import {
  hasCustomTimerDisplayStyles,
  isDefaultLikeTimerDisplayStyle,
  mergeRemoteTimerDisplayStyles,
} from "./state";

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
    expect(style.bgColor).toBe("transparent");
    expect(style.bgOpacity).toBe(0);
    expect(style.scalePercent).toBe(120);
    expect(style.showHours).toBe(true);
  });

  it("keeps background hidden when state bgOpacity is 0 even if preset has colors", () => {
    const preset: OverlayPresetLike = {
      id: "ov_timer_bg",
      showTimer: true,
      timerBgColor: "#112233",
      timerBorderColor: "#445566",
      timerBgOpacity: "80",
    };
    const style = resolveTimerOverlayStyle(
      new URLSearchParams(),
      preset,
      {
        fontColor: "",
        bgColor: "",
        borderColor: "transparent",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 0,
        scalePercent: 100,
        showHours: false,
      },
      { ready: true }
    );
    expect(style.bgColor).toBe("transparent");
    expect(style.bgOpacity).toBe(0);
    expect(style.borderColor).toBe("transparent");
  });

  it("uses preset hidden bg when timerDisplayStyles colors are default-like", () => {
    const preset: OverlayPresetLike = {
      id: "ov_timer_preset_hidden",
      showTimer: true,
      timerBgColor: "transparent",
      timerBorderColor: "transparent",
      timerBgOpacity: "0",
      timerScale: "250",
    };
    const style = resolveTimerOverlayStyle(
      new URLSearchParams(),
      preset,
      {
        showHours: false,
        fontFamily: "gothic",
        fontColor: "",
        bgColor: "",
        borderColor: "",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 40,
        scalePercent: 100,
      },
      { ready: true }
    );
    expect(style.bgColor).toBe("transparent");
    expect(style.bgOpacity).toBe(0);
    expect(style.borderColor).toBe("transparent");
    expect(isHiddenTimerDisplayStyle(style)).toBe(true);
  });

  it("hides border when bgOpacity is 0 even if preset has white border", () => {
    const preset: OverlayPresetLike = {
      id: "ov_timer_white_preset",
      showTimer: true,
      timerBgColor: "#ffffff",
      timerBorderColor: "#ffffff",
      timerBgOpacity: "40",
    };
    const style = resolveTimerOverlayStyle(
      new URLSearchParams(),
      preset,
      {
        showHours: false,
        fontFamily: "mono",
        fontColor: "#ffff00",
        bgColor: "",
        borderColor: "",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 0,
        scalePercent: 250,
      },
      { ready: true, timerOnlyDefaultShowHours: true }
    );
    expect(style.bgColor).toBe("transparent");
    expect(style.bgOpacity).toBe(0);
    expect(style.borderColor).toBe("transparent");
    expect(isHiddenTimerDisplayStyle(style)).toBe(true);
  });

  it("applies border-only transparent from timerDisplayStyles over preset border", () => {
    const preset: OverlayPresetLike = {
      id: "ov_timer_border",
      showTimer: true,
      timerBgColor: "#112233",
      timerBorderColor: "#ffffff",
      timerBgOpacity: "60",
    };
    const style = resolveTimerOverlayStyle(
      new URLSearchParams(),
      preset,
      {
        fontColor: "",
        bgColor: "",
        borderColor: "transparent",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 40,
        scalePercent: 100,
        showHours: false,
      },
      { ready: true }
    );
    expect(style.borderColor).toBe("transparent");
    expect(style.bgColor).toBe("#112233");
  });

  it("isHiddenTimerDisplayStyle detects transparent background and border", () => {
    expect(
      isHiddenTimerDisplayStyle({ bgColor: "transparent", borderColor: "transparent", bgOpacity: 0 })
    ).toBe(true);
    expect(isHiddenTimerDisplayStyle({ bgColor: "", borderColor: "transparent", bgOpacity: 40 })).toBe(
      true
    );
    expect(isHiddenTimerDisplayStyle({ bgColor: "", borderColor: "", bgOpacity: 40 })).toBe(false);
  });

  it("prefers timerDisplayStyles colors over preset when both set", () => {
    const preset: OverlayPresetLike = {
      id: "ov_timer_colors",
      showTimer: true,
      timerFontColor: "#ff3366",
      timerBgColor: "#112233",
      timerBgOpacity: "80",
      timerScale: "150",
    };
    const style = resolveTimerOverlayStyle(
      new URLSearchParams(),
      preset,
      {
        fontColor: "#ffffff",
        bgColor: "#ffffff",
        borderColor: "",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 40,
        scalePercent: 100,
        showHours: false,
      },
      { ready: true }
    );
    expect(style.fontColor).toBe("#ffffff");
    expect(style.bgColor).toBe("#ffffff");
    expect(style.bgOpacity).toBe(40);
    expect(style.scalePercent).toBe(100);
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

  it("prefers timerDisplayStyles design over stale URL timerDesign=pill", () => {
    const style = resolveTimerOverlayStyle(
      new URLSearchParams("timerDesign=pill"),
      { id: "ov_stale_design", showTimer: true, timerDesign: "pill" },
      {
        design: "led-matrix",
        fontFamily: "mono",
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
    expect(style.design).toBe("led-matrix");
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

  it("timer-only broadcast URL prefers remote hidden timer preset over stale local", () => {
    const remote: OverlayPresetLike[] = [
      {
        id: "ov_1",
        timerBgColor: "transparent",
        timerBorderColor: "transparent",
        timerBgOpacity: "0",
        showMembers: true,
      },
    ];
    const local: OverlayPresetLike[] = [
      {
        id: "ov_1",
        timerBgColor: "#ffffff",
        timerBorderColor: "#cccccc",
        timerBgOpacity: "40",
        showMembers: true,
      },
    ];
    const sp = new URLSearchParams("u=din&timerType=general&p=ov_1");
    const merged = mergeOverlayPresetsForOverlayView(remote, local, sp);
    expect(merged[0]?.timerBgColor).toBe("transparent");
    expect(merged[0]?.timerBorderColor).toBe("transparent");
    expect(merged[0]?.timerBgOpacity).toBe("0");
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

  it("resolveTableGridLines defaults on and respects false", () => {
    expect(resolveTableGridLines(new URLSearchParams(), null, { ready: true })).toBe(true);
    expect(
      resolveTableGridLines(new URLSearchParams("tableGridLines=false"), null, {
        ready: true,
      })
    ).toBe(false);
    expect(
      resolveTableGridLines(new URLSearchParams(), { id: "x", tableGridLines: false }, {
        ready: true,
      })
    ).toBe(false);
  });
});

describe("timer pill layout", () => {
  it("hides pill border when background is hidden", () => {
    expect(TIMER_PILL_BORDER_PX).toBe(1);
    expect(isTimerBorderVisuallyHidden("transparent", "transparent", 0)).toBe(true);
    expect(isTimerBorderVisuallyHidden("#ffffff", "#ff0000", 0)).toBe(true);
    expect(isTimerBorderVisuallyHidden("#ffffff", "#ffffff", 40)).toBe(false);
    expect(isTimerBorderVisuallyHidden("#ffffff", "transparent", 40)).toBe(true);
  });

  it("scales pill padding with fontSize", () => {
    expect(getTimerPillPaddingPx(41)).toEqual({ padX: 12, padY: 5 });
    expect(getTimerPillPaddingPx(112)).toEqual({ padX: 32, padY: 12 });
  });

  it("treats non-default outlineWidth as custom timer style", () => {
    const base = {
      showHours: false,
      fontFamily: "mono",
      fontColor: "",
      bgColor: "",
      borderColor: "",
      outlineColor: "",
      outlineWidth: 0.8,
      bgOpacity: 40,
      scalePercent: 100,
    };
    expect(isDefaultLikeTimerDisplayStyle(base)).toBe(true);
    expect(isDefaultLikeTimerDisplayStyle({ ...base, outlineWidth: 2 })).toBe(false);
    expect(hasCustomTimerDisplayStyles({ general: { ...base, outlineWidth: 1.5 } })).toBe(true);
    expect(isDefaultLikeTimerDisplayStyle({ ...base, bgColor: "transparent", bgOpacity: 0 })).toBe(
      false
    );
    expect(isHiddenTimerDisplayStyle({ bgColor: "transparent", borderColor: "", bgOpacity: 0 })).toBe(
      true
    );
  });
});

describe("applyTimerBackgroundOpacity", () => {
  it("returns transparent when opacity is 0", () => {
    expect(applyTimerBackgroundOpacity("#ffffff", 0)).toBe("transparent");
    expect(isTimerBackgroundHidden("#ffffff", 0)).toBe(true);
  });

  it("applies alpha to hex background colors", () => {
    expect(applyTimerBackgroundOpacity("#ffffff", 68)).toBe("rgba(255,255,255,0.68)");
    expect(applyTimerBackgroundOpacity("#ff0000", 50)).toBe("rgba(255,0,0,0.5)");
  });

  it("uses white rgba fallback when bg color is empty", () => {
    expect(applyTimerBackgroundOpacity("", 40)).toBe("rgba(255,255,255,0.4)");
  });

  it("restoreTimerBackgroundOpacity keeps visible opacity and fills LED default", () => {
    expect(restoreTimerBackgroundOpacity("led-matrix", 0)).toBe(100);
    expect(restoreTimerBackgroundOpacity("pill", 0)).toBe(40);
    expect(restoreTimerBackgroundOpacity("led-matrix", 72)).toBe(72);
  });
});

describe("resolveTableFrameEnabled", () => {
  it("shows frame when URL exists and enabled is unset", async () => {
    const { resolveTableFrameEnabled } = await import("./overlay-params");
    const preset: OverlayPresetLike = {
      tableFrameUrl: "/assets/excel-frames/golden-frame.png",
    };
    expect(
      resolveTableFrameEnabled(new URLSearchParams(), preset, { ready: true })
    ).toBe(true);
  });

  it("hides frame when tableFrameEnabled is false but keeps URL in preset", async () => {
    const { resolveTableFrameEnabled } = await import("./overlay-params");
    const preset: OverlayPresetLike = {
      tableFrameUrl: "/assets/excel-frames/golden-frame.png",
      tableFrameEnabled: false,
    };
    expect(
      resolveTableFrameEnabled(new URLSearchParams(), preset, { ready: true })
    ).toBe(false);
  });
});

describe("mergeRemoteTimerDisplayStyles", () => {
  it("keeps last-good custom colors but applies incoming led-matrix design", () => {
    const merged = mergeRemoteTimerDisplayStyles({
      last: {
        general: {
          showHours: false,
          design: "pill",
          fontFamily: "mono",
          fontColor: "#ff00aa",
          bgColor: "#111111",
          borderColor: "",
          outlineColor: "",
          outlineWidth: 0.8,
          bgOpacity: 40,
          scalePercent: 100,
        },
      },
      incoming: {
        general: {
          showHours: false,
          design: "led-matrix",
          fontFamily: "mono",
          fontColor: "",
          bgColor: "",
          borderColor: "",
          outlineColor: "",
          outlineWidth: 0.8,
          bgOpacity: 40,
          scalePercent: 100,
        },
      },
      hasIncomingKey: true,
    });
    expect(merged?.general.design).toBe("led-matrix");
    expect(merged?.general.fontColor).toBe("#ff00aa");
  });
});

describe("isOverlayServerAuthoritativeUrl", () => {
  it("does not treat main /overlay without host=obs as server-authoritative", async () => {
    const { isOverlayServerAuthoritativeUrl } = await import("./overlay-params");
    vi.stubGlobal("window", {
      location: { pathname: "/overlay", search: "?u=din&showTimer=true" },
      parent: null,
    });
    expect(isOverlayServerAuthoritativeUrl()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("treats host=obs overlay as server-authoritative", async () => {
    const { isOverlayServerAuthoritativeUrl } = await import("./overlay-params");
    vi.stubGlobal("window", {
      location: { pathname: "/overlay", search: "?u=din&host=obs" },
      parent: null,
    });
    expect(isOverlayServerAuthoritativeUrl()).toBe(true);
    vi.unstubAllGlobals();
  });
});
