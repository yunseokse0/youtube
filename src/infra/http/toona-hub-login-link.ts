import { normalizeToonaApiBaseUrl } from "@/lib/toona-sig-import";
import { ingestErrorVisibleAfterLink } from "@/lib/toona-hub-ingest-error";
import { buildToonaDonationsPullUrl } from "@/lib/toona-hub-pull";
import { getToonaApiBaseUrl, normalizePublicBaseUrl } from "@/lib/toona-link";
import {
  clearToonaHubDonationLogs,
  publicToonaHubSession,
  readToonaHubPullCursor,
  TOONA_HUB_S2S_TOKEN,
  toonaHubAuthHeaders,
  writeToonaHubPullCursor,
  writeToonaHubSession,
  type ToonaHubSession,
} from "@/lib/toona-hub-session";
import {
  TOONA_HUB_LOGIN_FETCH_MS,
  TOONA_HUB_PATCH_FETCH_MS,
  TOONA_HUB_SESSION_WRITE_MS,
} from "@/lib/toona-hub-login";

export type ToonaHubLoginInput = {
  youtubeUserId: string;
  email: string;
  password: string;
  baseUrl?: string;
  youtubePublicBaseUrl: string;
};

/** 허브 로그인 + youtubegit PATCH + 세션 저장. 시그/후원 ingest 를 끌어오지 않음. */
export async function loginAndLinkToonaHub(input: ToonaHubLoginInput): Promise<
  | { ok: true; session: ReturnType<typeof publicToonaHubSession> }
  | { ok: false; error: string }
