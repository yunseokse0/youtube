import { describe, expect, it } from "vitest";
import {
  overlayTableHairlineShadow,
  snapOverlayScaleForCrispLines,
} from "./overlay-table-crisp-lines";

describe("overlay table crisp lines", () => {
  it("builds inset hairline shadows instead of borders", () => {
    expect(overlayTableHairlineShadow("#f5b8d4", { bottom: 1 })).toBe(
      "inset 0 -1px 0 0 #f5b8d4"
    );
    expect(overlayTableHairlineShadow("rgba(0,0,0,.4)", { top: 2 })).toBe(
      "inset 0 2px 0 0 rgba(0,0,0,.4)"
    );
  });

  it("snaps scale near whole DPR steps", () => {
    expect(snapOverlayScaleForCrispLines(1.004, 1)).toBe(1);
    expect(snapOverlayScaleForCrispLines(1.01, 2)).toBe(1.01);
  });
});
