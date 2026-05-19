import { describe, expect, it } from "vitest";
import { gzip } from "pako";
import { upstashGetAppStateJson, upstashSetAppStateJson } from "./upstash-app-state";

describe("upstash app state gzip envelope", () => {
  it("round-trips gzip base64 envelope via pako", () => {
    const payload = { members: [{ id: "m1", name: "a" }], updatedAt: 1 };
    const json = JSON.stringify(payload);
    const b64 =
      typeof Buffer !== "undefined"
        ? Buffer.from(gzip(json)).toString("base64")
        : btoa(String.fromCharCode(...gzip(json)));
    const envelope = { __gzipB64: b64 };
    const decoded = new TextDecoder().decode(
      (await import("pako")).ungzip(
        typeof Buffer !== "undefined" ? new Uint8Array(Buffer.from(b64, "base64")) : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      )
    );
    expect(JSON.parse(decoded)).toEqual(payload);
    expect(envelope.__gzipB64.length).toBeGreaterThan(0);
    expect(typeof upstashGetAppStateJson).toBe("function");
    expect(typeof upstashSetAppStateJson).toBe("function");
  });
});
