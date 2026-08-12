import { describe, expect, it } from "vitest";
import {
  normalizeTimerFontFamily,
  resolveTimerFontFamilyCss,
  isDefaultTimerFontFamily,
} from "./timer-font-style";

describe("timer-font-style", () => {
  it("defaults unknown/empty to mono", () => {
    expect(normalizeTimerFontFamily("")).toBe("mono");
    expect(normalizeTimerFontFamily("auto")).toBe("mono");
    expect(normalizeTimerFontFamily("nope")).toBe("mono");
    expect(isDefaultTimerFontFamily("")).toBe(true);
  });

  it("accepts cute and display ids", () => {
    expect(normalizeTimerFontFamily("jua")).toBe("jua");
    expect(normalizeTimerFontFamily("hi_melody")).toBe("hi-melody");
    expect(normalizeTimerFontFamily("press-start-2p")).toBe("press-start");
    expect(resolveTimerFontFamilyCss("dongle")).toContain("Dongle");
  });
});
