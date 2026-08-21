import { describe, expect, it } from "vitest";
import {
  buildCircularImageTimerDisplay,
  buildFlipCountdownSegments,
  computeCountdownRingFilledTicks,
  computeSpeedometerFillRatio,
  normalizeTimerDesign,
  isDefaultTimerDesign,
  isImageFrameTimerDesign,
  resolveTimerFrameAssetUrl,
} from "./timer-design";

describe("timer-design", () => {
  it("normalizeTimerDesign maps aliases to flip-countdown", () => {
    expect(normalizeTimerDesign("flip-countdown")).toBe("flip-countdown");
    expect(normalizeTimerDesign("flip_clock")).toBe("flip-countdown");
    expect(normalizeTimerDesign("")).toBe("pill");
    expect(isDefaultTimerDesign("pill")).toBe(true);
    expect(isDefaultTimerDesign("flip-countdown")).toBe(false);
  });

  it("normalizeTimerDesign maps image frame aliases", () => {
    expect(normalizeTimerDesign("countdown-ring")).toBe("countdown-ring");
    expect(normalizeTimerDesign("minute-ring")).toBe("countdown-ring");
    expect(normalizeTimerDesign("speedometer")).toBe("speedometer");
    expect(normalizeTimerDesign("infographic")).toBe("speedometer");
    expect(isImageFrameTimerDesign("countdown-ring")).toBe(true);
    expect(isImageFrameTimerDesign("pill")).toBe(false);
    expect(resolveTimerFrameAssetUrl("countdown-ring")).toContain("countdown-ring-frame.png");
    expect(resolveTimerFrameAssetUrl("speedometer")).toContain("speedometer-frame.png");
  });

  it("buildFlipCountdownSegments uses minutes:seconds by default", () => {
    expect(buildFlipCountdownSegments(125, false)).toEqual([
      { value: "02", label: "MINUTES" },
      { value: "05", label: "SECONDS" },
    ]);
  });

  it("buildFlipCountdownSegments adds hours when showHours", () => {
    expect(buildFlipCountdownSegments(3723, true)).toEqual([
      { value: "01", label: "HOURS" },
      { value: "02", label: "MINUTES" },
      { value: "03", label: "SECONDS" },
    ]);
  });

  it("buildFlipCountdownSegments adds days when >= 24h", () => {
    expect(buildFlipCountdownSegments(90061, false)).toEqual([
      { value: "01", label: "DAYS" },
      { value: "01", label: "HOURS" },
      { value: "01", label: "MINUTES" },
      { value: "01", label: "SECONDS" },
    ]);
  });

  it("buildCircularImageTimerDisplay formats countdown-ring and speedometer", () => {
    expect(buildCircularImageTimerDisplay(125, false, "countdown-ring")).toEqual(
      expect.objectContaining({ primary: "02:05", secondary: "min" })
    );
    expect(buildCircularImageTimerDisplay(244, false, "speedometer")).toEqual(
      expect.objectContaining({ primary: "04:04" })
    );
    expect(buildCircularImageTimerDisplay(3723, true, "speedometer")?.primary).toBe("01:02:03");
  });

  it("computeCountdownRingFilledTicks uses remaining minutes rounded up", () => {
    expect(computeCountdownRingFilledTicks(233)).toBe(4);
    expect(computeCountdownRingFilledTicks(3600)).toBe(60);
    expect(computeCountdownRingFilledTicks(0)).toBe(0);
  });

  it("computeSpeedometerFillRatio tracks ring tick ratio", () => {
    expect(computeSpeedometerFillRatio(150)).toBeCloseTo(3 / 60, 4);
    expect(computeSpeedometerFillRatio(3600)).toBe(1);
  });
});
