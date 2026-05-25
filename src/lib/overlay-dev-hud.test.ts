import { describe, expect, it, vi } from "vitest";
import { showOverlayDevHud } from "./overlay-dev-hud";

describe("overlay-dev-hud", () => {
  it("hides dev hud in production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(showOverlayDevHud({ hubPreview: true, sigPreview: true, demo: true })).toBe(false);
    vi.unstubAllEnvs();
  });

  it("shows dev hud in development when flags set", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(showOverlayDevHud({ hubPreview: true })).toBe(true);
    expect(showOverlayDevHud({})).toBe(false);
    vi.unstubAllEnvs();
  });
});
