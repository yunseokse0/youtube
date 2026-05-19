import { describe, expect, it } from "vitest";
import { gunzipSync, gzipSync } from "zlib";

describe("upstash app state gzip envelope", () => {
  it("round-trips gzip base64 envelope", () => {
    const payload = { members: [{ id: "m1", name: "a" }], updatedAt: 1 };
    const json = JSON.stringify(payload);
    const gz = gzipSync(Buffer.from(json, "utf8"));
    const envelope = { __gzipB64: gz.toString("base64") };
    const out = JSON.parse(gunzipSync(Buffer.from(envelope.__gzipB64, "base64")).toString("utf8"));
    expect(out).toEqual(payload);
  });
});
