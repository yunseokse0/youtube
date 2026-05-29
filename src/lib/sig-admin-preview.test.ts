import { describe, expect, it } from "vitest";
import {
  resolveSigAdminPreviewFallbackSrc,
  resolveSigAdminPreviewSrc,
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

  it("uses disk upload path for PC uploads", () => {
    const url = resolveSigAdminPreviewSrc(
      "/uploads/sigs/finalent/1735123456789_abcd1234.gif",
      "애교",
      "finalent"
    );
    expect(url).toBe("/uploads/sigs/finalent/1735123456789_abcd1234.gif");
  });

  it("offers from-drive fallback when stored path is flat in github-only mode", () => {
    const prev = process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
    process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = "true";
    try {
      const fb = resolveSigAdminPreviewFallbackSrc("/images/sigs/APT.gif", "APT");
      expect(fb).toContain("from-drive");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
      else process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = prev;
    }
  });
});
