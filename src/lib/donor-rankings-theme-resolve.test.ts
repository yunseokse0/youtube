import { describe, expect, it } from "vitest";
import {
  resolveDonorRankingsHideAmount,
  resolveDonorRankingsThemeColor,
  resolveDonorRankingsThemeNumber,
} from "./donor-rankings-theme-resolve";

describe("resolveDonorRankingsThemeColor", () => {
  const broadcast = "rgba(15, 20, 30, 0.70)";

  it("keeps transparent in live mode (does not substitute broadcast default)", () => {
    expect(resolveDonorRankingsThemeColor(true, false, null, "transparent", broadcast)).toBe(
      "transparent"
    );
  });

  it("uses broadcast default in live mode when saved is empty", () => {
    expect(resolveDonorRankingsThemeColor(true, false, null, "", broadcast)).toBe(broadcast);
  });

  it("uses explicit saved color in live mode", () => {
    expect(
      resolveDonorRankingsThemeColor(true, false, null, "rgba(8, 12, 28, 0.78)", broadcast)
    ).toBe("rgba(8, 12, 28, 0.78)");
  });

  it("ignores URL in live mode", () => {
    expect(
      resolveDonorRankingsThemeColor(true, false, "#ff0000", "transparent", broadcast)
    ).toBe("transparent");
  });

  it("uses URL in test mode", () => {
    expect(resolveDonorRankingsThemeColor(true, true, "#ff0000", "transparent", broadcast)).toBe(
      "#ff0000"
    );
  });

  it("falls back to broadcast in test mode when saved is transparent and no URL", () => {
    expect(resolveDonorRankingsThemeColor(false, true, null, "transparent", broadcast)).toBe(
      "transparent"
    );
    expect(resolveDonorRankingsThemeColor(false, true, null, "", broadcast)).toBe(broadcast);
  });
});

describe("resolveDonorRankingsHideAmount", () => {
  it("uses saved value in live mode and ignores URL", () => {
    expect(resolveDonorRankingsHideAmount(true, false, "true", false)).toBe(false);
    expect(resolveDonorRankingsHideAmount(true, false, "false", true)).toBe(true);
  });

  it("uses URL in test mode", () => {
    expect(resolveDonorRankingsHideAmount(true, true, "true", false)).toBe(true);
    expect(resolveDonorRankingsHideAmount(true, true, "show", true)).toBe(false);
  });
});

describe("resolveDonorRankingsThemeNumber", () => {
  it("returns 0 overlay opacity in live mode", () => {
    expect(resolveDonorRankingsThemeNumber(true, false, null, 0, 0, 100, 88)).toBe(0);
  });

  it("clamps saved overlay opacity in live mode", () => {
    expect(resolveDonorRankingsThemeNumber(true, false, null, 150, 0, 100, 88)).toBe(100);
  });

  it("uses URL overlay opacity in test mode", () => {
    expect(resolveDonorRankingsThemeNumber(true, true, "14", 88, 0, 100, 88)).toBe(14);
  });
});
