import { describe, expect, it } from "vitest";
import { BUNDLED_SIG_PLACEHOLDER_URL } from "@/lib/constants";
import { isBundledSigPlaceholderItem, stripBundledSigPlaceholderItems } from "@/lib/sig-placeholder";

describe("sig-placeholder", () => {
  it("detects default preset ids and dummy image urls", () => {
    expect(isBundledSigPlaceholderItem({ id: "sig_aegyo", imageUrl: "/x.gif" })).toBe(true);
    expect(isBundledSigPlaceholderItem({ id: "custom_1", imageUrl: BUNDLED_SIG_PLACEHOLDER_URL })).toBe(
      true
    );
    expect(isBundledSigPlaceholderItem({ id: "custom_1", imageUrl: "/uploads/a.gif" })).toBe(false);
  });

  it("stripBundledSigPlaceholderItems removes placeholders", () => {
    const out = stripBundledSigPlaceholderItems([
      { id: "sig_aegyo", imageUrl: BUNDLED_SIG_PLACEHOLDER_URL },
      { id: "real_sig", imageUrl: "/uploads/a.gif" },
    ]);
    expect(out.map((x) => x.id)).toEqual(["real_sig"]);
  });
});
