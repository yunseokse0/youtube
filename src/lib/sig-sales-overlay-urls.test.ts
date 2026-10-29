import { describe, expect, it } from "vitest";
import {
  buildManualSigThemeOverlayUrl,
  buildSigMenuOverlayUrl,
  buildSigSalesManualOverlayUrl,
  normalizeManualSigOverlayTheme,
  readManualSigOverlayThemeFromOverlaySettings,
  sigNeonMenuColumnCount,
} from "@/lib/sig-sales-overlay-urls";

describe("manual sig overlay theme", () => {
  it("normalizes theme ids", () => {
    expect(normalizeManualSigOverlayTheme("menu")).toBe("menu");
    expect(normalizeManualSigOverlayTheme("sig-menu")).toBe("menu");
    expect(normalizeManualSigOverlayTheme("result")).toBe("result");
    expect(normalizeManualSigOverlayTheme("")).toBe("result");
  });

  it("reads theme from overlaySettings", () => {
    expect(readManualSigOverlayThemeFromOverlaySettings(null)).toBe("result");
    expect(
      readManualSigOverlayThemeFromOverlaySettings({ sigSalesManualOverlayTheme: "menu" })
    ).toBe("menu");
  });

  it("appends theme=menu for neon board preview while result stays default url", () => {
    const resultUrl = buildSigSalesManualOverlayUrl("https://example.com", "din", {
      sigResultScalePct: 92,
    });
    expect(buildManualSigThemeOverlayUrl("https://example.com", "din", "result")).toBe(resultUrl);
    expect(buildManualSigThemeOverlayUrl("https://example.com", "din", "menu")).toBe(
      `${resultUrl}&theme=menu`
    );
  });
});

describe("buildSigMenuOverlayUrl", () => {
  it("builds obs menu url with optional member filter", () => {
    expect(buildSigMenuOverlayUrl("https://example.com", "finalent")).toBe(
      "https://example.com/overlay/sig-menu?u=finalent&host=obs"
    );
    expect(
      buildSigMenuOverlayUrl("https://example.com/", "finalent", { memberId: "m1" })
    ).toBe("https://example.com/overlay/sig-menu?u=finalent&memberId=m1&host=obs");
  });
});

describe("sigNeonMenuColumnCount", () => {
  it("uses compact columns for small menus", () => {
    expect(sigNeonMenuColumnCount(0)).toBe(1);
    expect(sigNeonMenuColumnCount(3)).toBe(3);
    expect(sigNeonMenuColumnCount(5)).toBe(3);
  });

  it("targets 7 columns for full menus", () => {
    expect(sigNeonMenuColumnCount(14)).toBe(7);
    expect(sigNeonMenuColumnCount(21)).toBe(7);
  });
});
