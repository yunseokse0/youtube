/** OverlayLayoutShell 전용 — overlay-params 대용량 모듈·HMR 순환 참조 회피 */

export const OVERLAY_TOOLS_HUB_PATH_RE =
  /\/(?:demo|gauge-demo|battle-effects-demo|wheel-demo|playthrough|wheel-render-probe)(?:\/|$)/;

/** SSR·hydration: pathname만으로 판별 (window 미사용) */
export function isOverlayToolsHubPath(pathname: string | null): boolean {
  if (!pathname) return true;
  return OVERLAY_TOOLS_HUB_PATH_RE.test(pathname);
}

/** 점검 허브·데모·iframe 미리보기 — OBS `position:fixed` 셸 대신 스크롤 가능 레이아웃 */
export function shouldUseOverlayScrollableShell(pathname: string | null): boolean {
  if (isOverlayToolsHubPath(pathname)) return true;
  if (typeof window === "undefined") return true;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("hubPreview") === "1") return true;
    if (sp.get("adminPreviewEmbed") === "1") return true;
    if ((sp.has("snap") || sp.has("snapKey")) && window.self !== window.top) return true;
    if (window.self !== window.top) return true;
  } catch {
    /* noop */
  }
  return false;
}