> {
  const youtubeUserId = String(input.youtubeUserId || "").trim();
  const email = String(input.email || "").trim();
  const password = String(input.password || "");
  const baseUrl =
    normalizeToonaApiBaseUrl(String(input.baseUrl || "").trim()) || getToonaApiBaseUrl();
  const youtubePublicBaseUrl =
    normalizePublicBaseUrl(String(input.youtubePublicBaseUrl || "").trim()) ||
    String(input.youtubePublicBaseUrl || "").trim().replace(/\/$/, "");

  if (!youtubeUserId) return { ok: false, error: "youtube_user_required" };
  if (!baseUrl) return { ok: false, error: "toona_base_url_required" };
  if (!email || !password) return { ok: false, error: "credentials_required" };

  let loginRes: Response;
  try {
    loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(TOONA_HUB_LOGIN_FETCH_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: `toona_unreachable: ${err instanceof Error ? err.message : "fetch_failed"}`,
    };
  }

  const loginJson = (await loginRes.json().catch(() => ({}))) as {
    token?: string;
    streamKey?: string | null;
    error?: string;
    user?: { displayName?: string; email?: string };
  };

  if (!loginRes.ok || !loginJson.token) {
    return {
      ok: false,
      error: loginJson.error || `login_failed HTTP ${loginRes.status}`,
    };
  }

  const streamKey = String(loginJson.streamKey || "").trim();
  if (!streamKey) return { ok: false, error: "no_stream_key" };

  const ingestSecret = String(process.env.TOONA_INGEST_SECRET || "").trim();
  const patchBody = {
    enabled: true,
    baseUrl: youtubePublicBaseUrl,
    userId: youtubeUserId,
    scenario: "B",
    allowEventsFallback: true,
    ...(ingestSecret ? { ingestSecret } : {}),
  };

  let patchRes: Response;
  try {
    patchRes = await fetch(`${baseUrl}/api/youtubegit/${encodeURIComponent(streamKey)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify(patchBody),
      signal: AbortSignal.timeout(TOONA_HUB_PATCH_FETCH_MS),
    });
  } catch (err) {
    return {
      ok: false,
      error: `youtubegit_unreachable: ${err instanceof Error ? err.message : "fetch_failed"}`,
    };
  }

  const patchJson = (await patchRes.json().catch(() => ({}))) as {
    error?: string;
    enabled?: boolean;
    lastIngestAt?: string | null;
    lastIngestOk?: boolean | null;
    lastIngestError?: string | null;
    userId?: string;
  };

  if (!patchRes.ok) {
    return {
      ok: false,
      error: patchJson.error || `youtubegit_patch_failed HTTP ${patchRes.status}`,
    };
  }

  const linkedAt = Date.now();
  const existingCursor = await readToonaHubPullCursor(youtubeUserId).catch(() => null);
  if (!existingCursor) {
    await writeToonaHubPullCursor(youtubeUserId, { floorAt: 0, fromMs: 0, after: "" }).catch(() => {});
  }
  const session: ToonaHubSession = {
    userId: youtubeUserId,
    baseUrl,
    email: loginJson.user?.email || email,
    streamKey,
    token: loginJson.token,
    linkedAt,
    displayName: loginJson.user?.displayName,
    lastStatusAt: linkedAt,
    lastStatusOk: true,
    lastStatusError: null,
    lastIngestAt: patchJson.lastIngestAt ?? null,
    lastIngestOk: patchJson.lastIngestOk ?? null,
    lastIngestError: ingestErrorVisibleAfterLink({
      linkedAt,
      lastIngestAt: patchJson.lastIngestAt,
      lastIngestOk: patchJson.lastIngestOk,
      lastIngestError: patchJson.lastIngestError,
    }),
    youtubegitEnabled: patchJson.enabled !== false,
    youtubeUserId,
  };

  try {
    await Promise.race([
      writeToonaHubSession(session),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("session_save_timeout")), TOONA_HUB_SESSION_WRITE_MS)
      ),
    ]);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message === "session_save_timeout"
          ? "허브 로그인은 됐지만 youtube 세션 저장이 지연됐습니다. 잠시 후 다시 연결해 주세요."
          : `session_save_failed: ${err instanceof Error ? err.message : "write_failed"}`,
    };
  }
  void clearToonaHubDonationLogs(youtubeUserId).catch(() => {});

  return { ok: true, session: publicToonaHubSession(session) };
}

export type ToonaHubStreamKeyInput = {
  youtubeUserId: string;
  streamKey: string;
  baseUrl?: string;
  youtubePublicBaseUrl: string;
};

/** 스트림 키만으로 youtubegit PATCH + 세션 저장. toona 이메일/비밀번호를 받지 않는다. */
export async function linkToonaHubByStreamKey(input: ToonaHubStreamKeyInput): Promise<
  | { ok: true; session: ReturnType<typeof publicToonaHubSession> }
  | { ok: false; error: string }
> {
  const youtubeUserId = String(input.youtubeUserId || "").trim();
  const streamKey = String(input.streamKey || "").trim();
  const baseUrl =
    normalizeToonaApiBaseUrl(String(input.baseUrl || "").trim()) || getToonaApiBaseUrl();
  const youtubePublicBaseUrl =
    normalizePublicBaseUrl(String(input.youtubePublicBaseUrl || "").trim()) ||
    String(input.youtubePublicBaseUrl || "").trim().replace(/\/$/, "");

  if (!youtubeUserId) return { ok: false, error: "youtube_user_required" };
  if (!streamKey) return { ok: false, error: "stream_key_required" };
  if (!baseUrl) return { ok: false, error: "toona_base_url_required" };

  const ingestSecret = String(process.env.TOONA_INGEST_SECRET || "").trim();
  if (!ingestSecret) return { ok: false, error: "ingest_secret_not_configured" };

  /** youtubegit PATCH는 허브 유저 JWT가 필요하므로, 스트림 키는 후원 pull로 먼저 확인한다. */
  let verifyRes: Response;
  try {
    verifyRes = await fetch(
      buildToonaDonationsPullUrl({ baseUrl, streamKey, fromMs: 0, limit: 1 }),
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(TOONA_HUB_PATCH_FETCH_MS),
      }
    );
  } catch (err) {
    return {
      ok: false,
      error: `toona_unreachable: ${err instanceof Error ? err.message : "fetch_failed"}`,
    };
  }
  const verifyJson = (await verifyRes.json().catch(() => ({}))) as { error?: string };
  if (!verifyRes.ok) {
    return {
      ok: false,
      error: verifyJson.error || `stream_key_verify_failed HTTP ${verifyRes.status}`,
    };
  }

  const patchBody = {
    enabled: true,
    baseUrl: youtubePublicBaseUrl,
    userId: youtubeUserId,
    scenario: "B",
    allowEventsFallback: true,
    ingestSecret,
  };

  let patchJson: {
    error?: string;
    enabled?: boolean;
    lastIngestAt?: string | null;
    lastIngestOk?: boolean | null;
    lastIngestError?: string | null;
    userId?: string;
  } = {};
  try {
    const patchRes = await fetch(`${baseUrl}/api/youtubegit/${encodeURIComponent(streamKey)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...toonaHubAuthHeaders({ token: TOONA_HUB_S2S_TOKEN }),
      },
      body: JSON.stringify(patchBody),
      signal: AbortSignal.timeout(TOONA_HUB_PATCH_FETCH_MS),
    });
    patchJson = (await patchRes.json().catch(() => ({}))) as typeof patchJson;
    /** 시그·후원 pull 은 스트림 키만으로 된다. youtubegit PATCH 실패로 연결 자체를 502 내지 않는다. */
  } catch {
    /** pull 검증은 됐으므로 PATCH 타임아웃·502 는 연결을 막지 않는다 */
  }

  const linkedAt = Date.now();
  const existingCursor = await readToonaHubPullCursor(youtubeUserId).catch(() => null);
  if (!existingCursor) {
    await writeToonaHubPullCursor(youtubeUserId, { floorAt: 0, fromMs: 0, after: "" }).catch(() => {});
  }
  const session: ToonaHubSession = {
    userId: youtubeUserId,
    baseUrl,
    email: "",
    streamKey,
    token: TOONA_HUB_S2S_TOKEN,
    linkedAt,
    displayName: "스트림 키",
    lastStatusAt: linkedAt,
    lastStatusOk: true,
    lastStatusError: null,
    lastIngestAt: patchJson.lastIngestAt ?? null,
    lastIngestOk: patchJson.lastIngestOk ?? null,
    lastIngestError: ingestErrorVisibleAfterLink({
      linkedAt,
      lastIngestAt: patchJson.lastIngestAt,
      lastIngestOk: patchJson.lastIngestOk,
      lastIngestError: patchJson.lastIngestError,
    }),
    youtubegitEnabled: patchJson.enabled !== false,
    youtubeUserId,
  };

  try {
    await Promise.race([
      writeToonaHubSession(session),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("session_save_timeout")), TOONA_HUB_SESSION_WRITE_MS)
      ),
    ]);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message === "session_save_timeout"
          ? "스트림 키는 확인됐지만 youtube 세션 저장이 지연됐습니다. 잠시 후 다시 연결해 주세요."
          : `session_save_failed: ${err instanceof Error ? err.message : "write_failed"}`,
    };
  }
  void clearToonaHubDonationLogs(youtubeUserId).catch(() => {});

  return { ok: true, session: publicToonaHubSession(session) };
}
