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

  it("builds github raw for bundled path", () => {
    const url = resolveSigAdminPreviewSrc("/images/sigs/from-drive/APT.gif", "APT");
    expect(url).toContain("raw.githubusercontent.com");
    expect(url).toContain("from-drive");
    expect(url).toContain("APT.gif");
  });

  it("offers from-drive fallback when stored path is flat", () => {
    const fb = resolveSigAdminPreviewFallbackSrc("/images/sigs/APT.gif", "APT");
    expect(fb).toContain("from-drive");
  });
});
