import { describe, expect, it } from "vitest";
import { settlementLogoStorageKey } from "@/lib/settlement-branding";

describe("settlementLogoStorageKey", () => {
  it("scopes logo by account id", () => {
    expect(settlementLogoStorageKey("alice")).toBe("excel-broadcast-settlement-logo-v1:alice");
    expect(settlementLogoStorageKey("bob")).toBe("excel-broadcast-settlement-logo-v1:bob");
    expect(settlementLogoStorageKey("alice")).not.toBe(settlementLogoStorageKey("bob"));
  });

  it("requires account id", () => {
    expect(() => settlementLogoStorageKey(null)).toThrow(/계정/);
  });
});
