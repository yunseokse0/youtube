import { describe, expect, it } from "vitest";
import {
  buildBattleOverlayContainerStyle,
  clampBattleOverlayContentWidthPct,
  clampBattleOverlayScalePct,
} from "./overlay-battle-scale";

describe("buildBattleOverlayContainerStyle", () => {
  it("uses transform scale instead of zoom when scaled", () => {
    const style = buildBattleOverlayContainerStyle(120, 90);
    expect(style.transform).toBe("scale(1.2)");
    expect(style.transformOrigin).toBe("top center");
    expect(style.maxWidth).toBe("90%");
    expect((style as { zoom?: number }).zoom).toBeUndefined();
  });

  it("omits transform at 100%", () => {
    const style = buildBattleOverlayContainerStyle(100, 100);
    expect(style.transform).toBeUndefined();
    expect(style.maxWidth).toBe("100%");
  });

  it("clamps scale and width", () => {
    expect(clampBattleOverlayScalePct(10)).toBe(50);
    expect(clampBattleOverlayScalePct(999)).toBe(300);
    expect(clampBattleOverlayContentWidthPct(10)).toBe(40);
    expect(clampBattleOverlayContentWidthPct(200)).toBe(100);
  });
});
