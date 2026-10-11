import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isToonaHubUserLoginRequired,
  resolveToonaHubBearer,
  TOONA_HUB_S2S_TOKEN,
} from "@/lib/toona-hub-session";
import { linkToonaHubByStreamKey } from "@/infra/http/toona-hub-login-link";

describe("isToonaHubUserLoginRequired", () => {
  it("treats hub 401 Korean login error as JWT-only", () => {
    expect(isToonaHubUserLoginRequired(401, "로그인이 필요합니다.")).toBe(true);
    expect(isToonaHubUserLoginRequired(200, "")).toBe(false);
  });
});

describe("resolveToonaHubBearer", () => {
  it("uses ingest secret for stream-key sessions, JWT for login sessions", () => {
    const prev = process.env.TOONA_INGEST_SECRET;
    process.env.TOONA_INGEST_SECRET = "s2s-secret";
    expect(resolveToonaHubBearer({ token: TOONA_HUB_S2S_TOKEN })).toBe("s2s-secret");
    expect(resolveToonaHubBearer({ token: "jwt-from-login" })).toBe("jwt-from-login");
    process.env.TOONA_INGEST_SECRET = prev;
  });
});

describe("linkToonaHubByStreamKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches youtubegit with the stream key and does not call toona login", async () => {
    const prev = process.env.TOONA_INGEST_SECRET;
    process.env.TOONA_INGEST_SECRET = "s2s-secret";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(String(url)).toContain("/api/youtubegit/sk_live_test");
      if (init?.method === "PATCH") {
        const body = JSON.parse(String(init?.body || "{}")) as { scenario?: string; userId?: string };
        expect(body.scenario).toBe("B");
        expect(body.userId).toBe("din");
      }
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await linkToonaHubByStreamKey({
      youtubeUserId: "din",
      streamKey: "sk_live_test",
      baseUrl: "http://toona.test",
      youtubePublicBaseUrl: "http://youtube.test",
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.session?.streamKey).toBe("sk_live_test");
      expect(out.session?.email).toBe("");
    }
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/login"))).toBe(false);
    process.env.TOONA_INGEST_SECRET = prev;
  });

  it("links by stream key even when youtubegit PATCH asks for hub login", async () => {
    const prev = process.env.TOONA_INGEST_SECRET;
    process.env.TOONA_INGEST_SECRET = "s2s-secret";
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "로그인이 필요합니다." }), { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await linkToonaHubByStreamKey({
      youtubeUserId: "din",
      streamKey: "sk_live_test",
      baseUrl: "http://toona.test",
      youtubePublicBaseUrl: "http://youtube.test",
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.session?.streamKey).toBe("sk_live_test");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/login"))).toBe(false);
    process.env.TOONA_INGEST_SECRET = prev;
  });

  it("still links when youtubegit PATCH returns 502 after the stream key is verified", async () => {
    const prev = process.env.TOONA_INGEST_SECRET;
    process.env.TOONA_INGEST_SECRET = "s2s-secret";
    const fetchMock = vi.fn(async () => {
      return new Response("<html>Bad Gateway</html>", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await linkToonaHubByStreamKey({
      youtubeUserId: "din",
      streamKey: "sk_live_test",
      baseUrl: "http://toona.test",
      youtubePublicBaseUrl: "http://youtube.test",
    });
    expect(out.ok).toBe(true);
    process.env.TOONA_INGEST_SECRET = prev;
  });

  it("rejects an unknown stream key from youtubegit GET 404", async () => {
    const prev = process.env.TOONA_INGEST_SECRET;
    process.env.TOONA_INGEST_SECRET = "s2s-secret";
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ error: "존재하지 않는 스트리머입니다." }), { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await linkToonaHubByStreamKey({
      youtubeUserId: "din",
      streamKey: "sk_missing",
      baseUrl: "http://toona.test",
      youtubePublicBaseUrl: "http://youtube.test",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("존재하지 않는 스트리머입니다.");
    process.env.TOONA_INGEST_SECRET = prev;
  });

  it("rejects an empty stream key without calling toona", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const out = await linkToonaHubByStreamKey({
      youtubeUserId: "din",
      streamKey: "  ",
      youtubePublicBaseUrl: "http://youtube.test",
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("stream_key_required");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
