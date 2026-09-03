import { mapToonaSignaturesToSigItems, normalizeToonaApiBaseUrl, type ToonaSignatureRow } from "@/lib/toona-sig-import";
import { getToonaApiBaseUrl, getYoutubePublicBaseUrl, normalizePublicBaseUrl } from "@/lib/toona-link";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { persistContributionFormulaForUser } from "@/lib/contribution-formula-persist";
import {
  appendToonaHubDonationLogs,
  clearToonaHubDonationLogs,
  publicToonaHubSession,
  readToonaHubDonationLogs,
  readToonaHubSession,
  writeToonaHubSession,
  type ToonaHubDonationLog,
  type ToonaHubSession,
} from "@/lib/toona-hub-session";
import type { ContributionFormula, SigItem } from "@/types";
import { handleDinDonationIngest } from "@/lib/donation/din-ingest";
import {
  toonaHubDonationToEvent,
  type ToonaHubDonationApiRow,
} from "@/lib/toona-hub-donation-map";

export { toonaHubDonationToEvent, type ToonaHubDonationApiRow } from "@/lib/toona-hub-donation-map";

/** hub?refresh=1 동시 폭주 방지 (유저당 1개) */
const hubPollInflight = new Map<string, Promise<unknown>>();
const lastDonationPullAt = new Map<string, number>();
const lastBaseUrlRepairAt = new Map<string, number>();
const DONATION_PULL_MIN_INTERVAL_MS = 60_000;
const STATUS_FETCH_MS = 5_000;
const DONATION_FETCH_MS = 8_000;
const BASEURL_REPAIR_COOLDOWN_MS = 5 * 60_000;

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
        signal: AbortSignal.timeout(STATUS_FETCH_MS),
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
      baseUrl?: string | null;
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

      /** 기존 허브 연동이 A(알림만)면 B로 승격 — 폴링마다 PATCH 하지 않음 */
      const scenario = String(json.scenario || "").toUpperCase();
      const promoteCooldownMs = 10 * 60_000;
      const lastPromote = session.scenarioBPromoteAt || 0;
      if (scenario !== "B" && Date.now() - lastPromote > promoteCooldownMs) {
        session.scenarioBPromoteAt = Date.now();
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
              signal: AbortSignal.timeout(STATUS_FETCH_MS),
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

      /** toona에 저장된 youtube baseUrl 이 현재 env 값과 다르면 자가수복 (백틱/따옴포 오염 복구 등) */
      const desiredBaseUrl = normalizePublicBaseUrl(
        String(process.env.YOUTUBE_PUBLIC_BASE_URL || "")
      );
      if (desiredBaseUrl) {
        const storedRaw = String(json.baseUrl || "").trim().replace(/\/$/, "");
        const storedNormalized = normalizePublicBaseUrl(storedRaw);
        const mismatch =
          storedRaw !== desiredBaseUrl &&
          (!storedNormalized || storedNormalized !== desiredBaseUrl);
        const lastRepair = lastBaseUrlRepairAt.get(youtubeUserId) || 0;
        if (mismatch && Date.now() - lastRepair > BASEURL_REPAIR_COOLDOWN_MS) {
          lastBaseUrlRepairAt.set(youtubeUserId, Date.now());
          try {
            const ingestSecret = String(process.env.TOONA_INGEST_SECRET || "").trim();
            const repairRes = await fetch(
              `${session.baseUrl}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
              {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                  Authorization: `Bearer ${session.token}`,
                },
                body: JSON.stringify({
                  baseUrl: desiredBaseUrl,
                  ...(ingestSecret ? { ingestSecret } : {}),
                }),
                signal: AbortSignal.timeout(STATUS_FETCH_MS),
              }
            );
            if (!repairRes.ok) {
              const repairJson = (await repairRes.json().catch(() => ({}))) as { error?: string };
              session.lastStatusError =
                repairJson.error || `baseurl_repair_failed HTTP ${repairRes.status}`;
            }
          } catch (err) {
            session.lastStatusError =
              err instanceof Error ? err.message : "baseurl_repair_failed";
          }
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
  | { ok: true; imported: number; applied: number }
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
        signal: AbortSignal.timeout(DONATION_FETCH_MS),
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
    donations?: ToonaHubDonationApiRow[];
  };

  if (!res.ok) {
    return { ok: false, error: json.error || `HTTP ${res.status}` };
  }

  /**
   * 시나리오 B: toona 후원 ↔ youtube 엑셀 1:1.
   * 실시간 ingest 누락분을 pull 로 보정. 이미 반영된 건은 apply 경로에서 중복 스킵.
   */
  const batch: ToonaHubDonationLog[] = [];
  let applied = 0;
  for (const row of json.donations || []) {
    const event = toonaHubDonationToEvent(row, session.linkedAt);
    if (!event) continue;
    const result = await handleDinDonationIngest(youtubeUserId, event, true);
    if (result.applied) applied += 1;
    batch.push({
      id: `toona:${event.externalId}`,
      at: event.at ? new Date(event.at).getTime() : Date.now(),
      donorName: event.donorName,
      amount: event.amount,
      playerName: event.playerName,
      target: event.target,
      mode: result.mode,
      applied: result.applied,
      source: "toona",
      message: event.message?.slice(0, 120),
    });
  }

  await appendToonaHubDonationLogs(youtubeUserId, batch);
  return { ok: true, imported: batch.length, applied };
}

/**
 * 관리자 hub 폴링용 — 상태 갱신 + (쓰로틀된) 후원 pull.
 * 동시 요청은 같은 Promise를 공유해 Node/MySQL을 막지 않음.
 */
export async function pollToonaHubForAdmin(youtubeUserId: string): Promise<{
  session: ReturnType<typeof publicToonaHubSession>;
  logs: Awaited<ReturnType<typeof readToonaHubDonationLogs>>;
}> {
  const uid = String(youtubeUserId || "").trim();
  const existing = hubPollInflight.get(uid);
  if (existing) {
    return existing as Promise<{
      session: ReturnType<typeof publicToonaHubSession>;
      logs: Awaited<ReturnType<typeof readToonaHubDonationLogs>>;
    }>;
  }

  const run = (async () => {
    const synced = await refreshToonaHubStatus(uid);
    const last = lastDonationPullAt.get(uid) || 0;
    if (Date.now() - last >= DONATION_PULL_MIN_INTERVAL_MS) {
      lastDonationPullAt.set(uid, Date.now());
      await fetchToonaDonationsSinceLink(uid);
    }
    const logs = await readToonaHubDonationLogs(uid);
    return { session: synced.session, logs };
  })().finally(() => {
    hubPollInflight.delete(uid);
  });

  hubPollInflight.set(uid, run);
  return run;
}

export { getYoutubePublicBaseUrl };
