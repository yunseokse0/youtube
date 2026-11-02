import { describe, expect, it } from "vitest";
import {
  OBS_TEXT_BANK_LOGO_PRESETS,
  koreanBankLogoUrlForCode,
  lineContainsKoreanBankLogoCode,
  resolveKoreanBankLogoUrl,
} from "@/lib/korean-bank-logos";
import {
  lineContainsObsTextInlineMedia,
  parseObsTextLineWithInlineMedia,
} from "@/lib/obs-text-inline-media";

describe("korean-bank-logos", () => {
  it("exposes 1st-tier bank presets as inline data URIs", () => {
    expect(OBS_TEXT_BANK_LOGO_PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(
      OBS_TEXT_BANK_LOGO_PRESETS.every((p) => p.url.startsWith("data:image/svg+xml"))
    ).toBe(true);
  });

  it("resolves canonical and alias codes", () => {
    const kb = koreanBankLogoUrlForCode(":bank-kb:");
    expect(kb).toMatch(/^data:image\/svg\+xml/);
    expect(koreanBankLogoUrlForCode(":국민은행:")).toBe(kb);
    expect(koreanBankLogoUrlForCode(":카카오뱅크:")).toMatch(/^data:image\/svg\+xml/);
    expect(lineContainsKoreanBankLogoCode("입금 :bank-shinhan: 확인")).toBe(true);
  });

  it("rewrites legacy public asset paths to data URIs", () => {
    const kb = koreanBankLogoUrlForCode(":bank-kb:");
    expect(resolveKoreanBankLogoUrl("/assets/bank-logos/kb.svg")).toBe(kb);
    expect(resolveKoreanBankLogoUrl("https://excel.heynh.co.kr/assets/bank-logos/kb.svg")).toBe(
      kb
    );
  });
});

describe("obs-text-inline-media", () => {
  it("parses bank logos next to plain text", () => {
    const segs = parseObsTextLineWithInlineMedia("계좌 :bank-kb: 국민", "#fff");
    expect(segs.some((s) => (s.imageUrl || "").startsWith("data:image/svg+xml"))).toBe(true);
    expect(segs.some((s) => s.text.includes("계좌"))).toBe(true);
  });

  it("detects either youtube or bank media", () => {
    expect(lineContainsObsTextInlineMedia(":bank-toss:")).toBe(true);
    expect(lineContainsObsTextInlineMedia("plain")).toBe(false);
  });
});
