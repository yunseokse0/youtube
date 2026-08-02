import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveToonationRelayConfigForUser } from "./resolve-relay-config";

vi.mock("./listener-config-store", () => ({
  readToonationListenerConfig: vi.fn(),
}));

import { readToonationListenerConfig } from "./listener-config-store";

describe("resolveToonationRelayConfigForUser", () => {
  beforeEach(() => {
    vi.mocked(readToonationListenerConfig).mockReset();
    delete process.env.NEXT_PUBLIC_TOONATION_LINK_KEY;
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_TOONATION_LINK_KEY;
  });

  it("returns relay config when alertbox exists even if server listener disabled", async () => {
    vi.mocked(readToonationListenerConfig).mockResolvedValue({
      userId: "bttaeho",
      alertboxUrl: "https://toon.at/widget/alertbox/abc123key",
      ownerName: "BT태호",
      enabled: false,
      updatedAt: Date.now(),
    });
    const cfg = await resolveToonationRelayConfigForUser("bttaeho");
    expect(cfg.enabled).toBe(true);
    expect(cfg.linkKey).toBe("abc123key");
    expect(cfg.ownerName).toBe("BT태호");
    expect(cfg.serverListenerEnabled).toBe(false);
  });

  it("falls back to env link key when redis has no config", async () => {
    vi.mocked(readToonationListenerConfig).mockResolvedValue(null);
    process.env.NEXT_PUBLIC_TOONATION_LINK_KEY = "envkey123456";
    const cfg = await resolveToonationRelayConfigForUser("bttaeho");
    expect(cfg.enabled).toBe(true);
    expect(cfg.linkKey).toBe("envkey123456");
  });
});
