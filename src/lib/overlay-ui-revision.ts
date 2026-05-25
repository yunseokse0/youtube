/**
 * 오버레이 UI 빌드 식별 — DEMO 뱃지·data-overlay-ui·iframe URL 캐시 무효화.
 * UI를 바꿀 때마다 해당 rev 문자열을 올리고 dev는 `npm run dev:clean` 권장.
 */
export const SIG_MATCH_OVERLAY_UI_REV = "v23" as const;
export const MEAL_MATCH_OVERLAY_UI_REV = "v8" as const;

/** iframe URL에 남은 구 rev·빌드 파라미터 제거 */
export function stripOverlayCacheParams(path: string): string {
  const qIdx = path.indexOf("?");
  if (qIdx < 0) return path;
  const base = path.slice(0, qIdx);
  const q = new URLSearchParams(path.slice(qIdx + 1));
  q.delete("overlayUiRev");
  q.delete("_build");
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export const OVERLAY_UI_REVISION = {
  meal: MEAL_MATCH_OVERLAY_UI_REV,
  sig: SIG_MATCH_OVERLAY_UI_REV,
} as const;

/** UI 변경 시 iframe·브라우저 JS 캐시 무효화용 */
export function appendOverlayBuildBust(path: string, rev: string): string {
  const clean = stripOverlayCacheParams(path);
  const sep = clean.includes("?") ? "&" : "?";
  return `${clean}${sep}overlayUiRev=${encodeURIComponent(rev)}&_build=${encodeURIComponent(rev)}`;
}

export function appendSigMatchOverlayCacheParams(path: string): string {
  return appendOverlayBuildBust(path, SIG_MATCH_OVERLAY_UI_REV);
}

export function appendBattleEffectsHubPreviewParams(path: string, battle: "meal" | "sig"): string {
  const rev = battle === "meal" ? MEAL_MATCH_OVERLAY_UI_REV : SIG_MATCH_OVERLAY_UI_REV;
  const withRev = appendOverlayBuildBust(path, rev);
  const sep = withRev.includes("?") ? "&" : "?";
  return `${withRev}${sep}hubPreview=1&scalePct=100`;
}
