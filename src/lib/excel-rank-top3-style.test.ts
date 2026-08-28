import { describe, expect, it } from "vitest";
import {
  buildRankFlowGradient,
  DEFAULT_EXCEL_RANK_TOP3_STYLE,
  formatExcelRankLabel,
  resolveExcelRankTop3RowStyle,
  resolveExcelRankTop3Style,
  shouldApplyExcelRankTop3Highlight,
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

  it("hides top3 effects when donation total is zero but keeps plain rank number", () => {
    expect(shouldApplyExcelRankTop3Highlight(1, 0)).toBe(false);
    expect(shouldApplyExcelRankTop3Highlight(2, 5000)).toBe(true);
    expect(shouldApplyExcelRankTop3Highlight(4, 5000)).toBe(false);
    const row = resolveExcelRankTop3RowStyle(
      1,
      {
        ...DEFAULT_EXCEL_RANK_TOP3_STYLE,
        mode: "text",
        rank1Effect: "colorShift",
      },
      { donationTotal: 0 }
    );
    expect(row.rankLabel).toBe("1");
    expect(row.rowBg).toBeUndefined();
    expect(row.nameCellClass).toBeUndefined();
    expect(row.gradientText).toBeUndefined();
  });

  it("shows plain rank number and colorShift on rank and name when text mode is on", () => {
    const row = resolveExcelRankTop3RowStyle(
      2,
      {
        ...DEFAULT_EXCEL_RANK_TOP3_STYLE,
        mode: "text",
      },
      { donationTotal: 5000 }
    );
    expect(row.rankLabel).toBe("2");
    expect(row.rowBg).toBeUndefined();
    expect(row.rankCellClass).toBe("overlay-rank-fx-colorShift");
    expect(row.nameCellClass).toBe("overlay-rank-fx-colorShift");
    expect(row.gradientText).toBe(true);
  });

  it("applies per-rank colorShift effect on rank and name cells", () => {
    const row = resolveExcelRankTop3RowStyle(
      1,
      {
        ...DEFAULT_EXCEL_RANK_TOP3_STYLE,
        mode: "text",
        rank1Effect: "colorShift",
        rank1TextColor: "#ff0000",
        rank1TextColorAlt: "#ffff00",
      },
      { donationTotal: 10000 }
    );
    expect(row.rankLabel).toBe("1");
    expect(row.rankCellClass).toBe("overlay-rank-fx-colorShift");
    expect(row.nameCellClass).toBe("overlay-rank-fx-colorShift");
    expect(row.gradientText).toBe(true);
    expect(row.rankCellStyle?.["--excel-rank-gradient"]).toContain("linear-gradient");
    expect(row.rankCellStyle?.["--excel-rank-gradient"]).toContain("#ff0000");
  });

  it("applies per-rank rainbow effect on rank and name cells", () => {
    const row = resolveExcelRankTop3RowStyle(
      2,
      {
        ...DEFAULT_EXCEL_RANK_TOP3_STYLE,
        mode: "text",
        rank2Effect: "rainbow",
      },
      { donationTotal: 5000 }
    );
    expect(row.rankLabel).toBe("2");
    expect(row.rankCellClass).toContain("overlay-rank-fx-rainbow");
    expect(row.nameCellClass).toContain("overlay-rank-fx-rainbow");
    expect(row.nameCellClass).toContain("overlay-rank-tone-2");
    expect(row.gradientText).toBe(true);
  });

  it("buildRankFlowGradient blends multiple color stops", () => {
    const gradient = buildRankFlowGradient("#ca8a04", "#fef08a", 1);
    expect(gradient).toContain("#ca8a04");
    expect(gradient).toContain("#fef08a");
    expect(gradient.split(",").length).toBeGreaterThan(4);
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

  it("merges preset when ready", () => {
    const style = resolveExcelRankTop3Style(new URLSearchParams("rankTop3Mode=emoji"), {
      rankTop3Mode: "bg",
    }, { ready: true });
    expect(style.mode).toBe("text");
  });

  it("prefers URL when not ready", () => {
    const style = resolveExcelRankTop3Style(new URLSearchParams("rankTop3Mode=emoji"), {
      rankTop3Mode: "bg",
    }, { ready: false });
    expect(style.mode).toBe("text");
  });
});
