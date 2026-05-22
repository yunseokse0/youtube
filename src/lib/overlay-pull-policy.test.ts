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
        { sessionId: "session_1", phase: "IDLE" },
      ),
    ).toBe(true);
  });

  it("triggers on LANDED for new session (admin showcase)", () => {
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "LANDED", rouletteSessionId: "session_2" },
        { sessionId: "session_1", phase: "CONFIRMED" },
      ),
    ).toBe(true);
  });

  it("triggers when same session advances phase", () => {
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "LANDED", rouletteSessionId: "session_1" },
        { sessionId: "session_1", phase: "SPINNING" },
      ),
    ).toBe(true);
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "CONFIRM_PENDING", rouletteSessionId: "session_1" },
        { sessionId: "session_1", phase: "LANDED" },
      ),
    ).toBe(true);
  });

  it("ignores same session same or lower phase", () => {
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "SPINNING", rouletteSessionId: "session_1" },
        { sessionId: "session_1", phase: "SPINNING" },
      ),
    ).toBe(false);
    expect(
      shouldSyncSigSalesFromRouletteSseHint(
        { roulettePhase: "SPINNING", rouletteSessionId: "session_1" },
        { sessionId: "session_1", phase: "LANDED" },
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
