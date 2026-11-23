import { describe, expect, it } from "vitest";
import {
  SIG_ROLLING_THEME_IDS,
  SIG_ROLLING_THEMES,
  resolveSigRollingTheme,
  sigRollingThemeTextOutlineStyle,
} from "./sig-rolling-theme";

describe("sig-rolling-theme", () => {
  it("defines all expected theme IDs", () => {
    expect(SIG_ROLLING_THEME_IDS).toContain("default");
    expect(SIG_ROLLING_THEME_IDS).toContain("gold");
    expect(SIG_ROLLING_THEME_IDS).toContain("neon-pink");
    expect(SIG_ROLLING_THEME_IDS).toContain("cyber-blue");
    expect(SIG_ROLLING_THEME_IDS).toContain("violet");
    expect(SIG_ROLLING_THEME_IDS).toContain("emerald");
    expect(SIG_ROLLING_THEME_IDS).toContain("amber-warm");
    expect(SIG_ROLLING_THEME_IDS).toContain("glass");
    expect(SIG_ROLLING_THEME_IDS).toContain("clean-white");
  });

  it("has valid styling definitions for all themes", () => {
    for (const id of SIG_ROLLING_THEME_IDS) {
      const theme = SIG_ROLLING_THEMES[id];
      expect(theme).toBeDefined();
      expect(theme.id).toBe(id);
      expect(theme.label).toBeTruthy();
      expect(theme.shellBorder).toBeTruthy();
      expect(theme.shellBg).toBeTruthy();
      expect(theme.shellShadow).toBeTruthy();
      expect(theme.mediaBg).toBeTruthy();
      expect(theme.footerBg).toBeTruthy();
      expect(theme.footerBorderTop).toBeTruthy();
      expect(theme.nameColor).toBeTruthy();
      expect(theme.nameOutlineColor).toBeTruthy();
      expect(theme.priceColor).toBeTruthy();
      expect(theme.priceOutlineColor).toBeTruthy();
    }
  });

  it("resolves default theme for empty or unknown inputs", () => {
    expect(resolveSigRollingTheme("").id).toBe("default");
    expect(resolveSigRollingTheme(null).id).toBe("default");
    expect(resolveSigRollingTheme(undefined).id).toBe("default");
    expect(resolveSigRollingTheme("non-existent-theme-xyz").id).toBe("default");
  });

  it("resolves specific theme case-insensitively and trimmed", () => {
    expect(resolveSigRollingTheme("gold").id).toBe("gold");
    expect(resolveSigRollingTheme("  GOLD  ").id).toBe("gold");
    expect(resolveSigRollingTheme("Neon-Pink").id).toBe("neon-pink");
  });

  it("resolves alias names gracefully", () => {
    expect(resolveSigRollingTheme("pink").id).toBe("neon-pink");
    expect(resolveSigRollingTheme("rose").id).toBe("neon-pink");
    expect(resolveSigRollingTheme("blue").id).toBe("cyber-blue");
    expect(resolveSigRollingTheme("cyan").id).toBe("cyber-blue");
    expect(resolveSigRollingTheme("purple").id).toBe("violet");
    expect(resolveSigRollingTheme("green").id).toBe("emerald");
    expect(resolveSigRollingTheme("amber").id).toBe("amber-warm");
    expect(resolveSigRollingTheme("orange").id).toBe("amber-warm");
    expect(resolveSigRollingTheme("white").id).toBe("clean-white");
  });

  it("generates text outline styles with colors", () => {
    const style = sigRollingThemeTextOutlineStyle("#ffffff", "#000000", 24);
    expect(style.color).toBe("#ffffff");
    expect(style.textShadow).toBeDefined();
  });
});
