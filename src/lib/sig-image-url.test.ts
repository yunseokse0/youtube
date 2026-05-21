import { describe, expect, it } from "vitest";
import {
  isTrustedStoredSigImageHttpUrl,
  normalizeSigImageUrlStored,
  resolveSigImageUrl,
  toGithubRawSigAssetUrl,
} from "@/lib/constants";
import { matchSigInventoryItemByFileName, planSigBulkReupload } from "@/lib/sig-image-bulk";
import type { SigItem } from "@/types";

describe("normalizeSigImageUrlStored", () => {
  it("keeps Supabase sig storage URLs", () => {
    const url =
      "https://abc.supabase.co/storage/v1/object/public/image/sigs/finalent/foo.gif";
    expect(normalizeSigImageUrlStored(url)).toBe(url);
  });

  it("converts onrender absolute uploads to relative path", () => {
    expect(
      normalizeSigImageUrlStored(
        "https://youtube-ovvv.onrender.com/uploads/sigs/finalent/123.gif"
      )
    ).toBe("/uploads/sigs/finalent/123.gif");
  });

  it("maps legacy /uploads to /images/sigs when github-only mode", () => {
    const prev = process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
    process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = "true";
    try {
      expect(normalizeSigImageUrlStored("/uploads/sigs/finalent/123.gif")).toBe(
        "/images/sigs/123.gif"
      );
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
      else process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = prev;
    }
  });

  it("does not strip arbitrary https by default", () => {
    const cdn = "https://cdn.example.com/sig/price.gif";
    expect(normalizeSigImageUrlStored(cdn)).toBe(cdn);
  });
});

describe("sig bulk reupload", () => {
  const items: SigItem[] = [
    {
      id: "a",
      name: "애교",
      price: 0,
      imageUrl: "/uploads/sigs/u/old.gif",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    },
    {
      id: "b",
      name: "댄스",
      price: 0,
      imageUrl: "/images/sigs/dummy-sig.svg",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    },
  ];

  it("matches file name to sig name", () => {
    expect(matchSigInventoryItemByFileName(items, "애교.gif")?.id).toBe("a");
  });

  it("plans name match and fallback for reupload-needed rows", () => {
    const files = [
      new File([""], "애교.gif", { type: "image/gif" }),
      new File([""], "unknown.gif", { type: "image/gif" }),
    ];
    const plans = planSigBulkReupload(files, items);
    expect(plans).toHaveLength(2);
    expect(plans[0].item.id).toBe("a");
    expect(plans[0].matchedBy).toBe("name");
    expect(plans[1].item.id).toBe("b");
    expect(plans[1].matchedBy).toBe("fallback");
  });
});

describe("resolveSigImageUrl", () => {
  it("restores disk upload path from /images/sigs timestamp filename when userId is given", () => {
    const url = resolveSigImageUrl(
      "홀리몰리",
      "/images/sigs/1730000000_abcd1234.gif",
      "finalent"
    );
    expect(url).toBe("/uploads/sigs/finalent/1730000000_abcd1234.gif");
  });

  it("offloads bundled /images/sigs paths to GitHub raw when github-only mode", () => {
    const prev = process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
    process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = "true";
    try {
      const url = resolveSigImageUrl("테스트", "/images/sigs/from-drive/foo.gif");
      expect(url).toContain("raw.githubusercontent.com");
      expect(url).toContain("/images/sigs/");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
      else process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = prev;
    }
  });

  it("keeps disk upload paths on same origin by default", () => {
    const url = resolveSigImageUrl("테스트", "/uploads/sigs/finalent/1234567890_abcd1234.gif");
    expect(url).toBe("/uploads/sigs/finalent/1234567890_abcd1234.gif");
  });
});

describe("toGithubRawSigAssetUrl", () => {
  it("does not rewrite disk upload paths", () => {
    expect(toGithubRawSigAssetUrl("/uploads/sigs/finalent/foo.gif")).toBeNull();
  });

  it("maps uploads path to github images path when github-only offload is on", () => {
    const prev = process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
    process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = "true";
    try {
      const url = toGithubRawSigAssetUrl("/images/sigs/from-drive/foo.gif");
      expect(url).toContain("raw.githubusercontent.com");
      expect(url).toContain("/images/sigs/from-drive/foo.gif");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
      else process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = prev;
    }
  });
});

describe("isTrustedStoredSigImageHttpUrl", () => {
  it("trusts github raw sig paths", () => {
    expect(
      isTrustedStoredSigImageHttpUrl(
        "https://raw.githubusercontent.com/yunseokse0/youtube/main/public/images/sigs/foo.gif"
      )
    ).toBe(true);
  });
});
