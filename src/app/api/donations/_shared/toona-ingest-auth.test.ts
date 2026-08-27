import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { verifyToonaIngestAuth } from "./toona-ingest-auth";

describe("verifyToonaIngestAuth", () => {
  const prev = process.env.TOONA_INGEST_SECRET;

  beforeEach(() => {
    process.env.TOONA_INGEST_SECRET = "test-secret";
  });

  afterEach(() => {
    process.env.TOONA_INGEST_SECRET = prev;
  });

  it("accepts valid bearer", () => {
    const req = new Request("http://localhost/api/donations/ingest", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(verifyToonaIngestAuth(req)).toEqual({ ok: true });
  });

  it("rejects missing bearer", () => {
    const req = new Request("http://localhost/api/donations/ingest");
    const result = verifyToonaIngestAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 503 when secret not configured", () => {
    delete process.env.TOONA_INGEST_SECRET;
    const req = new Request("http://localhost/api/donations/ingest", {
      headers: { Authorization: "Bearer x" },
    });
    const result = verifyToonaIngestAuth(req);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });
});
