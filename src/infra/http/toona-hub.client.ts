import { mapToonaSignaturesToSigItems, normalizeToonaApiBaseUrl, type ToonaSignatureRow } from "@/lib/toona-sig-import";
import { ingestErrorVisibleAfterLink } from "@/lib/toona-hub-ingest-error";
import { getToonaApiBaseUrl, getYoutubePublicBaseUrl, normalizePublicBaseUrl } from "@/lib/toona-link";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { persistContributionFormulaForUser } from "@/lib/contribution-formula-persist";
import {
  clearToonaHubDonationLogs,
  publicToonaHubSession,
  readToonaHubDonationLogs,
  readToonaHubPullCursor,
  readToonaHubSession,
  writeToonaHubPullCursor,
  writeToonaHubSession,
  type ToonaHubSession,
} from "@/lib/toona-hub-session";
import type { ContributionFormula, SigItem } from "@/types";
import { handleDinDonationIngest } from "@/lib/donation/din-ingest";
import {
  toonaHubDonationToEvent,
  type ToonaHubDonationApiRow,
} from "@/lib/toona-hub-donation-map";
import {
  buildToonaDonationsPullUrl,
  lastToonaDonationPullId,
  nextToonaDonationPullAfter,
  resolveToonaDonationPullAfter,
  resolveToonaDonationPullFromMs,
  TOONA_DONATION_PULL_MAX_PAGES,
  TOONA_DONATION_PULL_PAGE_SIZE,
} from "@/lib/toona-hub-pull";

export { toonaHubDonationToEvent, type ToonaHubDonationApiRow } from "@/lib/toona-hub-donation-map";
export {
  loginAndLinkToonaHub,
  type ToonaHubLoginInput,
} from "@/infra/http/toona-hub-login-link";

