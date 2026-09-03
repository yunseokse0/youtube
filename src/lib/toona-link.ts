import { normalizeToonaApiBaseUrl } from "@/lib/toona-sig-import";
import type { StoredAccount } from "@/lib/accounts-storage";

export type ToonaLinkResult =
  | { ok: true; streamKey: string; skipped?: false }
  | { ok: false; error: string; skipped?: false }
  | { ok: true; skipped: true; reason: string };

function stripWrappingQuotes(raw: string): string {
  const s = String(raw || "").trim();
  if (s.length < 2) return s;
  const first = s.charCodeAt(0);
  const last = s.charCodeAt(s.length - 1);
  if (
    (first === 0x60 && last === 0x60) ||
    (first === 0x22 && last === 0x22) ||
    (first === 0x27 && last === 0x27)
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

export function normalizePublicBaseUrl(raw: string): string | null {
  const stripped = stripWrappingQuotes(String(raw || "")).replace(/\/$/, "");
  if (!stripped) return null;
  try {
    const u = new URL(stripped);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export function getToonaApiBaseUrl(): string | null {
  const raw = stripWrappingQuotes(String(process.env.NEXT_PUBLIC_TOONA_API_BASE_URL || ""));
  return normalizeToonaApiBaseUrl(raw);
}

export function getYoutubePublicBaseUrl(req: Request): string {
  const fromEnv = normalizePublicBaseUrl(String(process.env.YOUTUBE_PUBLIC_BASE_URL || ""));
  if (fromEnv) return fromEnv;
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  return `${proto}://${host}`.replace(/\/$/, "");
}

export function resolveToonaLinkCredentials(
  account: StoredAccount | undefined,
  password: string
): { toonaBaseUrl: string; toonaEmail: string; toonaPassword: string } | null {
  if (String(process.env.TOONA_AUTO_LINK || "").trim().toLowerCase() === "false") {
    return null;
  }
  const toonaBaseUrl = getToonaApiBaseUrl();
  const toonaEmail =
    String(account?.toonaEmail || "").trim() ||
    String(process.env.TOONA_AUTO_LINK_EMAIL || "").trim();
  const toonaPassword =
    String(account?.toonaPassword || "").trim() ||
    String(process.env.TOONA_AUTO_LINK_PASSWORD || "").trim() ||
    String(password || "").trim();
  if (!toonaBaseUrl || !toonaEmail || !toonaPassword) return null;
  return { toonaBaseUrl, toonaEmail, toonaPassword };
}

/**
 * youtube 계정 로그인 직후 toona youtubegit 설정을 자동 반영.
 * toona 로그인 → PATCH /api/youtubegit/{streamKey}
 */
export async function linkToonaYoutubeGitOnLogin(opts: {
  youtubeUserId: string;
  toonaBaseUrl: string;
  toonaEmail: string;
  toonaPassword: string;
  youtubePublicBaseUrl: string;
  ingestSecret?: string;
}): Promise<ToonaLinkResult> {
  const {
    youtubeUserId,
    toonaBaseUrl,
    toonaEmail,
    toonaPassword,
    youtubePublicBaseUrl,
    ingestSecret = String(process.env.TOONA_INGEST_SECRET || "").trim(),
  } = opts;

  let loginRes: Response;
  try {
    loginRes = await fetch(`${toonaBaseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email: toonaEmail, password: toonaPassword }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch_failed";
    return { ok: false, error: `toona_login_unreachable: ${message}` };
  }

  const loginJson = (await loginRes.json().catch(() => ({}))) as {
    token?: string;
    streamKey?: string | null;
    error?: string;
  };

  if (!loginRes.ok || !loginJson.token) {
    return {
      ok: false,
      error: loginJson.error || `toona_login_failed HTTP ${loginRes.status}`,
    };
  }

  const streamKey = String(loginJson.streamKey || "").trim();
  if (!streamKey) {
    return { ok: false, error: "toona_no_stream_key" };
  }

  const patchBody = {
    enabled: true,
    baseUrl: youtubePublicBaseUrl.replace(/\/$/, ""),
    userId: youtubeUserId,
    scenario: "A",
    allowEventsFallback: true,
    ...(ingestSecret ? { ingestSecret } : {}),
  };

  let patchRes: Response;
  try {
    patchRes = await fetch(`${toonaBaseUrl}/api/youtubegit/${encodeURIComponent(streamKey)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify(patchBody),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "fetch_failed";
    return { ok: false, error: `youtubegit_patch_unreachable: ${message}` };
  }

  if (!patchRes.ok) {
    const patchJson = (await patchRes.json().catch(() => ({}))) as { error?: string };
    return {
      ok: false,
      error: patchJson.error || `youtubegit_patch_failed HTTP ${patchRes.status}`,
    };
  }

  return { ok: true, streamKey };
}

export function scheduleToonaLinkOnLogin(
  req: Request,
  account: StoredAccount | undefined,
  youtubeUserId: string,
  password: string
): void {
  const creds = resolveToonaLinkCredentials(account, password);
  if (!creds) return;

  const youtubePublicBaseUrl = getYoutubePublicBaseUrl(req);
  void linkToonaYoutubeGitOnLogin({
    youtubeUserId,
    ...creds,
    youtubePublicBaseUrl,
  })
    .then((result) => {
      if (result.ok && !("skipped" in result && result.skipped)) {
        console.info(
          `[toona-link] linked youtube=${youtubeUserId} → toona streamKey=${result.streamKey}`
        );
      } else if (!result.ok) {
        console.warn(`[toona-link] failed youtube=${youtubeUserId}: ${result.error}`);
      }
    })
    .catch((err) => {
      console.warn("[toona-link] unexpected error", err);
    });
}
