import { describe, expect, it } from "vitest";
import {
  EXCEL_GOLD_RANK_TEXT_COLORS,
  EXCEL_MEMBER_THEME_IDS,
  contributionColumnBgFromColor,
  emptyTableThemeAutoColorPatch,
  isExcelGoldTableTheme,
  isExcelMemberTableTheme,
  resolveExcelMemberTableAccent,
  resolveTableThemeContributionPreviewHex,
  resolveTableThemeHeaderBgCss,
  resolveTableThemeHeaderPreviewHex,
  resolveTableThemePanelBorderPreviewHex,
  resolveTableThemeRowStripePreviewHex,
  tableRowStripeBgFromPickerHex,
} from "./excel-member-table-theme";

describe("excel-member-table-theme", () => {
  it("detects excel member table themes", () => {
    expect(isExcelMemberTableTheme("excelBlue")).toBe(true);
    expect(isExcelMemberTableTheme("default")).toBe(false);
  });

  it("returns accent colors per excel theme", () => {
    for (const id of EXCEL_MEMBER_THEME_IDS) {
      const accent = resolveExcelMemberTableAccent(id);
      expect(accent?.headerBg).toMatch(/^(#|rgba?\()/);
      expect(accent?.headerText).toMatch(/^#/);
    }
    expect(resolveExcelMemberTableAccent("excelBlue")?.headerBg).toContain("37, 99, 235");
  });

  it("uses distinct theme-auto header accents (not one blue for all)", () => {
    const purple = resolveTableThemeHeaderBgCss("excelPurple");
    const green = resolveTableThemeHeaderBgCss("excel");
    const glass = resolveTableThemeHeaderBgCss("default");
    const neon = resolveTableThemeHeaderBgCss("neon");
    expect(purple).not.toBe(green);
    expect(glass).not.toBe(neon);
    expect(resolveTableThemeHeaderPreviewHex("excelPurple")).toBe("#7c3aed");
    expect(emptyTableThemeAutoColorPatch().tableHeaderBgColor).toBe("");
  });

  it("uses 0.72 header accent opacity for excel and broadcast glass themes", () => {
    expect(resolveExcelMemberTableAccent("excelPurple")?.headerBg).toContain("0.72");
    expect(resolveTableThemeHeaderBgCss("default")).toContain("0.72");
    expect(resolveTableThemeHeaderBgCss("neon")).toContain("0.72");
  });

  it("excelGold uses gold panel border and zebra stripes without contrib pills", () => {
    const gold = resolveExcelMemberTableAccent("excelGold");
    expect(gold?.headerBg).toBe("#ffc107");
    expect(gold?.headerText).toBe("#1a1408");
    expect(gold?.panelBorder).toBe("#ffc107");
    expect(gold?.rowEvenBg).toContain("rgba(");
    expect(gold?.contributionColumnBg).toBeUndefined();
    expect(gold?.contributionPillBg).toBeUndefined();
    expect(isExcelGoldTableTheme("excelGold")).toBe(true);
    expect(isExcelGoldTableTheme("excel")).toBe(false);
    expect(resolveTableThemePanelBorderPreviewHex("excelGold")).toBe("#ffc107");
    expect(resolveTableThemeContributionPreviewHex("excelGold")).toBe("#ffc107");
    expect(resolveTableThemeRowStripePreviewHex("excelGold", "even")).toBe("#ffffff");
    expect(tableRowStripeBgFromPickerHex("#ffffff", 0.06)).toBe("rgba(255, 255, 255, 0.06)");
    expect(emptyTableThemeAutoColorPatch().contributionColor).toBe("");
    expect(contributionColumnBgFromColor("#ffc107", 0.22)).toBe("rgba(255, 193, 7, 0.22)");
    expect(EXCEL_GOLD_RANK_TEXT_COLORS).toEqual(["#ff5eb8", "#6ecbff", "#ffc107"]);
  });
});
