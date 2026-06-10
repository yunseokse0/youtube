import type { CSSProperties } from "react";

const DEFAULT_OUTLINE_COLOR = "rgba(6, 12, 24, 0.95)";

/** 텍스트 오버레이·방송 오버레이(엑셀표·후원순위·목표) 공통 기본값 */
export const DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR = DEFAULT_OUTLINE_COLOR;
export const DEFAULT_OVERLAY_TEXT_OUTLINE_WIDTH_PX = 1.25;

/** 글자 크기에 맞춰 외곽선 두께(px). 0이면 외곽선 없음 */
export function resolveTextOutlineWidthPx(fontSizePx: number, rawWidth?: number): number {
  if (rawWidth != null && Number.isFinite(rawWidth)) {
    if (rawWidth <= 0) return 0;
    return Math.max(0.5, Math.min(3, rawWidth));
  }
  return Math.max(0.8, Math.min(2.5, fontSizePx * 0.06));
}

/** OBS·Prism에서 text-shadow만으로는 외곽선이 빠지는 경우가 있어 stroke + shadow 병행 */
export function buildTextOutlineStyle(opts: {
  fontSizePx: number;
  outlineColor?: string;
  outlineWidthPx?: number;
}): Pick<CSSProperties, "textShadow" | "WebkitTextStroke" | "paintOrder"> {
  const w = resolveTextOutlineWidthPx(opts.fontSizePx, opts.outlineWidthPx);
  if (w <= 0) return {};
  const color = (opts.outlineColor || "").trim() || DEFAULT_OUTLINE_COLOR;
  const blur = Math.max(1, Math.round(w));
  return {
    textShadow: [
      `0 0 ${blur}px ${color}`,
      `0 1px 0 ${color}`,
      `0 -1px 0 ${color}`,
      `1px 0 0 ${color}`,
      `-1px 0 0 ${color}`,
      `-1px -1px 0 ${color}`,
      `1px -1px 0 ${color}`,
      `-1px 1px 0 ${color}`,
      `1px 1px 0 ${color}`,
      `0 2px ${Math.max(2, Math.round(w * 4))}px rgba(0,0,0,0.45)`,
    ].join(", "),
    WebkitTextStroke: `${w}px ${color}`,
    paintOrder: "stroke fill",
  };
}

/**
 * 방송 오버레이용 — 미설정 시 텍스트 오버레이와 동일한 기본 두께(1.25px).
 * `outlineWidthPx === 0` 이면 외곽선 없음.
 */
export function buildBroadcastTextOutlineStyle(opts: {
  fontSizePx: number;
  outlineColor?: string;
  outlineWidthPx?: number;
}): Pick<CSSProperties, "textShadow" | "WebkitTextStroke" | "paintOrder"> {
  if (opts.outlineWidthPx === 0) return {};
  const width =
    opts.outlineWidthPx != null && Number.isFinite(opts.outlineWidthPx) && opts.outlineWidthPx > 0
      ? opts.outlineWidthPx
      : DEFAULT_OVERLAY_TEXT_OUTLINE_WIDTH_PX;
  return buildTextOutlineStyle({
    fontSizePx: opts.fontSizePx,
    outlineColor: (opts.outlineColor || "").trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR,
    outlineWidthPx: width,
  });
}

/**
 * OBS CEF용 조밀 text-shadow 링 — `obs-text-overlay`의 `buildTextOutlineShadow`와 동일 패턴.
 * stroke가 무시되는 환경에서도 엑셀표·순위 글자 외곽이 보이게 한다.
 */
export function buildBroadcastTextOutlineShadowCss(opts: {
  outlineColor?: string;
  outlineWidthPx?: number;
}): string | undefined {
  if (opts.outlineWidthPx === 0) return undefined;
  const color = (opts.outlineColor || "").trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR;
  const w =
    opts.outlineWidthPx != null && Number.isFinite(opts.outlineWidthPx) && opts.outlineWidthPx > 0
      ? Math.max(0.5, Math.min(3, opts.outlineWidthPx))
      : DEFAULT_OVERLAY_TEXT_OUTLINE_WIDTH_PX;
  const ringW = Math.max(1, Math.round(w));
  const parts: string[] = [];
  for (let dx = -ringW; dx <= ringW; dx++) {
    for (let dy = -ringW; dy <= ringW; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (dx * dx + dy * dy > ringW * ringW + 1) continue;
      parts.push(`${dx}px ${dy}px 0 ${color}`);
    }
  }
  parts.push(`0 ${Math.max(2, ringW)}px ${ringW * 2}px rgba(0,0,0,0.45)`);
  return parts.join(", ");
}
