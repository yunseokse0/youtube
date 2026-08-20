import { describe, expect, it } from "vitest";
import {
  buildFlipCountdownSegments,
  normalizeTimerDesign,
  isDefaultTimerDesign,
} from "./timer-design";

describe("timer-design", () => {
  it("normalizeTimerDesign maps aliases to flip-countdown", () => {
    expect(normalizeTimerDesign("flip-countdown")).toBe("flip-countdown");
    expect(normalizeTimerDesign("flip_clock")).toBe("flip-countdown");
    expect(normalizeTimerDesign("")).toBe("pill");
    expect(isDefaultTimerDesign("pill")).toBe(true);
    expect(isDefaultTimerDesign("flip-countdown")).toBe(false);
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
});
