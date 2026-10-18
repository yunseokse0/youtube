import { describe, expect, it } from "vitest";
import {
  computeManualSoldTotal,
  MANUAL_SIG_GRID_COLS_KEY,
  MANUAL_SIG_GRID_ROWS_KEY,
  MANUAL_SIG_PANEL_ORIENTATION_KEY,
  MANUAL_SIG_PICK_COUNT_KEY,
  normalizeManualSigGrid,
  readManualSigGridFromOverlaySettings,
  readManualSigPanelOrientationFromOverlaySettings,
} from "@/lib/manual-sig-workbench";

describe("manual sig panel grid", () => {
  it("builds 5x5 as 25 cells", () => {
    expect(normalizeManualSigGrid(5, 5)).toEqual({ rows: 5, cols: 5, pickCount: 25 });
  });

  it("builds 4x6 as 24 cells", () => {
    expect(normalizeManualSigGrid(4, 6)).toEqual({ rows: 4, cols: 6, pickCount: 24 });
  });

  it("raises 1x1 to at least 2 cells", () => {
    expect(normalizeManualSigGrid(1, 1).pickCount).toBeGreaterThanOrEqual(2);
  });

  it("caps oversize grids at 36", () => {
    const g = normalizeManualSigGrid(8, 8);
    expect(g.pickCount).toBeLessThanOrEqual(36);
    expect(g.rows * g.cols).toBe(g.pickCount);
  });

  it("treats legacy pickCount as 1-row grid", () => {
    expect(readManualSigGridFromOverlaySettings({ [MANUAL_SIG_PICK_COUNT_KEY]: 5 })).toEqual({
      rows: 1,
      cols: 5,
      pickCount: 5,
    });
  });

  it("prefers saved rows/cols", () => {
    expect(
      readManualSigGridFromOverlaySettings({
        [MANUAL_SIG_PICK_COUNT_KEY]: 5,
        [MANUAL_SIG_GRID_ROWS_KEY]: 5,
        [MANUAL_SIG_GRID_COLS_KEY]: 5,
      })
    ).toEqual({ rows: 5, cols: 5, pickCount: 25 });
  });
});

describe("manual sig panel orientation", () => {
  it("defaults to portrait when unset", () => {
    expect(readManualSigPanelOrientationFromOverlaySettings({})).toBe("portrait");
  });

  it("reads landscape", () => {
    expect(
      readManualSigPanelOrientationFromOverlaySettings({
        [MANUAL_SIG_PANEL_ORIENTATION_KEY]: "landscape",
      })
    ).toBe("landscape");
  });
});

describe("manual sold total", () => {
  it("sums only sold cells", () => {
    expect(computeManualSoldTotal([1000, 2000, 3000], [true, false, true])).toBe(4000);
  });

  it("uses one-shot price when one-shot is sold", () => {
    expect(
      computeManualSoldTotal([1000, 2000], [true, false], { oneShotSold: true, oneShotPrice: 5000 })
    ).toBe(5000);
  });
});