/** hub?refresh=1 동시 폭주 방지 (유저당 1개) */
const hubPollInflight = new Map<string, Promise<unknown>>();
const lastDonationPullAt = new Map<string, number>();
const lastBaseUrlRepairAt = new Map<string, number>();
const DONATION_PULL_MIN_INTERVAL_MS = 60_000;
const STATUS_FETCH_MS = 5_000;
const DONATION_FETCH_MS = 15_000;
const BASEURL_REPAIR_COOLDOWN_MS = 5 * 60_000;

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
  /** BUG FIX: DB에 / 끝나는 baseUrl 저장된 경우 // 중복 URL → 301/timeout 방지 */
  const normalizedBaseUrl =
    normalizeToonaApiBaseUrl(String(session.baseUrl || "").trim()) || session.baseUrl;
  if (normalizedBaseUrl && normalizedBaseUrl !== session.baseUrl) {
    session.baseUrl = normalizedBaseUrl;
    void writeToonaHubSession(session).catch(() => {});
  }
  const safeBase = normalizedBaseUrl || session.baseUrl;

  try {
    const res = await fetch(
      `${safeBase}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
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
      session.lastIngestError = ingestErrorVisibleAfterLink({
        linkedAt: session.linkedAt,
        lastIngestAt: json.lastIngestAt,
        lastIngestOk: json.lastIngestOk,
        lastIngestError: json.lastIngestError,
      });
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
              `${safeBase}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
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
              `${safeBase}/api/youtubegit/${encodeURIComponent(session.streamKey)}`,
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

export async function fetchToonaDonationsSinceLink(youtubeUserId: string, opts?: { ignoreMinInterval?: boolean }): Promise<
  | { ok: true; imported: number; applied: number; skipped?: boolean; skipReason?: string }
  | { ok: false; error: string }
> {
  const uid = String(youtubeUserId || "").trim();
  if (!uid) return { ok: false, error: "invalid_user" };

  /**
   * ✅ 2026-09-09 Hotfix ㉔-1 최전방 정책 가드:
   *  - 사용자 정책에 따라 A 모드 (투네 직접 WS) = DIN 허브 폴링은 절대 실행하면 안됨
   *  - A 모드인데 관리자 페이지에서 DIN 허브 로그인 하고 상태새로고침 버튼 누를때마다
   *    WS 1건 + 폴링 1건 = 2행 복제 Bug 가 재현되던 것을 최전방에서 원천 봉쇄
   *  - ignoreMinInterval=true / 관리자 강제 호출 여부와 무관하게 A 모드 = 100% skip
   */
  try {
    const { isDonationIntakeModeA } = await import("@/policies/donation-intake-mode");
    if (isDonationIntakeModeA()) {
      return { ok: true, imported: 0, applied: 0, skipped: true, skipReason: "A모드=투네직접전용·DIN허브폴링금지" };
    }
  } catch {}

  /** B모드 폴러(180s) + admin(pollToonaHubForAdmin) 중복 호출 방지 전역 가드 */
  const now = Date.now();
  const last = lastDonationPullAt.get(uid) || 0;
  if (!opts?.ignoreMinInterval && now - last < DONATION_PULL_MIN_INTERVAL_MS) {
    return { ok: true, imported: 0, applied: 0, skipped: true };
  }

  /**
   * ✅ 2026-09-09 Hotfix ㉔-2 WS live 우회 가드 강화:
   *  - A 모드가 아니라 B 모드여도, 사용자가 임시로 투네 직접 WS를 켰을수도 있으므로 WS 연결 체크
   *  - 이전: live && !stopped && connected 만 통과 → userId 키 불일치로 live=null 이면 허점
   *  - 변경: live === null 이어도 A모드면 위에서 이미 걸러지고, B모드인데 WS가 우연히 켜져있을수 있으므로
   *    아래 3가지중 어느 하나라도 true 면 skip (OR 로직으로 안전망 강화)
   *    ① live.stopped === false && live.connected === true (실제 WS 살아있음)
   *    ② process.env.TOONATION_WS_DISABLE !== "1" 이 아닌데도 listener 상태맵에 user entry 가 존재 (WS 시작 이력 있음 = WS가 선호 유입 경로)
   */
  try {
    const { getToonationServerListenerStatus } = await import("@/infra/ws/toonation-listener");
    const live = getToonationServerListenerStatus(uid);
    const wsDefinitelyActive =
      (live && !live.stopped && live.connected) === true;
    if (wsDefinitelyActive) {
      lastDonationPullAt.set(uid, now);
      return { ok: true, imported: 0, applied: 0, skipped: true, skipReason: "toonation_WS_live_active" };
    }
  } catch {}

  lastDonationPullAt.set(uid, now);

  const session = await readToonaHubSession(uid);
  if (!session) return { ok: false, error: "not_linked" };

  /**
   * 정산 리셋 / 후원 일괄 삭제의 settlementResetAt · intentionalDonationClearAt 이후만 가져온다.
   * 리셋 이전 후원은 수동 복구를 포함해 이 경로로 되살리지 않는다.
   */
  let intentionalClearAtMs = 0;
  try {
    const { loadAppStateForUserId } = await import("@/lib/app-state-server-load");
    const cur = await loadAppStateForUserId(uid).catch(() => null);
    if (cur) {
      const a = Number(cur.settlementResetAt) || 0;
      const b = Number(cur.intentionalDonationClearAt) || 0;
      intentionalClearAtMs = Math.max(a, b, 0);
    }
  } catch {}

  /** BUG FIX: DB 오염된 trailing slash → // 중복 URL 301/timeout 방지 */
  const safeSessionBase =
    normalizeToonaApiBaseUrl(String(session.baseUrl || "").trim()) || session.baseUrl;
  if (safeSessionBase && safeSessionBase !== session.baseUrl) {
    session.baseUrl = safeSessionBase;
    void writeToonaHubSession(session).catch(() => {});
  }

  /**
   * 시나리오 B: toona 후원 ↔ youtube 정산표 1:1.
   * 한 번에 최대 5,000건만 읽고 커서를 버리면, 원장이 그 한도를 넘은 뒤의 후원은 영영 닿지 않는다.
   * 커서를 저장해 다음 주기가 이어서 읽고, 이미 있는 건은 apply 에서 중복 스킵한다.
   * 재연결로 linkedAt 이 앞으로 가도 저장한 바닥은 유지한다. 정산 리셋이 더 뒤면 바닥만 올린다.
   */
  const savedCursor = await readToonaHubPullCursor(uid).catch(() => null);
  const fromMs = resolveToonaDonationPullFromMs({
    linkedAt: session.linkedAt,
    intentionalClearAtMs,
    persistedFloorAt: savedCursor?.floorAt,
  });
  let imported = 0;
  let applied = 0;
  let after = resolveToonaDonationPullAfter({
    fromMs,
    savedFromMs: savedCursor?.fromMs,
    savedAfter: savedCursor?.after,
  });
  const persistCursor = async (nextAfter: string) => {
    await writeToonaHubPullCursor(uid, { floorAt: fromMs, fromMs, after: nextAfter }).catch(() => {});
  };
  for (let page = 0; page < TOONA_DONATION_PULL_MAX_PAGES; page += 1) {
    const url = buildToonaDonationsPullUrl({
      baseUrl: safeSessionBase,
      streamKey: session.streamKey,
      fromMs,
      limit: TOONA_DONATION_PULL_PAGE_SIZE,
      after,
    });
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        signal: AbortSignal.timeout(DONATION_FETCH_MS),
      });
    } catch (err) {
      await persistCursor(after);
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
      await persistCursor(after);
      return { ok: false, error: json.error || `HTTP ${res.status}` };
    }

    const rows = Array.isArray(json.donations) ? json.donations : [];
    let stoppedOnRow = false;
    for (const row of rows) {
      const event = toonaHubDonationToEvent(row, session.linkedAt, {
        intentionalClearAtMs,
        importFromMs: fromMs,
      });
      if (!event) continue;
      try {
        const result = await handleDinDonationIngest(youtubeUserId, event, true, { logSource: "toona" });
        if (result.applied) applied += 1;
        imported += 1;
      } catch {
        stoppedOnRow = true;
        break;
      }
    }

    const scannedId = lastToonaDonationPullId(rows);
    if (stoppedOnRow) {
      await persistCursor(after);
      break;
    }
    if (scannedId) after = scannedId;
    await persistCursor(after);
    const nextAfter = nextToonaDonationPullAfter(rows, TOONA_DONATION_PULL_PAGE_SIZE);
    if (!nextAfter) break;
  }

  return { ok: true, imported, applied };
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
    /**
     * ✅ 2026-09-09 Hotfix ㉔-3 poll 최전방 가드:
     *  - A 모드 (투네 직접 WS) 는 사용자 정책상 DIN 허브 폴링 자체를 하면 안됨
     *  - fetchToonaDonationsSinceLink 앞단에서도 막지만, refreshToonaHubStatus 호출 전에
     *    여기서도 먼저 체크해서 상태 refresh조차 하지 않음 → 네트워크 콜 / 서버 리소스 절약 + 정책 준수
     *  - 👉 실제로는 /api/toona/hub route 레벨에서 A 모드시 503 + disabled 로 먼저 return 하므로
     *    이 분기는 이중 안전망 용도
     */
    try {
      const { isDonationIntakeModeA } = await import("@/policies/donation-intake-mode");
      if (isDonationIntakeModeA()) {
        const storedSession = await readToonaHubSession(uid).catch(() => null);
        const session = storedSession || {
          userId: uid,
        baseUrl: "",
        email: "",
        token: "",
        streamKey: "",
        linkedAt: 0,
        };
        const logs = await readToonaHubDonationLogs(uid).catch(() => []);
        return {
          session: publicToonaHubSession(session),
          logs,
        };
      }
    } catch {}

    const synced = await refreshToonaHubStatus(uid);
    const last = lastDonationPullAt.get(uid) || 0;
    if (Date.now() - last >= DONATION_PULL_MIN_INTERVAL_MS) {
      lastDonationPullAt.set(uid, Date.now());
      /**
       * ✅ 2026-09-09 Hotfix ㉕-3 관리자 새로고침 폴링 쓰로틀 강화:
       *  - ignoreMinInterval=true → false 로 변경.
       *  - B모드 = DIN 허브 push webhook (/api/donations/ingest) 가 실시간으로 후원을 전송하므로,
       *    관리자 페이지 상태새로고침 버튼 연타로 폴링을 N번 강제 호출할 필요가 없음.
       *  - MIN_INTERVAL=60s 쓰로틀 적용으로 동일 후원 webhook 1건 + poll 1건 중복 append 소스 자체를 줄임.
       *  - (사용자가 정말로 과거 데이터 복구 poll 강제 실행 필요시: route.ts POST body.action="sync-donations&force=1 query param 으로 가능)
       */
      await fetchToonaDonationsSinceLink(uid, { ignoreMinInterval: false });
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
