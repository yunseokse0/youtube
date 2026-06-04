import { describe, expect, it } from "vitest";
import { sanitizeBroadcastOverlayUrl } from "./overlay-params";

describe("sanitizeBroadcastOverlayUrl", () => {
  it("strips admin preview and hub flags for OBS", () => {
    const raw =
      "https://example.com/overlay/donor-rankings?u=finalent&hubPreview=1&adminPreviewEmbed=1&zoomPct=100";
    const clean = sanitizeBroadcastOverlayUrl(raw);
    expect(clean).toContain("u=finalent");
    expect(clean).not.toContain("hubPreview");
    expect(clean).not.toContain("adminPreviewEmbed");
  });
});
