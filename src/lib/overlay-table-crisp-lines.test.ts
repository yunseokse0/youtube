import { describe, expect, it } from "vitest";
import {
  overlayTableCellGridCss,
  overlayTableGridLineWidthPx,
  overlayTableHairlineShadow,
  overlayTableOuterFrameShadow,
  snapOverlayScaleForCrispLines,
} from "./overlay-table-crisp-lines";

describe("overlay table crisp lines", () => {
  it("builds inset hairline shadows instead of borders", () => {
    expect(overlayTableHairlineShadow("#f5b8d4", { bottom: 1 })).toBe(
      "inset 0 -1px 0 0 #f5b8d4"
    );
    expect(overlayTableHairlineShadow("rgba(0,0,0,.4)", { top: true }, 2)).toBe(
      "inset 0 2px 0 0 rgba(0,0,0,.4)"
    );
  });

  it("uses thicker grid lines for OBS external host", () => {
    expect(overlayTableGridLineWidthPx(true)).toBe(2);
    expect(overlayTableGridLineWidthPx(false)).toBe(1);
  });

  it("builds outer frame on all four sides", () => {
    expect(overlayTableOuterFrameShadow("#f5b8d4", 2)).toBe(
      "inset 0 2px 0 0 #f5b8d4, inset -2px 0 0 0 #f5b8d4, inset 0 -2px 0 0 #f5b8d4, inset 2px 0 0 0 #f5b8d4"
    );
  });

  it("emits cell grid css with last-child edges", () => {
    const css = overlayTableCellGridCss({ lineColor: "#abc", widthPx: 2 });
    expect(css).toContain("tbody tr.overlay-row td");
    expect(css).toContain("thead td:last-child");
    expect(css).toContain("overlay-total-row td:last-child");
    expect(css).toContain("inset -2px 0 0 0 #abc");
  });

  it("uses contrasting total-row line color when provided", () => {
    const css = overlayTableCellGridCss({
      lineColor: "#f5b8d4",
      widthPx: 2,
      totalRowLineColor: "rgba(255, 255, 255, 0.72)",
    });
    expect(css).toContain("overlay-total-row td");
    expect(css).toContain("rgba(255, 255, 255, 0.72)");
    expect(css).toContain("overlay-col-total");
  });

  it("snaps scale near whole DPR steps", () => {
    expect(snapOverlayScaleForCrispLines(1.004, 1)).toBe(1);
    expect(snapOverlayScaleForCrispLines(1.01, 2)).toBe(1.01);
  });

  it("omits column vertical lines when verticalLines is false", () => {
    const css = overlayTableCellGridCss({
      lineColor: "#abc",
      widthPx: 2,
      verticalLines: false,
    });
    expect(css).toContain("thead td:first-child");
    expect(css).toContain("tbody tr.overlay-row td:first-child");
    // 중간 칸은 좌측(세로) 선 없음 — 기본 규칙은 top만
    expect(css).toMatch(
      /tbody tr\.overlay-row td \{\s*border: none !important;\s*box-shadow: inset 0 2px 0 0 #abc !important;/
    );
    expect(css).not.toContain("overlay-col-total");
  });

  it("keeps internal left edges when verticalLines defaults on", () => {
    const css = overlayTableCellGridCss({ lineColor: "#abc", widthPx: 2 });
    expect(css).toMatch(
      /tbody tr\.overlay-row td \{\s*border: none !important;\s*box-shadow: inset 0 2px 0 0 #abc, inset 2px 0 0 0 #abc !important;/
    );
  });
});
