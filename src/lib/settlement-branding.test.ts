import { describe, expect, it } from "vitest";
import {
  buildSettlementIssuerLineFromCompanyName,
  defaultSettlementStatementText,
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

  it("uses company name as default issuer line", () => {
    const normalized = normalizeSettlementStatementText(
      { thankYouMessage: "", issuerLine: "" },
      "BT STUDIO 대장 BT태풍 이형석"
    );
    expect(normalized.issuerLine).toBe("BT STUDIO 대장 BT태풍 이형석");
    expect(normalized.thankYouMessage).toContain("감사드립니다");
  });

  it("migrates legacy default issuer to company name", () => {
    const normalized = normalizeSettlementStatementText(
      {
        thankYouMessage: "파이팅 넘치는 스트리머의 노고에 감사드립니다",
        issuerLine: "BT STUDIO 대장 BT태호 이동환",
      },
      "내 방송국"
    );
    expect(normalized.issuerLine).toBe("내 방송국");
    expect(normalized.thankYouMessage).toContain("감사드립니다");
  });

  it("buildSettlementIssuerLineFromCompanyName trims and limits length", () => {
    expect(buildSettlementIssuerLineFromCompanyName("  ACME  Corp  ")).toBe("ACME Corp");
  });

  it("defaultSettlementStatementText prefers company name over legacy issuer", () => {
    expect(defaultSettlementStatementText("DIN Studio").issuerLine).toBe("DIN Studio");
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
