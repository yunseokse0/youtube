/**
 * 오버레이 기본: GET /api/state 주기 폴링 없음(관리자 저장 시 SSE `state_updated`·`storage`로만 갱신).
 * 디버그·OBS에서만 예외적으로 폴링을 켜려면 URL에 `?overlayPollMs=3000` (700~120000 ms).
 */

/** SSE `state_updated` 연타 시 GET 합치기 — 기본 트레일링 지연(ms) */
export const DEFAULT_STATE_UPDATED_DEBOUNCE_MS = 320;
/** 연속 이벤트가 끊이지 않아도 이 간격(ms)마다 최소 1회는 동기화 */
export const DEFAULT_STATE_UPDATED_MAX_WAIT_MS = 2400;

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

export function readOverlayPollIntervalMs(): number {
  if (typeof window === "undefined") return 0;
  const raw = new URLSearchParams(window.location.search).get("overlayPollMs");
  if (!raw) return 0;
  const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(700, Math.min(120_000, n));
}
