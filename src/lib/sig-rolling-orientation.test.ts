import { describe, expect, it } from "vitest";
import {
  classifySigRollingOrientation,
  sigRollingMediaFramePx,
  sigRollingPairLayoutPx,
  sigRollingShellOuterPx,
} from "./sig-rolling-orientation";

describe("sig-rolling-orientation", () => {
  it("classifies landscape when width exceeds height", () => {
    expect(classifySigRollingOrientation(640, 360)).toBe("landscape");
    expect(classifySigRollingOrientation(300, 180)).toBe("landscape");
    expect(classifySigRollingOrientation(301, 300)).toBe("landscape");
  });

  it("classifies portrait for square and tall images", () => {
    expect(classifySigRollingOrientation(300, 300)).toBe("portrait");
    expect(classifySigRollingOrientation(180, 300)).toBe("portrait");
  });

  it("uses 300×180 for landscape and swapped for portrait", () => {
    expect(sigRollingMediaFramePx("landscape")).toEqual({ width: 300, height: 180 });
    expect(sigRollingMediaFramePx("portrait")).toEqual({ width: 180, height: 300 });
  });

  it("sums pair outer width for mixed orientations", () => {
    const layout = sigRollingPairLayoutPx("portrait", "landscape", 6);
    const left = sigRollingShellOuterPx("portrait", 6);
    const right = sigRollingShellOuterPx("landscape", 6);
    expect(layout.totalOuterWidth).toBe(left.outerWidth + right.outerWidth);
    expect(layout.maxOuterHeight).toBe(Math.max(left.outerHeight, right.outerHeight));
  });
});
