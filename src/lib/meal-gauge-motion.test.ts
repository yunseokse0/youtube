import { describe, expect, it } from "vitest";
import { resolveMealGaugeAnimStyle } from "./meal-gauge-motion";

describe("meal-gauge-motion", () => {
  it("uses URL gaugeAnim when valid", () => {
    const sp = new URLSearchParams("gaugeAnim=flow");
    expect(resolveMealGaugeAnimStyle(sp, false)).toBe("flow");
  });

  it("defaults to default when motion enabled", () => {
    expect(resolveMealGaugeAnimStyle(new URLSearchParams(""), true)).toBe("default");
  });

  it("returns none when motion disabled and no URL", () => {
    expect(resolveMealGaugeAnimStyle(new URLSearchParams(""), false)).toBe("none");
  });
});
