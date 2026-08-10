import { describe, expect, it } from "vitest";
import { normalizeDonationListsOverlayConfig } from "./state";

describe("normalizeDonationListsOverlayConfig frame fields", () => {
  it("defaults frame fields when missing", () => {
    const cfg = normalizeDonationListsOverlayConfig(null);
    expect(cfg.frameUrl).toBe("");
    expect(cfg.frameOpacity).toBe(100);
    expect(cfg.frameInset).toBe(32);
    expect(cfg.isFrameEnabled).toBe(false);
  });

  it("sanitizes frame url and clamps opacity/inset", () => {
    const cfg = normalizeDonationListsOverlayConfig({
      frameUrl: "  /uploads/frame.png  ",
      frameOpacity: 140,
      frameInset: 200,
      isFrameEnabled: true,
    });
    expect(cfg.frameUrl).toContain("frame.png");
    expect(cfg.frameOpacity).toBe(100);
    expect(cfg.frameInset).toBe(120);
    expect(cfg.isFrameEnabled).toBe(true);
  });

  it("disables frame when url empty even if flag true", () => {
    const cfg = normalizeDonationListsOverlayConfig({
      frameUrl: "",
      isFrameEnabled: true,
    });
    expect(cfg.isFrameEnabled).toBe(false);
  });

  it("keeps existing bg/body fields while adding frame", () => {
    const cfg = normalizeDonationListsOverlayConfig({
      bgGifUrl: "/images/bg/a.gif",
      isBgEnabled: true,
      bodyImageUrl: "/uploads/body.png",
      isBodyImageEnabled: true,
      frameUrl: "/uploads/frame.png",
      isFrameEnabled: true,
      frameOpacity: 80,
      frameInset: 24,
    });
    expect(cfg.isBgEnabled).toBe(true);
    expect(cfg.isBodyImageEnabled).toBe(true);
    expect(cfg.frameOpacity).toBe(80);
    expect(cfg.frameInset).toBe(24);
    expect(cfg.isFrameEnabled).toBe(true);
  });
});
