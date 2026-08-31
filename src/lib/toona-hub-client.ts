import { mapToonaSignaturesToSigItems, normalizeToonaApiBaseUrl, type ToonaSignatureRow } from "@/lib/toona-sig-import";
import { getToonaApiBaseUrl, getYoutubePublicBaseUrl } from "@/lib/toona-link";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { persistContributionFormulaForUser } from "@/lib/contribution-formula-persist";
import {
  appendToonaHubDonationLog,
  clearToonaHubDonationLogs,
  publicToonaHubSession,
  readToonaHubDonationLogs,
  readToonaHubSession,
  writeToonaHubSession,
  type ToonaHubSession,
} from "@/lib/toona-hub-session";
import type { ContributionFormula, SigItem } from "@/types";

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
  /** 허브 모드 = toona만 수집 → youtube는 엑셀·후원자 리스트 반영 필요 (scenario B / applyExcel=true) */
  const patchBody = {
    enabled: true,
    baseUrl: input.youtubePublicBaseUrl.replace(/\/$/, ""),
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

function contributionFormulaFromYoutubegitJson(json: Record<string, unknown>): ContributionFormula | null {
  if (
    json.accountWeightPct === undefined &&
    json.toonWeightPct === undefined &&
    json.accountWeight === undefined &&
    json.toonWeight === undefined
  ) {
    return null;
  }
  return normalizeContributionFormula({
    accountWeightPct: json.accountWeightPct ?? json.accountWeight,
    toonWeightPct: json.toonWeightPct ?? json.toonWeight,
  });
}

/** 허브 연동 시 toona youtubegit에 저장된 기여도 가중치 조회 — 엑셀 apply 동기화용 */
export async function fetchToonaHubContributionFormula(
  youtubeUserId: string
): Promise<ContributionFormula | null> {
  const session = await readToonaHubSession(youtubeUserId);
  if (!session?.token || !session.streamKey || !session.baseUrl) return null;
  try {
    const res = await fetch(
      `${session.baseUrl}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return contributionFormulaFromYoutubegitJson(json);
  } catch {
    return null;
  }
}

/** 기여도 계산식만 toona youtubegit에 동기화 — 도네 얼럿 점수용 (계좌/투네 합산과 무관) */
export async function syncContributionFormulaToToonaHub(
  youtubeUserId: string,
  formula: { accountWeightPct: number; toonWeightPct: number }
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await readToonaHubSession(youtubeUserId);
  const baseUrl =
    normalizeToonaApiBaseUrl(String(session?.baseUrl || "").trim()) || getToonaApiBaseUrl();
  if (!baseUrl) return { ok: false, error: "toona_base_url_required" };

  const ingestSecret = String(process.env.TOONA_INGEST_SECRET || "").trim();
  const payload = {
    userId: youtubeUserId,
    streamKey: session?.streamKey,
    accountWeightPct: formula.accountWeightPct,
    toonWeightPct: formula.toonWeightPct,
  };

  if (ingestSecret) {
    try {
      const s2s = await fetch(`${baseUrl}/api/youtubegit/sync/contribution-formula`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${ingestSecret}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      if (s2s.ok) return { ok: true };
      if (s2s.status !== 404 && s2s.status !== 401) {
        const json = (await s2s.json().catch(() => ({}))) as { error?: string };
        return { ok: false, error: json.error || `s2s_sync_failed HTTP ${s2s.status}` };
      }
    } catch (err) {
      /* JWT 폴백 시도 */
      if (!session?.token || !session.streamKey) {
        return {
          ok: false,
          error: `toona_unreachable: ${err instanceof Error ? err.message : "fetch_failed"}`,
        };
      }
    }
  }

  if (!session?.token || !session.streamKey) {
    return { ok: false, error: "hub_not_linked" };
  }
  try {
    const res = await fetch(
      `${baseUrl}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          accountWeightPct: formula.accountWeightPct,
          toonWeightPct: formula.toonWeightPct,
        }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: json.error || `youtubegit_patch_failed HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `toona_unreachable: ${err instanceof Error ? err.message : "fetch_failed"}`,
    };
  }
}

/** 허브 세션(JWT)으로 toona 시그 목록 조회 — 비밀번호 재입력 없음 */
export async function fetchToonaSignaturesViaHubSession(
  youtubeUserId: string
): Promise<
  | { ok: true; items: SigItem[]; streamKey: string; baseUrl: string; count: number }
  | { ok: false; error: string }
> {
  const session = await readToonaHubSession(youtubeUserId);
  if (!session?.token || !session.streamKey || !session.baseUrl) {
    return { ok: false, error: "hub_not_linked" };
  }
  const baseUrl = normalizeToonaApiBaseUrl(session.baseUrl) || session.baseUrl;
  try {
    const sigRes = await fetch(
      `${baseUrl}/api/signatures/${encodeURIComponent(session.streamKey)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        signal: AbortSignal.timeout(20_000),
      }
    );
    const sigJson = (await sigRes.json().catch(() => ({}))) as {
      signatures?: ToonaSignatureRow[];
      error?: string;
    };
    if (!sigRes.ok) {
      return {
        ok: false,
        error: sigJson.error || `signatures_failed HTTP ${sigRes.status}`,
      };
    }
    const items = mapToonaSignaturesToSigItems(sigJson.signatures || [], baseUrl);
    return {
      ok: true,
      items,
      streamKey: session.streamKey,
      baseUrl,
      count: items.length,
    };
  } catch (err) {
    return {
      ok: false,
      error: `signatures_unreachable: ${err instanceof Error ? err.message : "fetch_failed"}`,
    };
  }
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
      scenario?: string;
      lastIngestAt?: string | null;
      lastIngestOk?: boolean | null;
      lastIngestError?: string | null;
      userId?: string;
      accountWeightPct?: number;
      toonWeightPct?: number;
      accountWeight?: number;
      toonWeight?: number;
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

      const hubFormula = contributionFormulaFromYoutubegitJson(json as Record<string, unknown>);
      if (hubFormula) {
        void persistContributionFormulaForUser(youtubeUserId, hubFormula);
      }

      /** 기존 허브 연동이 A(알림만)면 B로 승격 — 후원자 리스트 미반영 방지 */
      if (String(json.scenario || "").toUpperCase() !== "B") {
        try {
          const patchRes = await fetch(
            `${session.baseUrl}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
            {
              method: "PATCH",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${session.token}`,
              },
              body: JSON.stringify({ scenario: "B" }),
              signal: AbortSignal.timeout(15_000),
            }
          );
          if (!patchRes.ok) {
            const patchJson = (await patchRes.json().catch(() => ({}))) as { error?: string };
            session.lastStatusError =
              patchJson.error || `scenario_B_patch_failed HTTP ${patchRes.status}`;
          }
        } catch (err) {
          session.lastStatusError =
            err instanceof Error ? err.message : "scenario_B_patch_failed";
        }
      }
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
