import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXCEL_RANK_TOP3_STYLE,
  formatExcelRankLabel,
  resolveExcelRankTop3RowStyle,
  resolveExcelRankTop3Style,
} from "./excel-rank-top3-style";

describe("excel-rank-top3-style", () => {
  it("formats numeric ranks", () => {
    expect(formatExcelRankLabel(4, "hash")).toBe("#4");
    expect(formatExcelRankLabel(4, "plain")).toBe("4");
    expect(formatExcelRankLabel(4, "suffix")).toBe("4위");
  });

  it("returns hash rank when mode is off", () => {
    expect(resolveExcelRankTop3RowStyle(1, DEFAULT_EXCEL_RANK_TOP3_STYLE)).toEqual({
      rankLabel: "#1",
    });
  });

  it("uses rank label format when mode is off", () => {
    expect(
      resolveExcelRankTop3RowStyle(5, {
        ...DEFAULT_EXCEL_RANK_TOP3_STYLE,
        rankLabelFormat: "suffix",
      })
    ).toEqual({
      rankLabel: "5위",
    });
  });

  it("shows emoji and bg in both mode", () => {
    const row = resolveExcelRankTop3RowStyle(2, {
      ...DEFAULT_EXCEL_RANK_TOP3_STYLE,
      mode: "both",
      rank2Mark: "🥈",
    });
    expect(row.rankLabel).toBe("🥈");
    expect(row.rowBg).toContain("254, 215, 170");
    expect(row.rowClass).toContain("overlay-rank-top-2");
  });

  it("merges preset when ready", () => {
    const style = resolveExcelRankTop3Style(new URLSearchParams("rankTop3Mode=emoji"), {
      rankTop3Mode: "bg",
    }, { ready: true });
    expect(style.mode).toBe("bg");
  });

  it("prefers URL when not ready", () => {
    const style = resolveExcelRankTop3Style(new URLSearchParams("rankTop3Mode=emoji"), {
      rankTop3Mode: "bg",
    }, { ready: false });
    expect(style.mode).toBe("emoji");
  });
});
