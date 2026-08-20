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
      { value: "02", label: "분" },
      { value: "05", label: "초" },
    ]);
  });

  it("buildFlipCountdownSegments adds hours when showHours", () => {
    expect(buildFlipCountdownSegments(3723, true)).toEqual([
      { value: "01", label: "시" },
      { value: "02", label: "분" },
      { value: "03", label: "초" },
    ]);
  });

  it("buildFlipCountdownSegments adds days when >= 24h", () => {
    expect(buildFlipCountdownSegments(90061, false)).toEqual([
      { value: "01", label: "일" },
      { value: "01", label: "시" },
      { value: "01", label: "분" },
      { value: "01", label: "초" },
    ]);
  });
});
