import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIG_SALES_OVERLAY_POLL_MS,
  shouldSyncOverlayFromStateUpdatedEvent,
  shouldSyncSigSalesFromRouletteSseHint,
} from "./overlay-pull-policy";

describe("shouldSyncSigSalesFromRouletteSseHint", () => {
  it("triggers on new SPINNING session", () => {
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "SPINNING", rouletteSessionId: "session_2" },
        "session_1",
      ),
    ).toBe(true);
  });

  it("ignores same session or non-SPINNING", () => {
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "SPINNING", rouletteSessionId: "session_1" },
        "session_1",
      ),
    ).toBe(false);
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "LANDED", rouletteSessionId: "session_2" },
        "session_1",
      ),
    ).toBe(false);
  });
});

describe("shouldSyncOverlayFromStateUpdatedEvent", () => {
  it("skips stale updatedAt", () => {
    expect(shouldSyncOverlayFromStateUpdatedEvent(100, 200)).toBe(false);
    expect(shouldSyncOverlayFromStateUpdatedEvent(300, 200)).toBe(true);
  });
});

describe("DEFAULT_SIG_SALES_OVERLAY_POLL_MS", () => {
  it("is a short interval for OBS", () => {
    expect(DEFAULT_SIG_SALES_OVERLAY_POLL_MS).toBeGreaterThanOrEqual(800);
    expect(DEFAULT_SIG_SALES_OVERLAY_POLL_MS).toBeLessThanOrEqual(5000);
  });
});
