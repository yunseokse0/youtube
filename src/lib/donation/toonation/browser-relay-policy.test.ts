import { describe, expect, it } from "vitest";
import { shouldRunBrowserToonationRelay } from "./browser-relay-policy";

describe("shouldRunBrowserToonationRelay", () => {
  it("runs fallback when server status missing", () => {
    expect(shouldRunBrowserToonationRelay(null)).toBe(true);
  });

  it("runs fallback when server ws disconnected", () => {
    expect(
      shouldRunBrowserToonationRelay({
        enabled: true,
        connected: false,
        alertboxUrl: "https://toon.at/x",
      })
    ).toBe(true);
  });

  it("skips browser relay when server connected (Jul 29)", () => {
    expect(
      shouldRunBrowserToonationRelay({
        enabled: true,
        connected: true,
        lastEventAt: Date.now() - 10_000,
        lastDonationAt: undefined,
      })
    ).toBe(false);
  });

  it("skips browser relay when server connected and receiving donations", () => {
    expect(
      shouldRunBrowserToonationRelay({
        enabled: true,
        connected: true,
        lastEventAt: Date.now() - 5_000,
        lastDonationAt: Date.now() - 4_000,
      })
    ).toBe(false);
  });
});
