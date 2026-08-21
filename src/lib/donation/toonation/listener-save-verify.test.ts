import { describe, expect, it } from "vitest";
import {
  maskToonationLinkKeyForDisplay,
  verifyToonationSettingsSaved,
} from "./listener";

describe("verifyToonationSettingsSaved", () => {
  const KEY = "abc123def456";

  it("accepts matching link key, owner, and enabled flag", () => {
    const result = verifyToonationSettingsSaved(
      {
        userId: "u1",
        enabled: true,
        alertboxUrl: `https://toon.at/widget/alertbox/${KEY}`,
        ownerName: "BT태호",
        connected: true,
        updatedAt: 1000,
      },
      { linkKey: KEY, ownerName: "BT 태호", enabled: true }
    );
    expect(result.ok).toBe(true);
  });

  it("rejects mismatched link key", () => {
    const result = verifyToonationSettingsSaved(
      {
        userId: "u1",
        enabled: true,
        alertboxUrl: `https://toon.at/widget/alertbox/${KEY}`,
        ownerName: "BT태호",
        connected: true,
        updatedAt: 1000,
      },
      { linkKey: "otherkey999", ownerName: "BT태호", enabled: true }
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("연동키");
  });

  it("rejects when server status is missing", () => {
    const result = verifyToonationSettingsSaved(null, {
      linkKey: KEY,
      ownerName: "BT태호",
      enabled: true,
    });
    expect(result.ok).toBe(false);
  });
});

describe("maskToonationLinkKeyForDisplay", () => {
  it("masks long keys", () => {
    expect(maskToonationLinkKeyForDisplay("abcdefghijklmnop")).toBe("abcdef…mnop");
  });
});
