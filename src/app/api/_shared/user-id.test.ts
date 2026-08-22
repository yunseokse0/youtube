import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getUserIdFromRequest,
  resolveWriteUserId,
} from "@/app/api/_shared/user-id";
import { AUTH_COOKIE } from "@/lib/auth";

function makeReq(url: string, cookieUserId?: string): Request {
  const headers = new Headers();
  if (cookieUserId) {
    const payload = encodeURIComponent(JSON.stringify({ id: cookieUserId }));
    headers.set("cookie", `${AUTH_COOKIE}=${payload}`);
  }
  return new Request(url, { headers });
}

describe("resolveWriteUserId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects anonymous URL-only writes on admin APIs (production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = makeReq("https://example.com/api/state?u=victim");
    const r = resolveWriteUserId(req);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.error).toBe("login_required");
    }
  });

  it("allows anonymous URL writes when allowAnonymousUrlUser (production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const req = makeReq("https://example.com/api/donations/toonation/ingest?u=finalent");
    const r = resolveWriteUserId(req, { allowAnonymousUrlUser: true });
    expect(r).toEqual({ ok: true, userId: "finalent" });
  });

  it("uses cookie and rejects cookie/url mismatch (production)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const ok = resolveWriteUserId(makeReq("https://example.com/api/state?u=finalent", "finalent"));
    expect(ok).toEqual({ ok: true, userId: "finalent" });

    const bad = resolveWriteUserId(makeReq("https://example.com/api/state?u=other", "finalent"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.status).toBe(403);
  });

  it("GET helper still prefers ?u= for OBS", () => {
    const req = makeReq("https://example.com/api/state?u=obsuser", "finalent");
    expect(getUserIdFromRequest(req)).toBe("obsuser");
  });
});
