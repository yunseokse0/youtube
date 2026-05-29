import type { CSSProperties } from "react";

const DEFAULT_OUTLINE_COLOR = "rgba(6, 12, 24, 0.95)";

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
