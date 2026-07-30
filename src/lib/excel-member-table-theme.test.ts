import { describe, expect, it } from "vitest";
import {
  EXCEL_MEMBER_THEME_IDS,
  isExcelMemberTableTheme,
  resolveExcelMemberTableAccent,
} from "./excel-member-table-theme";

describe("excel-member-table-theme", () => {
  it("detects excel member table themes", () => {
    expect(isExcelMemberTableTheme("excelBlue")).toBe(true);
    expect(isExcelMemberTableTheme("default")).toBe(false);
  });

  it("returns accent colors per excel theme", () => {
    for (const id of EXCEL_MEMBER_THEME_IDS) {
      const accent = resolveExcelMemberTableAccent(id);
      expect(accent?.headerBg).toMatch(/^rgba?\(/);
      expect(accent?.headerText).toMatch(/^#/);
    }
    expect(resolveExcelMemberTableAccent("excelBlue")?.headerBg).toContain("37, 99, 235");
  });
});
