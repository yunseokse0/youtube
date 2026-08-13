import { describe, expect, it } from "vitest";
import {
  backgroundWithOpacityFrac,
  liftRgbForFade,
  softOverlayOpacityFrac,
  solidBackgroundWithOpacityFrac,
} from "./donor-rankings-opacity";

describe("softOverlayOpacityFrac", () => {
  it("keeps mid values brighter than linear", () => {
    expect(softOverlayOpacityFrac(0)).toBe(0);
    expect(softOverlayOpacityFrac(1)).toBe(1);
    expect(softOverlayOpacityFrac(0.5)).toBeGreaterThan(0.5);
    expect(softOverlayOpacityFrac(0.25)).toBeGreaterThan(0.25);
  });
});

describe("liftRgbForFade", () => {
  it("brightens toward white as fade increases", () => {
    const full = liftRgbForFade(200, 0, 0, 1);
    expect(full).toEqual({ r: 200, g: 0, b: 0 });
    const mid = liftRgbForFade(200, 0, 0, 0.5);
    expect(mid.r).toBeGreaterThan(200);
    expect(mid.g).toBeGreaterThan(0);
  });
});

describe("backgroundWithOpacityFrac", () => {
  it("returns transparent at 0", () => {
    expect(backgroundWithOpacityFrac("#ff0000", 0).background).toBe("transparent");
  });

  it("bakes soft alpha into hex", () => {
    const style = backgroundWithOpacityFrac("#ff0000", 1);
    expect(style.background).toMatch(/^rgba\(255,0,0,1\)$/);
    const half = backgroundWithOpacityFrac("#ff0000", 0.5);
    expect(half.background).toMatch(/^rgba\(/);
    expect(half.opacity).toBeUndefined();
  });
});

describe("solidBackgroundWithOpacityFrac", () => {
  it("fades row colors with the same slider", () => {
    expect(solidBackgroundWithOpacityFrac("rgba(255, 0, 0, 1)", 0)).toBe("transparent");
    expect(solidBackgroundWithOpacityFrac("#ffffff", 1)).toMatch(/rgba\(255,255,255/);
  });
});
