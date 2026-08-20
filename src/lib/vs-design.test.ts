import { describe, expect, it } from "vitest";
import {
  normalizeVsDesign,
  vsDesignSpriteBackgroundPosition,
} from "./vs-design";

describe("vs-design", () => {
  it("normalizeVsDesign maps aliases", () => {
    expect(normalizeVsDesign("gradient")).toBe("gradient");
    expect(normalizeVsDesign("glow-gold")).toBe("glow-gold");
    expect(normalizeVsDesign("blue")).toBe("glow-blue");
    expect(normalizeVsDesign("glow-orange")).toBe("glow-copper");
    expect(normalizeVsDesign("")).toBe("gradient");
  });

  it("vsDesignSpriteBackgroundPosition selects sprite column", () => {
    expect(vsDesignSpriteBackgroundPosition("glow-gold")).toBe("0% 50%");
    expect(vsDesignSpriteBackgroundPosition("glow-blue")).toBe("50% 50%");
    expect(vsDesignSpriteBackgroundPosition("glow-copper")).toBe("100% 50%");
    expect(vsDesignSpriteBackgroundPosition("gradient")).toBeNull();
  });
});
