import { describe, expect, it, vi } from "vitest";
import {
  getOverlayBroadcastConfigWarnings,
  sanitizeBroadcastOverlayUrl,
} from "./overlay-params";

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

describe("getOverlayBroadcastConfigWarnings", () => {
  it("returns no warnings for OBS top-level even with hubPreview", () => {
    const w = {
      location: {
        search: "?u=finalent&host=obs&hubPreview=1&adminPreviewEmbed=1",
        origin: "http://x",
      },
      parent: null as unknown as Window,
    };
    w.parent = w as unknown as Window;
    vi.stubGlobal("window", w);
    expect(getOverlayBroadcastConfigWarnings()).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("warns on hubPreview only inside admin iframe", () => {
    const parent = { location: { origin: "http://x", pathname: "/admin" } };
    const w = {
      location: { search: "?u=finalent&hubPreview=1&adminPreviewEmbed=1" },
      parent,
    };
    vi.stubGlobal("window", w);
    const msgs = getOverlayBroadcastConfigWarnings();
    expect(msgs.some((m) => m.includes("미리보기용 URL"))).toBe(true);
    vi.unstubAllGlobals();
  });
});
