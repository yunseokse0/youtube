import type { CSSProperties } from "react";

/** 대전 오버레이 배율·가로폭 — CSS zoom 은 레이아웃 폭을 바꿔 iframe에서 줄었다↔늘었다 진동함 */
export function clampBattleOverlayScalePct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(50, Math.min(300, Math.floor(n)));
}

export function clampBattleOverlayContentWidthPct(raw: unknown): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return 100;
  return Math.max(40, Math.min(100, Math.floor(n)));
}

/**
 * 배율은 `transform: scale` 만 사용(레이아웃 박스 불변).
 * `zoom` 은 스크롤바·% 폭과 맞물려 미리보기/OBS에서 무한 리사이즈를 유발한다.
 */
export function buildBattleOverlayContainerStyle(
  scalePct: number,
  contentWidthPct: number
): CSSProperties {
  const scale = clampBattleOverlayScalePct(scalePct) / 100;
  const widthPct = clampBattleOverlayContentWidthPct(contentWidthPct);
  const base: CSSProperties = {
    width: "100%",
    maxWidth: `${widthPct}%`,
  };
  if (scale === 1) return base;
  return {
    ...base,
    transform: `scale(${scale})`,
    transformOrigin: "top center",
    willChange: "transform",
  };
}
