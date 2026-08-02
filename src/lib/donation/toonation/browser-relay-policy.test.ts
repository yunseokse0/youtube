import { describe, expect, it } from "vitest";
import {
  shouldPauseServerForBrowserRelayFallback,
  shouldRunBrowserToonationRelay,
} from "./browser-relay-policy";

describe("shouldRunBrowserToonationRelay", () => {
  const now = 1_000_000_000_000;

  it("runs fallback when server status missing", () => {
    expect(shouldRunBrowserToonationRelay(null, now)).toBe(true);
  });

  it("runs fallback when server ws disconnected", () => {
    expect(
      shouldRunBrowserToonationRelay(
        { enabled: true, connected: false, alertboxUrl: "https://toon.at/x" },
        now
      )
    ).toBe(true);
  });

  it("skips browser relay when server connected and receiving donations (Jul 29)", () => {
    expect(
      shouldRunBrowserToonationRelay(
        {
          enabled: true,
          connected: true,
          lastEventAt: now - 5_000,
          lastDonationAt: now - 4_000,
        },
        now
      )
    ).toBe(false);
  });

  it("runs fallback when connected but events without donations (alertbox steal)", () => {
    expect(
      shouldRunBrowserToonationRelay(
        {
          enabled: true,
          connected: true,
          lastEventAt: now - 10_000,
          lastDonationAt: undefined,
        },
        now
      )
    ).toBe(true);
    expect(shouldPauseServerForBrowserRelayFallback(
      {
        enabled: true,
        connected: true,
        lastEventAt: now - 10_000,
      },
      now
    )).toBe(true);
  });
});
