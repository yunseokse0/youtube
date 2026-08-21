import { describe, expect, it } from "vitest";
import {
  defaultSettlementUiOptions,
  normalizeSettlementUiOptions,
  settlementUiOptionsEqual,
} from "@/lib/admin-client-settings";

describe("admin-client-settings", () => {
  it("normalizes settlement UI defaults", () => {
    expect(normalizeSettlementUiOptions(null)).toEqual(defaultSettlementUiOptions());
  });

  it("preserves member ratio inputs", () => {
    const opts = normalizeSettlementUiOptions({
      memberRatioInputs: { m1: { account: "80", toon: "" } },
    });
    expect(opts.memberRatioInputs.m1).toEqual({ account: "80", toon: "" });
  });

  it("compares serialized options", () => {
    const a = defaultSettlementUiOptions();
    const b = { ...a };
    expect(settlementUiOptionsEqual(a, b)).toBe(true);
  });
});
