import { describe, expect, it } from "vitest";
import {
  normalizeTableFontFamily,
  resolveTableFontFamilyCss,
  clampTableMemberSizePx,
} from "@/lib/table-font-style";

describe("table-font-style", () => {
  it("normalizeTableFontFamily", () => {
    expect(normalizeTableFontFamily("pretendard")).toBe("pretendard");
    expect(normalizeTableFontFamily("unknown")).toBe("auto");
  });

  it("resolveTableFontFamilyCss", () => {
    expect(resolveTableFontFamilyCss("auto")).toBeNull();
    expect(resolveTableFontFamilyCss("mono")).toContain("monospace");
  });

  it("clampTableMemberSizePx", () => {
    expect(clampTableMemberSizePx("24")).toBe(24);
    expect(clampTableMemberSizePx("999")).toBe(80);
    expect(clampTableMemberSizePx("abc", 18)).toBe(18);
  });
});
