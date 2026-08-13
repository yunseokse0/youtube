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

  it("snaps scale near whole DPR steps", () => {
    expect(snapOverlayScaleForCrispLines(1.004, 1)).toBe(1);
    expect(snapOverlayScaleForCrispLines(1.01, 2)).toBe(1.01);
  });
});
