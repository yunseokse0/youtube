import { describe, expect, it } from "vitest";
import {
  OBS_TEXT_BANK_LOGO_PRESETS,
  koreanBankLogoUrlForCode,
  lineContainsKoreanBankLogoCode,
} from "@/lib/korean-bank-logos";
import {
  lineContainsObsTextInlineMedia,
  parseObsTextLineWithInlineMedia,
} from "@/lib/obs-text-inline-media";

describe("korean-bank-logos", () => {
  it("exposes 1st-tier bank presets", () => {
    expect(OBS_TEXT_BANK_LOGO_PRESETS.length).toBeGreaterThanOrEqual(10);
    expect(OBS_TEXT_BANK_LOGO_PRESETS.every((p) => p.url.startsWith("/assets/bank-logos/"))).toBe(
      true
    );
  });

  it("resolves canonical and alias codes", () => {
    expect(koreanBankLogoUrlForCode(":bank-kb:")).toBe("/assets/bank-logos/kb.svg");
    expect(koreanBankLogoUrlForCode(":국민은행:")).toBe("/assets/bank-logos/kb.svg");
    expect(koreanBankLogoUrlForCode(":카카오뱅크:")).toBe("/assets/bank-logos/kakao.svg");
    expect(lineContainsKoreanBankLogoCode("입금 :bank-shinhan: 확인")).toBe(true);
  });
});

describe("obs-text-inline-media", () => {
  it("parses bank logos next to plain text", () => {
    const segs = parseObsTextLineWithInlineMedia("계좌 :bank-kb: 국민", "#fff");
    expect(segs.some((s) => s.imageUrl === "/assets/bank-logos/kb.svg")).toBe(true);
    expect(segs.some((s) => s.text.includes("계좌"))).toBe(true);
  });

  it("detects either youtube or bank media", () => {
    expect(lineContainsObsTextInlineMedia(":bank-toss:")).toBe(true);
    expect(lineContainsObsTextInlineMedia("plain")).toBe(false);
  });
});
