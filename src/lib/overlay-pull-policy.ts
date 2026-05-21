/**
 * 오버레이 기본: GET /api/state **주기 폴링 없음**.
 * - 관리자 「현재 설정 저장」·회전판 spin/finish 등 → SSE `state_updated`(updatedAt만) → 디바운스 후 GET 1회
 * - `?since=` + 304: 서버 상태가 이미 최신이면 본문 생략
 * - SSE 끊김 시에만 `readOverlaySseFallbackPollMs()` (기본 90s, env로 조절)
 * - 시그 판매 OBS(`/overlay/sig-sales`): `readSigSalesOverlayPollMs()` 기본 2s (OBS CEF·SSE 불안정 대비)
 * - 주기 폴링 URL 쿼리 `overlayPollMs` 는 사용하지 않음(로드 시 제거·무시). 디버그만 env `NEXT_PUBLIC_OVERLAY_DEBUG_POLL_MS`
 */

/** SSE `state_updated` 연타 시 GET 합치기 — 기본 트레일링 지연(ms) */
export const DEFAULT_STATE_UPDATED_DEBOUNCE_MS = 320;
/** 연속 이벤트가 끊이지 않아도 이 간격(ms)마다 최소 1회는 동기화 */
export const DEFAULT_STATE_UPDATED_MAX_WAIT_MS = 2400;
/** 후원·순위 반영 — 짧은 디바운스(느리게 느껴지지 않게) */
export const DONOR_STATE_UPDATED_DEBOUNCE_MS = 60;
export const DONOR_STATE_UPDATED_MAX_WAIT_MS = 350;

export type StateUpdatedScheduler = { schedule: () => void; cancel: () => void };

/**
 * 저장 한 번에 브로드캐스트되는 `state_updated`가 OBS 소스 수만큼 곱해지며 GET이 폭주하는 것을 막는다.
 * `run` 안에서는 `syncFromApiRef.current`처럼 ref만 호출해 최신 클로저를 쓴다.
 */
export function createStateUpdatedScheduler(
  run: () => void | Promise<void>,
  options?: { debounceMs?: number; maxWaitMs?: number }
): StateUpdatedScheduler {
  const debounceMs = Math.max(40, options?.debounceMs ?? DEFAULT_STATE_UPDATED_DEBOUNCE_MS);
  const maxWaitMs = Math.max(debounceMs, options?.maxWaitMs ?? DEFAULT_STATE_UPDATED_MAX_WAIT_MS);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  const clearDebounce = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const clearMax = () => {
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const cancel = () => {
    clearDebounce();
    clearMax();
  };

  const schedule = () => {
    if (!maxWaitTimer) {
      maxWaitTimer = setTimeout(() => {
        maxWaitTimer = null;
        clearDebounce();
        void run();
      }, maxWaitMs);
    }
    clearDebounce();
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      clearMax();
      void run();
    }, debounceMs);
  };

  return { schedule, cancel };
}

/** 방송 기본 0. 개발·진단만 `NEXT_PUBLIC_OVERLAY_DEBUG_POLL_MS`(700~120000) */
export function readOverlayPollIntervalMs(): number {
  if (typeof window === "undefined") return 0;
  const env = String(process.env.NEXT_PUBLIC_OVERLAY_DEBUG_POLL_MS ?? "").trim();
  if (!env) return 0;
  const n = parseInt(env.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(700, Math.min(120_000, n));
}

/** OBS 시그 판매 회전판 — CEF에서 SSE가 끊겨도 SPINNING을 잡기 위한 기본 주기(ms). `NEXT_PUBLIC_SIG_SALES_OVERLAY_POLL_MS=0` 으로 끔 */
export const DEFAULT_SIG_SALES_OVERLAY_POLL_MS = 2000;

export function readSigSalesOverlayPollMs(): number {
  if (typeof window === "undefined") return DEFAULT_SIG_SALES_OVERLAY_POLL_MS;
  const env = String(process.env.NEXT_PUBLIC_SIG_SALES_OVERLAY_POLL_MS ?? "").trim();
  if (env === "0") return 0;
  if (!env) return DEFAULT_SIG_SALES_OVERLAY_POLL_MS;
  const n = parseInt(env.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SIG_SALES_OVERLAY_POLL_MS;
  return Math.max(800, Math.min(30_000, n));
}

/** SSE 연결 끊김 시에만 쓰는 느린 폴백(기본 90s). `NEXT_PUBLIC_OVERLAY_SSE_FALLBACK_MS=0` 으로 끔 */
export function readOverlaySseFallbackPollMs(): number {
  if (typeof window === "undefined") return 0;
  const env = String(process.env.NEXT_PUBLIC_OVERLAY_SSE_FALLBACK_MS ?? "90000").trim();
  const n = parseInt(env.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(15_000, Math.min(600_000, n));
}

/** SSE `state_updated` — 이미 반영한 updatedAt 이면 GET 생략 */
export function shouldSyncOverlayFromStateUpdatedEvent(
  eventUpdatedAt: unknown,
  lastSyncedUpdatedAt: number
): boolean {
  const ts = Number(eventUpdatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return ts > lastSyncedUpdatedAt;
}

/** 회전판 SSE에 실린 sessionId가 바뀌면 updatedAt 경합과 무관하게 OBS가 한 번 더 당겨야 함 */
export function shouldSyncSigSalesFromRouletteSseHint(
  event: { roulettePhase?: unknown; rouletteSessionId?: unknown },
  lastSeenRouletteSessionId: string
): boolean {
  if (String(event.roulettePhase || "") !== "SPINNING") return false;
  const sid = String(event.rouletteSessionId || "").trim();
  if (!sid) return false;
  return sid !== lastSeenRouletteSessionId;
}

/**
 * 후원 순위 오버레이: `donorRankingsUpdatedAt` 가 올라갔을 때만 GET.
 * 회전판 등만 바뀐 이벤트(updatedAt만)는 무시.
 */
export function shouldSyncDonorRankingsFromStateUpdatedEvent(
  event: { updatedAt?: unknown; donorRankingsUpdatedAt?: unknown },
  lastSyncedDonorRankingsAt: number
): boolean {
  const dr = Number(event.donorRankingsUpdatedAt);
  if (Number.isFinite(dr) && dr > 0) return dr > lastSyncedDonorRankingsAt;
  return false;
}
