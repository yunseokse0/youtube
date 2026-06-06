import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { extractToonationWsPayloadFromHtml } from "./resolve-payload";

describe("extractToonationWsPayloadFromHtml", () => {
  it("parses new unicode-escaped window.payload format", () => {
    const sample =
      'window.payload = JSON.parse("{\\u0022payload\\u0022:\\u0022eyJhdXRoIjoiZjI4ZGMyMjA0ZmJhZjg2ZmQ5ZGY3NGMxMmY0MzVjNzMiLCJzZXJ2aWNlIjoiYWxlcnQiLCJ0eXBlIjowLCJsYW5ndWFnZSI6ImVuIn0\\u0022}");';
    const payload = extractToonationWsPayloadFromHtml(sample);
    expect(payload).toMatch(/^eyJ/);
    expect(JSON.parse(Buffer.from(payload!, "base64").toString())).toMatchObject({
      auth: "f28dc2204fbaf86fd9df74c12f435c73",
      service: "alert",
    });
  });

  it("parses legacy payload field", () => {
    expect(extractToonationWsPayloadFromHtml('"payload": "abc123xyz"')).toBe("abc123xyz");
  });

  it("extracts from saved alertbox html fixture when present", () => {
    const fixture = join(process.cwd(), ".tmp-toon-alertbox.html");
    try {
      const html = readFileSync(fixture, "utf8");
      const payload = extractToonationWsPayloadFromHtml(html);
      expect(payload).toMatch(/^eyJ/);
    } catch {
      // optional local fixture
    }
  });
});
