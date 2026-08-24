import { describe, expect, it } from "vitest";
import {
  MAX_OVERLAY_TEXT_OUTLINE_WIDTH_PX,
  buildBroadcastTextOutlineShadowCss,
  resolveTextOutlineWidthPx,
} from "./text-outline-style";

describe("text outline width", () => {
  it("allows donor-ranking-thick strokes up to 6px", () => {
    expect(MAX_OVERLAY_TEXT_OUTLINE_WIDTH_PX).toBe(6);
    expect(resolveTextOutlineWidthPx(32, 4)).toBe(4);
    expect(resolveTextOutlineWidthPx(32, 6)).toBe(6);
    const css = buildBroadcastTextOutlineShadowCss({
      outlineColor: "#000000",
      outlineWidthPx: 4,
      sharp: true,
    });
    expect(css).toBeTruthy();
    expect(css).toContain("#000000");
  });
});
