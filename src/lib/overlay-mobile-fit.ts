/** 좁은 임베드·세로 모바일 방송 뷰포트 (OBS 앱·프리즘·인앱 브라우저) */
export const MOBILE_BROADCAST_MAX_WIDTH = 900;

export type ViewportSize = { w: number; h: number };

export function isPortraitViewport(w: number, h: number): boolean {
  return h > w;
}

export function isNarrowBroadcastViewport(w: number, h: number): boolean {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  if (w <= MOBILE_BROADCAST_MAX_WIDTH) return true;
  if (isPortraitViewport(w, h) && w < 1200) return true;
  return Math.min(w, h) < 520;
}

/** 고정 캔버스(1920×1080 등)를 뷰포트에 contain 맞춤 */
export function computeContainFitScale(
  baseW: number,
  baseH: number,
  viewportW: number,
  viewportH: number,
  padding = 12
): number {
  const availW = Math.max(1, viewportW - padding * 2);
  const availH = Math.max(1, viewportH - padding * 2);
  const sx = availW / Math.max(1, baseW);
  const sy = availH / Math.max(1, baseH);
  return Math.max(0.22, Math.min(2, Math.min(sx, sy)));
}

/** 모바일 방송 — contain 맞춤 + 최소 시인 글자 크기 하한 */
export function computeReadableCanvasScale(
  baseW: number,
  baseH: number,
  viewportW: number,
  viewportH: number,
  baseMemberFontPx: number,
  minEffectiveFontPx = 17,
  padding = 8
): number {
  const contain = computeContainFitScale(baseW, baseH, viewportW, viewportH, padding);
  const target = Math.max(12, Math.round(baseMemberFontPx));
  const minScaleForFont = minEffectiveFontPx / target;
  return Math.max(contain, Math.min(1, minScaleForFont * 0.98));
}

/** transform scale 적용 후에도 화면 px 기준 최소 글자 크기 보장 */
export function ensureCanvasFontPx(
  fontPx: number,
  canvasScale: number,
  minEffectivePx = 17
): number {
  const base = Math.max(1, Math.round(fontPx));
  const scale = Math.max(0.1, canvasScale);
  const effective = base * scale;
  if (effective >= minEffectivePx) return base;
  return Math.min(80, Math.ceil(minEffectivePx / scale));
}

export function clampWidthToViewport(widthPx: number, viewportW: number, margin = 24): number {
  const maxW = Math.max(160, viewportW - margin);
  return Math.max(160, Math.min(widthPx, maxW));
}

/** zoomPct(100=원본)와 뷰포트 폭을 함께 고려 — 좁은 화면에서는 자동 축소 */
export function resolveBroadcastZoomScale(
  zoomPct: number,
  viewportW: number,
  contentWidth: number,
  padding = 24
): number {
  const base = Math.max(0.3, Math.min(3, zoomPct / 100));
  if (!Number.isFinite(viewportW) || viewportW <= 0) return base;
  const avail = Math.max(1, viewportW - padding);
  const fit = avail / Math.max(1, contentWidth);
  if (!isNarrowBroadcastViewport(viewportW, viewportW)) return base;
  return Math.min(base, Math.max(0.22, fit));
}

/**
 * transform scale(top center) + width=100/s% 일 때
 * 레이아웃 박스가 왼쪽으로 삐져나와 가로 스크롤이 생기지 않게 margin-left(%) 보정.
 */
export function broadcastZoomCenterMarginLeftPct(zoomScale: number): number {
  const s = Math.max(0.01, Number(zoomScale) || 1);
  return (100 - 100 / s) / 2;
}
