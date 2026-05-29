import { describe, expect, it } from "vitest";
import { repairDiskUploadSigImagePath, repairLegacySigUploadPath } from "@/lib/sig-image-mode";

describe("repairLegacySigUploadPath", () => {
  it("maps /uploads/images/<file> to /uploads/sigs/<uid>/<file>", () => {
    expect(
      repairLegacySigUploadPath("/uploads/images/1738144211333-855444157.gif", "finalent")
    ).toBe("/uploads/sigs/finalent/1738144211333-855444157.gif");
  });

  it("maps /uploads/sig/<file> typo to /uploads/sigs/<uid>/<file>", () => {
    expect(repairLegacySigUploadPath("/uploads/sig/1.gif", "finalent")).toBe(
      "/uploads/sigs/finalent/1.gif"
    );
  });

  it("leaves canonical /uploads/sigs paths unchanged", () => {
    const p = "/uploads/sigs/finalent/123_abcdef12.gif";
    expect(repairLegacySigUploadPath(p, "finalent")).toBe(p);
  });
});

describe("repairDiskUploadSigImagePath", () => {
  it("repairs legacy path before github-flat recovery", () => {
    expect(
      repairDiskUploadSigImagePath("/uploads/images/foo.gif", "myuser")
    ).toBe("/uploads/sigs/myuser/foo.gif");
  });
});
