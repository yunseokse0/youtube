import { describe, expect, it } from "vitest";
import {
  ensureSigOverlayDisplayStoredUrl,
  isLegacyRomanizedFlatSigPath,
  listSigOverlayImageFallbackUrls,
  resolveSigAdminPreviewFallbackSrc,
  resolveSigAdminPreviewSrc,
  resolveSigBundledFromDriveByName,
  resolveSigOverlayCardImageUrl,
  sigBundledFromDriveFallbackPath,
} from "@/lib/constants";

describe("sig admin preview", () => {
  it("maps flat path to from-drive fallback", () => {
    expect(sigBundledFromDriveFallbackPath("/images/sigs/APT.gif")).toBe(
      "/images/sigs/from-drive/APT.gif"
    );
    expect(sigBundledFromDriveFallbackPath("/images/sigs/from-drive/APT.gif")).toBeNull();
  });

  it("does not rewrite bundled root-only assets (dummy, stamp)", () => {
    expect(sigBundledFromDriveFallbackPath("/images/sigs/dummy-sig.svg")).toBeNull();
    expect(sigBundledFromDriveFallbackPath("/images/sigs/stamp.png")).toBeNull();
  });

  it("builds github raw for bundled path when github-only mode", () => {
    const prev = process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
    process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = "true";
    try {
      const url = resolveSigAdminPreviewSrc("/images/sigs/from-drive/APT.gif", "APT");
      expect(url).toContain("raw.githubusercontent.com");
      expect(url).toContain("from-drive");
      expect(url).toContain("APT.gif");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
      else process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = prev;
    }
  });

  it("resolveSigAdminPreviewSrc skips legacy romanized path for admin preview", () => {
    const url = resolveSigAdminPreviewSrc("/images/sig/ski.png", "스키", "finalent");
    expect(url).toContain("/images/sigs/from-drive/");
    expect(url).not.toContain("ski.png");
  });

  it("uses disk upload path for PC uploads", () => {
    const url = resolveSigAdminPreviewSrc(
      "/uploads/sigs/finalent/1735123456789_abcd1234.gif",
      "애교",
      "finalent"
    );
    expect(url).toBe("/uploads/sigs/finalent/1735123456789_abcd1234.gif");
  });

  it("detects legacy romanized OCR paths", () => {
    expect(isLegacyRomanizedFlatSigPath("/images/sig/bogdance.png")).toBe(true);
    expect(isLegacyRomanizedFlatSigPath("/images/sigs/bogdance.png")).toBe(true);
    expect(isLegacyRomanizedFlatSigPath("/images/sigs/from-drive/스키.gif")).toBe(false);
    expect(isLegacyRomanizedFlatSigPath("/uploads/sigs/finalent/1730000000_abcd1234.gif")).toBe(
      false
    );
  });

  it("resolveSigBundledFromDriveByName maps display name to from-drive gif", () => {
    expect(resolveSigBundledFromDriveByName("스키")).toBe("/images/sigs/from-drive/%EC%8A%A4%ED%82%A4.gif");
    expect(resolveSigBundledFromDriveByName("보그댄스")).toContain(
      encodeURIComponent("복고댄스")
    );
  });

  it("resolveSigOverlayCardImageUrl skips legacy romanized path and uses from-drive by name", () => {
    const url = resolveSigOverlayCardImageUrl("스키", "/images/sig/bogdance.png", "finalent");
    expect(url).toContain("/images/sigs/from-drive/");
    expect(url).toContain(encodeURIComponent("스키"));
    expect(url).not.toContain("bogdance");
  });

  it("ensureSigOverlayDisplayStoredUrl never returns legacy /images/sig path", () => {
    const url = ensureSigOverlayDisplayStoredUrl("솜사탕", "/images/sig/panty.png", "finalent");
    expect(url).toContain("/images/sigs/from-drive/");
    expect(url).toContain(encodeURIComponent("솜사탕"));
    expect(url).not.toContain("/images/sig/");
  });

  it("listSigOverlayImageFallbackUrls includes from-drive and placeholder", () => {
    const urls = listSigOverlayImageFallbackUrls("멸치", "/images/sig/chuchu.png", "finalent");
    expect(urls.length).toBeGreaterThan(1);
    expect(urls[0]).not.toContain("/images/sig/");
    expect(urls.some((u) => u.includes("/images/sigs/from-drive/"))).toBe(true);
    expect(urls.some((u) => u.includes("dummy-sig"))).toBe(true);
  });

  it("offers from-drive fallback when stored path is flat in github-only mode", () => {
    const prev = process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
    process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = "true";
    try {
      const primary = resolveSigAdminPreviewSrc("/images/sigs/APT.gif", "APT");
      expect(primary).toContain("from-drive");
      const fb = resolveSigAdminPreviewFallbackSrc("/images/sigs/APT.gif", "APT");
      expect(fb === null || String(fb).includes("from-drive")).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
      else process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = prev;
    }
  });
});
