import { describe, expect, it } from "vitest";
import {
  DEFAULT_OVERLAY_AMOUNT_UNIT,
  normalizeOverlayAmountUnit,
  readOverlayAmountUnitFromSettings,
  resolveOverlayAmountUnit,
} from "./overlay-amount-unit";

describe("overlay-amount-unit", () => {
  it("normalizes empty to fallback", () => {
    expect(normalizeOverlayAmountUnit("")).toBe(DEFAULT_OVERLAY_AMOUNT_UNIT);
    expect(normalizeOverlayAmountUnit("  캐시  ")).toBe("캐시");
  });

  it("reads from overlaySettings", () => {
    expect(readOverlayAmountUnitFromSettings({ amountUnit: "캐시" })).toBe("캐시");
    expect(readOverlayAmountUnitFromSettings({})).toBe(DEFAULT_OVERLAY_AMOUNT_UNIT);
  });

  it("prefers settings over URL", () => {
    expect(
      resolveOverlayAmountUnit({
        settings: { amountUnit: "캐시" },
        urlParam: "원",
      })
    ).toBe("캐시");
    expect(
      resolveOverlayAmountUnit({
        settings: {},
        urlParam: "캐시",
      })
    ).toBe("캐시");
    expect(resolveOverlayAmountUnit({})).toBe(DEFAULT_OVERLAY_AMOUNT_UNIT);
  });
});
