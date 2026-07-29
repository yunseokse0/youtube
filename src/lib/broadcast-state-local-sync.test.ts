import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { overlayUserIdsMatch } from "./broadcast-state-local-sync";

describe("broadcast-state-local-sync", () => {
  it("overlayUserIdsMatch treats empty as finalent", () => {
    expect(overlayUserIdsMatch(undefined, null)).toBe(true);
    expect(overlayUserIdsMatch("finalent", "")).toBe(true);
    expect(overlayUserIdsMatch("a", "b")).toBe(false);
  });
});

describe("resolveOverlayRemotePollMs", () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.stubGlobal("window", { location: { search: "" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow) vi.stubGlobal("window", originalWindow);
  });

  it("returns explicit poll when provided", async () => {
    const { resolveOverlayRemotePollMs } = await import("./overlay-pull-policy");
    expect(resolveOverlayRemotePollMs(500)).toBe(500);
  });
});
