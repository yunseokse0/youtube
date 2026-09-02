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
    expect(clean).toBe("https://example.com/dr?u=finalent");
  });

  it("shortens full donor rankings path", () => {
    const raw =
      "https://example.com/overlay/donor-rankings/full?u=din&host=obs&titleColor=%23ff0&test=true";
    const clean = sanitizeBroadcastOverlayUrl(raw);
    expect(clean).toBe("https://example.com/dr/full?u=din&test=1");
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

  it("returns no warnings in admin iframe preview (banner UI removed)", () => {
    const parent = { location: { origin: "http://x", pathname: "/admin" } };
    const w = {
      location: { search: "?u=finalent&hubPreview=1&adminPreviewEmbed=1" },
      parent,
    };
    vi.stubGlobal("window", w);
    expect(getOverlayBroadcastConfigWarnings()).toEqual([]);
    vi.unstubAllGlobals();
  });
});
