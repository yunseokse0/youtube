import { describe, expect, it } from "vitest";
import {
  normalizeSettlementStatementText,
  settlementLogoStorageKey,
  settlementStatementTextStorageKey,
} from "@/lib/settlement-branding";

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

describe("settlement statement text", () => {
  it("scopes text by account id", () => {
    expect(settlementStatementTextStorageKey("alice")).toBe(
      "excel-broadcast-settlement-statement-text-v1:alice"
    );
  });

  it("falls back to defaults when blank", () => {
    const normalized = normalizeSettlementStatementText({
      thankYouMessage: "  ",
      issuerLine: "",
    });
    expect(normalized.thankYouMessage).toContain("감사드립니다");
    expect(normalized.issuerLine).toContain("BT STUDIO");
  });

  it("keeps custom thank-you and issuer lines", () => {
    const normalized = normalizeSettlementStatementText({
      thankYouMessage: "수고하셨습니다",
      issuerLine: "DINStudio",
    });
    expect(normalized).toEqual({
      thankYouMessage: "수고하셨습니다",
      issuerLine: "DINStudio",
    });
  });
});
