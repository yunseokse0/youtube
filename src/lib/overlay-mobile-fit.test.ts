import { describe, expect, it } from "vitest";
import {
  clampWidthToViewport,
  computeContainFitScale,
  computeReadableCanvasScale,
  ensureCanvasFontPx,
  isNarrowBroadcastViewport,
  resolveBroadcastZoomScale,
} from "./overlay-mobile-fit";

describe("overlay-mobile-fit", () => {
  it("detects narrow mobile viewport", () => {
    expect(isNarrowBroadcastViewport(390, 844)).toBe(true);
    expect(isNarrowBroadcastViewport(1920, 1080)).toBe(false);
  });

  it("scales fixed canvas down on phone", () => {
    const s = computeContainFitScale(1080, 1920, 390, 844);
    expect(s).toBeLessThan(0.5);
    expect(s).toBeGreaterThan(0.2);
  });

  it("readable canvas scale is not smaller than plain contain", () => {
    const contain = computeContainFitScale(1080, 1920, 390, 844);
    const readable = computeReadableCanvasScale(1080, 1920, 390, 844, 40);
    expect(readable).toBeGreaterThanOrEqual(contain);
  });

  it("ensureCanvasFontPx bumps font before canvas scale", () => {
    expect(ensureCanvasFontPx(12, 0.35, 17)).toBeGreaterThanOrEqual(49);
  });

  it("clamps goal width to viewport", () => {
    expect(clampWidthToViewport(560, 390)).toBe(366);
  });

  it("reduces zoom on narrow viewport", () => {
    const z = resolveBroadcastZoomScale(100, 390, 1500);
    expect(z).toBeLessThan(0.3);
  });
});
