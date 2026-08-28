import { describe, expect, it } from "vitest";
import { applySolidTableTintToCssColor, applyTableTintToCssColor } from "./table-tint-opacity";

describe("applyTableTintToCssColor", () => {
  it("returns transparent at 0%", () => {
    expect(applyTableTintToCssColor("#ffc107", 0)).toBe("transparent");
    expect(applyTableTintToCssColor("rgba(255, 255, 255, 0.14)", 0)).toBe("transparent");
  });

  it("keeps soft stripe rgba at 100%", () => {
    expect(applyTableTintToCssColor("rgba(255, 255, 255, 0.14)", 1)).toBe(
      "rgba(255, 255, 255, 0.14)"
    );
  });

  it("multiplies stripe alpha at partial tint", () => {
    expect(applyTableTintToCssColor("rgba(255, 255, 255, 0.14)", 0.5)).toBe(
      "rgba(255, 255, 255, 0.07)"
    );
  });

  it("applies solid tint to hex header colors", () => {
    expect(applyTableTintToCssColor("#ffc107", 0.5)).toBe("rgba(255, 193, 7, 0.5)");
    expect(applyTableTintToCssColor("#ffc107", 1)).toBe("rgb(255, 193, 7)");
  });
});

describe("applySolidTableTintToCssColor", () => {
  it("fades studio glass rgba", () => {
    expect(applySolidTableTintToCssColor("rgba(124, 58, 237, 0.72)", 0.25)).toBe(
      "rgba(124, 58, 237, 0.25)"
    );
  });
});
