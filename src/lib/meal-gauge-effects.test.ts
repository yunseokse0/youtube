import { describe, expect, it } from "vitest";
import {
  mealTimerTextClass,
  normalizeMealGaugeEffects,
  resolveMealGaugeEffects,
  resolveMealTimerTheme,
} from "./meal-gauge-effects";

describe("meal-gauge-effects", () => {
  it("defaults all on when missing", () => {
    expect(normalizeMealGaugeEffects(undefined)).toEqual({
      critical: true,
      floatingScore: true,
      rankUp: true,
      timerTension: true,
      gaugeMotion: true,
    });
  });

  it("URL fx=none turns all off", () => {
    const sp = new URLSearchParams("fx=none");
    expect(resolveMealGaugeEffects({ critical: true, floatingScore: true, rankUp: true, timerTension: true, gaugeMotion: true }, sp)).toEqual({
      critical: false,
      floatingScore: false,
      rankUp: false,
      timerTension: false,
      gaugeMotion: false,
    });
  });

  it("URL fx list enables only listed", () => {
    const sp = new URLSearchParams("fx=critical,rank");
    expect(resolveMealGaugeEffects(undefined, sp)).toEqual({
      critical: true,
      floatingScore: false,
      rankUp: true,
      timerTension: false,
      gaugeMotion: false,
    });
  });

  it("uses state when no URL override", () => {
    const sp = new URLSearchParams("");
    expect(
      resolveMealGaugeEffects(
        { critical: false, floatingScore: true, rankUp: false, timerTension: true, gaugeMotion: true },
        sp
      )
    ).toEqual({
      critical: false,
      floatingScore: true,
      rankUp: false,
      timerTension: true,
      gaugeMotion: true,
    });
  });

  it("resolveMealTimerTheme prefers URL", () => {
    const sp = new URLSearchParams("timerTheme=neon");
    expect(resolveMealTimerTheme("danger", sp)).toBe("neon");
  });

  it("mealTimerTextClass applies neon low-time pulse", () => {
    expect(mealTimerTextClass("neon", false, true)).toContain("animate-pulse");
  });
});
