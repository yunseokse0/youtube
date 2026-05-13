/**
 * 오버레이 기본: GET /api/state 주기 폴링 없음(관리자 저장 시 SSE `state_updated`·`storage`로만 갱신).
 * 디버그·OBS에서만 예외적으로 폴링을 켜려면 URL에 `?overlayPollMs=3000` (700~120000 ms).
 */
export function readOverlayPollIntervalMs(): number {
  if (typeof window === "undefined") return 0;
  const raw = new URLSearchParams(window.location.search).get("overlayPollMs");
  if (!raw) return 0;
  const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.max(700, Math.min(120_000, n));
}
