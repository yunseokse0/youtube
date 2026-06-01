import { describe, expect, it, vi } from "vitest";
import { shouldSuppressOverlaySseConnection } from "./overlay-params";

describe("shouldSuppressOverlaySseConnection", () => {
  it("suppresses on sig-match demo hub path", () => {
    const w = {
      location: {
        pathname: "/overlay/sig-match/demo",
        search: "",
      },
      parent: null as unknown as Window,
    };
    w.parent = w as unknown as Window;
    vi.stubGlobal("window", w);
    expect(shouldSuppressOverlaySseConnection()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("allows SSE on real OBS obs-text (host=obs)", () => {
    const w = {
      location: {
        pathname: "/overlay/obs-text",
        search: "?u=finalent&host=obs&textId=default",
      },
      parent: null as unknown as Window,
    };
    w.parent = w as unknown as Window;
    vi.stubGlobal("window", w);
    expect(shouldSuppressOverlaySseConnection()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("suppresses SSE on admin obs-text preview iframe", () => {
    const w = {
      location: {
        pathname: "/overlay/obs-text",
        search: "?u=finalent&hubPreview=1&adminPreviewEmbed=1",
      },
      parent: null as unknown as Window,
    };
    w.parent = w as unknown as Window;
    vi.stubGlobal("window", w);
    expect(shouldSuppressOverlaySseConnection()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("allows OBS sig-match URL without hub flags", () => {
    const w = {
      location: {
        pathname: "/overlay/sig-match",
        search: "?u=finalent",
      },
      parent: null as unknown as Window,
    };
    w.parent = w as unknown as Window;
    vi.stubGlobal("window", w);
    expect(shouldSuppressOverlaySseConnection()).toBe(false);
    vi.unstubAllGlobals();
  });
});
