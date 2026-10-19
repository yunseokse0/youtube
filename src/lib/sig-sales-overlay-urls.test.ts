import { describe, expect, it } from "vitest";
import {
  buildSigMenuOverlayUrl,
  sigNeonMenuColumnCount,
} from "@/lib/sig-sales-overlay-urls";

describe("buildSigMenuOverlayUrl", () => {
  it("builds obs menu url with optional member filter", () => {
    expect(buildSigMenuOverlayUrl("https://example.com", "finalent")).toBe(
      "https://example.com/overlay/sig-menu?u=finalent&host=obs"
    );
    expect(
      buildSigMenuOverlayUrl("https://example.com/", "finalent", { memberId: "m1" })
    ).toBe("https://example.com/overlay/sig-menu?u=finalent&memberId=m1&host=obs");
  });
});

describe("sigNeonMenuColumnCount", () => {
  it("uses compact columns for small menus", () => {
    expect(sigNeonMenuColumnCount(0)).toBe(1);
    expect(sigNeonMenuColumnCount(3)).toBe(3);
    expect(sigNeonMenuColumnCount(5)).toBe(3);
  });

  it("targets 7 columns for full menus", () => {
    expect(sigNeonMenuColumnCount(14)).toBe(7);
    expect(sigNeonMenuColumnCount(21)).toBe(7);
  });
});
