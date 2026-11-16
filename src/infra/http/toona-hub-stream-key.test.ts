import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isToonaHubUserLoginRequired,
  readToonaHubPullCursor,
  resolveToonaHubBearer,
  TOONA_HUB_S2S_TOKEN,
  writeToonaHubPullCursor,
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

  it("saves the stream-key session without waiting on hub HTTP", async () => {
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
    expect(out.ok).toBe(true);
    process.env.TOONA_INGEST_SECRET = prev;
  });

  it("resets cursor when switching to a different stream key (different account)", async () => {
    const prev = process.env.TOONA_INGEST_SECRET;
    process.env.TOONA_INGEST_SECRET = "s2s-secret";

    // 1. 이전 계정에서 남겨진 커서 설정
    await writeToonaHubPullCursor("din", { floorAt: 100, fromMs: 100, after: "old_acc_cursor_123" });
    const beforeCursor = await readToonaHubPullCursor("din");
    expect(beforeCursor?.after).toBe("old_acc_cursor_123");

    // 2. 다른 스트림키(다른 계정)로 연동
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ enabled: true }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await linkToonaHubByStreamKey({
      youtubeUserId: "din",
      streamKey: "sk_different_account_456",
      baseUrl: "http://toona.test",
      youtubePublicBaseUrl: "http://youtube.test",
    });
    expect(out.ok).toBe(true);

    // 3. 다른 계정 연동 후 커서가 깨끗이 초기화되었는지 검증 (이전 계정 cursor 잔존 방지)
    const afterCursor = await readToonaHubPullCursor("din");
    expect(afterCursor?.after).toBe("");
    expect(afterCursor?.floorAt).toBe(0);

    process.env.TOONA_INGEST_SECRET = prev;
  });
});
