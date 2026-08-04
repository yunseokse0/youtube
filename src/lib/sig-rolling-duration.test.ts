import { describe, expect, it } from "vitest";
import { getSigRollingHoldMs, resolveSigRollingHoldMs } from "@/lib/sig-rolling-duration";

describe("resolveSigRollingHoldMs", () => {
  it("uses admin static hold (e.g. 40000) instead of short GIF-like defaults", () => {
    expect(resolveSigRollingHoldMs(40000)).toBe(40000);
    expect(resolveSigRollingHoldMs(5000)).toBe(5000);
  });

  it("clamps to 1s .. 120s", () => {
    expect(resolveSigRollingHoldMs(100)).toBe(1000);
    expect(resolveSigRollingHoldMs(999999)).toBe(120_000);
  });
});

describe("getSigRollingHoldMs", () => {
  it("ignores gif path and returns static hold", async () => {
    await expect(getSigRollingHoldMs("/uploads/x.gif", 40000)).resolves.toBe(40000);
    await expect(getSigRollingHoldMs("/uploads/x.png", 8000)).resolves.toBe(8000);
  });
});
