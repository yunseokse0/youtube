import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveToonaHubBearer, TOONA_HUB_S2S_TOKEN } from "@/lib/toona-hub-session";
import { linkToonaHubByStreamKey } from "@/infra/http/toona-hub-login-link";

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
      expect(init?.method).toBe("PATCH");
      const body = JSON.parse(String(init?.body || "{}")) as { scenario?: string; userId?: string };
      expect(body.scenario).toBe("B");
      expect(body.userId).toBe("din");
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
