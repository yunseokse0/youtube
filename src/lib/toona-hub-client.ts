import { normalizeToonaApiBaseUrl } from "@/lib/toona-sig-import";
import { getToonaApiBaseUrl, getYoutubePublicBaseUrl } from "@/lib/toona-link";
import {
  appendToonaHubDonationLog,
  clearToonaHubDonationLogs,
  publicToonaHubSession,
  readToonaHubDonationLogs,
  readToonaHubSession,
  writeToonaHubSession,
  type ToonaHubSession,
} from "@/lib/toona-hub-session";

export type ToonaHubLoginInput = {
  youtubeUserId: string;
  email: string;
  password: string;
  baseUrl?: string;
  youtubePublicBaseUrl: string;
};

export async function loginAndLinkToonaHub(input: ToonaHubLoginInput): Promise<
  | { ok: true; session: ReturnType<typeof publicToonaHubSession> }
  | { ok: false; error: string }
> {
  const youtubeUserId = String(input.youtubeUserId || "").trim();
  const email = String(input.email || "").trim();
  const password = String(input.password || "");
  const baseUrl =
    normalizeToonaApiBaseUrl(String(input.baseUrl || "").trim()) || getToonaApiBaseUrl();

  if (!youtubeUserId) return { ok: false, error: "youtube_user_required" };
  if (!baseUrl) return { ok: false, error: "toona_base_url_required" };
  if (!email || !password) return { ok: false, error: "credentials_required" };

  let loginRes: Response;
  try {
    loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(20_000),
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
    baseUrl: input.youtubePublicBaseUrl.replace(/\/$/, ""),
    userId: youtubeUserId,
    scenario: "A",
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
      signal: AbortSignal.timeout(20_000),
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
    lastIngestError: patchJson.lastIngestError ?? null,
    youtubegitEnabled: patchJson.enabled !== false,
    youtubeUserId,
  };

  await writeToonaHubSession(session);
  await clearToonaHubDonationLogs(youtubeUserId);

  return { ok: true, session: publicToonaHubSession(session) };
}

export async function refreshToonaHubStatus(youtubeUserId: string): Promise<{
  session: ReturnType<typeof publicToonaHubSession>;
  logs: Awaited<ReturnType<typeof readToonaHubDonationLogs>>;
}> {
  const session = await readToonaHubSession(youtubeUserId);
  if (!session) {
    return { session: null, logs: [] };
  }

  try {
    const res = await fetch(
      `${session.baseUrl}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        signal: AbortSignal.timeout(15_000),
      }
    );
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      enabled?: boolean;
      lastIngestAt?: string | null;
      lastIngestOk?: boolean | null;
      lastIngestError?: string | null;
      userId?: string;
    };

    if (!res.ok) {
      session.lastStatusAt = Date.now();
      session.lastStatusOk = false;
      session.lastStatusError = json.error || `HTTP ${res.status}`;
    } else {
      session.lastStatusAt = Date.now();
      session.lastStatusOk = true;
      session.lastStatusError = null;
      session.youtubegitEnabled = json.enabled !== false;
      session.lastIngestAt = json.lastIngestAt ?? null;
      session.lastIngestOk = json.lastIngestOk ?? null;
      session.lastIngestError = json.lastIngestError ?? null;
      if (json.userId) session.youtubeUserId = String(json.userId);
    }
    await writeToonaHubSession(session);
  } catch (err) {
    session.lastStatusAt = Date.now();
    session.lastStatusOk = false;
    session.lastStatusError = err instanceof Error ? err.message : "status_failed";
    await writeToonaHubSession(session);
  }

  const logs = await readToonaHubDonationLogs(youtubeUserId);
  return { session: publicToonaHubSession(session), logs };
}

export async function fetchToonaDonationsSinceLink(youtubeUserId: string): Promise<
  | { ok: true; imported: number }
  | { ok: false; error: string }
> {
  const session = await readToonaHubSession(youtubeUserId);
  if (!session) return { ok: false, error: "not_linked" };

  let res: Response;
  try {
    res = await fetch(
      `${session.baseUrl}/api/donations/${encodeURIComponent(session.streamKey)}?page=1&limit=50`,
      {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        signal: AbortSignal.timeout(20_000),
      }
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "donations_unreachable",
    };
  }

  const json = (await res.json().catch(() => ({}))) as {
    error?: string;
    donations?: Array<{
      id?: string;
      nickname?: string;
      displayNickname?: string;
      amount?: number;
      playerName?: string;
      channel?: string;
      source?: string;
      message?: string;
      createdAt?: string;
    }>;
  };

  if (!res.ok) {
    return { ok: false, error: json.error || `HTTP ${res.status}` };
  }

  let imported = 0;
  for (const d of json.donations || []) {
    const at = d.createdAt ? new Date(d.createdAt).getTime() : Date.now();
    if (!Number.isFinite(at) || at < session.linkedAt - 5_000) continue;
    const id = String(d.id || "").trim();
    if (!id) continue;
    const donorName =
      String(d.displayNickname || d.nickname || "무명").replace(/\s+/g, "") || "무명";
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    if (amount <= 0) continue;
    const isAccount = d.channel === "account" || ["sms", "push", "webhook"].includes(String(d.source || ""));
    await appendToonaHubDonationLog(youtubeUserId, {
      id: `toona:${id}`,
      at,
      donorName,
      amount,
      playerName: d.playerName ? String(d.playerName) : undefined,
      target: isAccount ? "account" : "toon",
      source: "toona",
      message: d.message ? String(d.message).slice(0, 120) : undefined,
    });
    imported += 1;
  }

  return { ok: true, imported };
}

export { getYoutubePublicBaseUrl };
