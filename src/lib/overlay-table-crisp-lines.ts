/**
 * CSS `border` + `border-collapse` + `transform: scale` 는 OBS CEF에서 1px 선이
 * 서브픽셀로 깨져 굵기·밝기가 들쭉날쭉해진다. inset box-shadow 헤어라인이 더 안정적.
 */
export function overlayTableHairlineShadow(
  color: string,
  sides: { top?: boolean | number; right?: boolean | number; bottom?: boolean | number; left?: boolean | number }
): string {
  const parts: string[] = [];
  const px = (v: boolean | number | undefined, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.round(v)) : v ? fallback : 0;
  const top = px(sides.top, 1);
  const right = px(sides.right, 1);
  const bottom = px(sides.bottom, 1);
  const left = px(sides.left, 1);
  if (top) parts.push(`inset 0 ${top}px 0 0 ${color}`);
  if (right) parts.push(`inset -${right}px 0 0 0 ${color}`);
  if (bottom) parts.push(`inset 0 -${bottom}px 0 0 ${color}`);
  if (left) parts.push(`inset ${left}px 0 0 0 ${color}`);
  return parts.join(", ");
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
