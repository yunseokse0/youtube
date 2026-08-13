/**
 * CSS `border` + `border-collapse` + `transform: scale` 는 OBS CEF에서 1px 선이
 * 서브픽셀로 깨져 굵기·밝기가 들쭉날쭉해진다.
 * inset box-shadow 헤어라인 + (OBS) 2px 두께가 더 안정적이다.
 */

export type OverlayTableHairlineSides = {
  top?: boolean | number;
  right?: boolean | number;
  bottom?: boolean | number;
  left?: boolean | number;
};

/**
 * OBS/Prism 브라우저 소스는 캔버스 스케일로 1px 이 자주 사라지므로
 * 외부 호스트에서는 기본 2px, 관리자 미리보기는 1px.
 */
export function overlayTableGridLineWidthPx(externalHost: boolean): number {
  return externalHost ? 2 : 1;
}

export function overlayTableHairlineShadow(
  color: string,
  sides: OverlayTableHairlineSides,
  defaultWidthPx: number = 1
): string {
  const fallback = Math.max(1, Math.round(defaultWidthPx) || 1);
  const parts: string[] = [];
  const px = (v: boolean | number | undefined) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.round(v)) : v ? fallback : 0;
  const top = px(sides.top);
  const right = px(sides.right);
  const bottom = px(sides.bottom);
  const left = px(sides.left);
  if (top) parts.push(`inset 0 ${top}px 0 0 ${color}`);
  if (right) parts.push(`inset -${right}px 0 0 0 ${color}`);
  if (bottom) parts.push(`inset 0 -${bottom}px 0 0 ${color}`);
  if (left) parts.push(`inset ${left}px 0 0 0 ${color}`);
  return parts.join(", ");
}

/** 표 외곽 프레임 — spread 1px 대신 inset 4면(스케일에도 상대적으로 안정) */
export function overlayTableOuterFrameShadow(color: string, widthPx: number = 2): string {
  const w = Math.max(1, Math.round(widthPx) || 1);
  return overlayTableHairlineShadow(color, { top: w, right: w, bottom: w, left: w }, w);
}

/**
 * border-separate 표의 셀 그리드: 각 칸 top+left, 마지막 열 right, 마지막 행 bottom.
 * (인접 칸이 선을 공유해 이중선이 되지 않음)
 */
export function overlayTableCellGridCss(opts: {
  lineColor: string;
  widthPx: number;
  /** thead 하단을 조금 더 굵게 (헤더/본문 구분) */
  headerBottomExtraPx?: number;
}): string {
  const w = Math.max(1, Math.round(opts.widthPx) || 1);
  const headerBottom = Math.max(w, Math.round(opts.headerBottomExtraPx ?? w + (w > 1 ? 0 : 1)));
  const c = opts.lineColor;
  const cell = (sides: OverlayTableHairlineSides) => overlayTableHairlineShadow(c, sides, w);
  return `
.overlay-root .overlay-elegant-table thead td {
  border: none !important;
  box-shadow: ${cell({ top: w, left: w, bottom: headerBottom })} !important;
}
.overlay-root .overlay-elegant-table thead td:last-child {
  box-shadow: ${cell({ top: w, left: w, right: w, bottom: headerBottom })} !important;
}
.overlay-root .overlay-elegant-table tbody tr.overlay-row td {
  border: none !important;
  box-shadow: ${cell({ top: w, left: w })} !important;
}
.overlay-root .overlay-elegant-table tbody tr.overlay-row td:last-child {
  box-shadow: ${cell({ top: w, left: w, right: w })} !important;
}
.overlay-root .overlay-elegant-table .overlay-total-row td {
  border: none !important;
  box-shadow: ${cell({ top: w, left: w, bottom: w })} !important;
}
.overlay-root .overlay-elegant-table .overlay-total-row td:last-child {
  box-shadow: ${cell({ top: w, left: w, right: w, bottom: w })} !important;
}
`.trim();
}

/** OBS scale 이 소수일 때 선이 깨지지 않게 DPR 기준으로 가볍게 스냅 */
export function snapOverlayScaleForCrispLines(
  scale: number,
  dpr: number = typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
    ? window.devicePixelRatio
    : 1
): number {
  if (!Number.isFinite(scale) || scale <= 0) return 1;
  const clamped = Math.max(1, Math.min(3, Number.isFinite(dpr) ? dpr : 1));
  return Math.round(scale * clamped * 50) / (clamped * 50);
}
