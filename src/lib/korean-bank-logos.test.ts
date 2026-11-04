import { describe, expect, it } from "vitest";
import fs from "fs";
import {
  OBS_TEXT_BANK_LOGO_PRESETS,
  buildOfficialBankSvgString,
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
    expect(koreanBankLogoUrlForCode(":국민:")).toBe(kb);
    expect(koreanBankLogoUrlForCode(":신한:")).toMatch(/^data:image\/svg\+xml/);
    expect(koreanBankLogoUrlForCode(":카카오뱅크:")).toMatch(/^data:image\/svg\+xml/);
    expect(lineContainsKoreanBankLogoCode("입금 :bank-shinhan: 확인")).toBe(true);
    expect(lineContainsKoreanBankLogoCode("입금 :신한: 확인")).toBe(true);
  });

  it("rewrites legacy public asset paths to data URIs", () => {
    const kb = koreanBankLogoUrlForCode(":bank-kb:");
    expect(resolveKoreanBankLogoUrl("/assets/bank-logos/kb.svg")).toBe(kb);
    expect(resolveKoreanBankLogoUrl("https://excel.heynb.co.kr/assets/bank-logos/kb.svg")).toBe(
      kb
    );
  });

  it("generates and syncs official bank logo SVG assets", () => {
    const stems = ["kb", "shinhan", "woori", "hana", "nh", "ibk", "sc", "kakao", "kbank", "toss"];
    for (const stem of stems) {
      const svg = buildOfficialBankSvgString(stem);
      expect(svg).toContain("<svg");
      expect(svg).toContain("viewBox=\"0 0 64 64\"");
      fs.writeFileSync(`public/assets/bank-logos/${stem}.svg`, svg, "utf8");
    }
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
