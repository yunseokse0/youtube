import { describe, expect, it } from "vitest";
import { toonationListenerStatusFromServer } from "./listener";

describe("toonationListenerStatusFromServer", () => {
  it("shows syncing when socket on but server status missing", () => {
    const status = toonationListenerStatusFromServer(null, { socketEnabled: true });
    expect(status.kind).toBe("syncing");
    expect(status.message).toContain("연동");
  });

  it("shows relay activity when ingest meta is recent", () => {
    const status = toonationListenerStatusFromServer(
      {
        userId: "finalent",
        enabled: false,
        alertboxUrl: "https://toon.at/widget/alertbox/abc",
        connected: false,
        lastEventAt: Date.now() - 5_000,
        updatedAt: Date.now(),
      },
      { socketEnabled: true }
    );
    expect(status.kind).toBe("connected");
    expect(status.message).toContain("릴레이");
  });
});
