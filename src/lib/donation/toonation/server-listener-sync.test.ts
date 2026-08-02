import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./listener-config-store", () => ({
  readToonationListenerConfig: vi.fn(),
  writeToonationListenerConfig: vi.fn(),
  readAllEnabledToonationListenerConfigs: vi.fn(),
  clearToonationListenerConfig: vi.fn(),
}));

vi.mock("./resolve-payload", () => ({
  resolveToonationWsPayload: vi.fn(),
}));

vi.mock("../server-apply-donation", () => ({
  tryAutoApplyToonationDonationOnServer: vi.fn(),
  enqueueUnmatchedToonationDonation: vi.fn(),
}));

import { readToonationListenerConfig, writeToonationListenerConfig } from "./listener-config-store";
import { syncToonationServerListener } from "./server-listener";

describe("syncToonationServerListener", () => {
  beforeEach(() => {
    vi.mocked(readToonationListenerConfig).mockReset();
    vi.mocked(writeToonationListenerConfig).mockReset();
    vi.mocked(readToonationListenerConfig).mockResolvedValue(null);
  });

  it("preserves alertboxUrl in redis when disabled", async () => {
    vi.mocked(writeToonationListenerConfig).mockResolvedValue(undefined);
    const status = await syncToonationServerListener(
      "finalent",
      "f28dc2204fbaf86fd9df74c12f435c73",
      false,
      "BT태호"
    );
    expect(writeToonationListenerConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "finalent",
        alertboxUrl: expect.stringContaining("f28dc2204fbaf86fd9df74c12f435c73"),
        ownerName: "BT태호",
        enabled: false,
      })
    );
    expect(status?.enabled).toBe(false);
    expect(status?.alertboxUrl).toContain("f28dc2204fbaf86fd9df74c12f435c73");
  });
});
