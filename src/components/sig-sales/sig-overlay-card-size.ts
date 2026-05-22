import type { CSSProperties } from "react";

/**
 * 방송 결과 카드 셸 폭 상한(px). 원본 아트 비율은 202×300이나 OBS 세로 합성에서는 더 작게 두는 편이 안전함.
 * 추가 축소는 `/overlay/sig-sales` 의 `sigResultScalePct`(50~100%)로 조절.
 */
/** 개별·한방 결과 카드 공통 폭(SelectedSigs compact `max-w-[188px]` 와 동일) */
export const SIG_OVERLAY_CARD_MAX_PX = 188;

/** 시그 롤링 오버레이 등: 원본 해상도와 무관하게 표시할 고정 프레임(px) — 첨부 아트와 동일 */
export const SIG_ROLLING_MEDIA_WIDTH_PX = 202;
export const SIG_ROLLING_MEDIA_HEIGHT_PX = 300;

/**
 * 방송용 미디어 박스: **202×300** 세로형(약 2:3) — 개별 시그·한방 카드 동일 비율.
 * min-height 제거: aspect만으로 높이 고정되어 왜곡·과대 없음.
 */
export const SIG_OVERLAY_CARD_MEDIA_BOX_CLASS =
  "mb-1 aspect-[202/300] w-full";

/** 방송 오버레이: 개별·한방 카드 하단 이름·금액 줄(동일 높이) */
export const SIG_OVERLAY_CARD_FOOTER_CLASS = "space-y-0.5 px-1 pt-1";
export const SIG_OVERLAY_CARD_NAME_CLASS =
  "truncate font-bold text-white text-[11px] leading-tight sm:text-[12px]";
export const SIG_OVERLAY_CARD_PRICE_CLASS =
  "text-xs font-black tabular-nums text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.88)] sm:text-[13px]";

/** 방송 오버레이 카드 셸(개별 시그) — 한방 카드도 동일 패딩·모서리 */
export const SIG_OVERLAY_CARD_SHELL_CLASS =
  "shrink-0 overflow-hidden rounded-xl border border-white/25 bg-neutral-900/85 px-1.5 py-2 shadow-[0_0_28px_rgba(0,0,0,0.55)]";

/** 한방 시그 — 개별 카드와 동일 px·비율, 금색 테두리만 다름 */
export const SIG_OVERLAY_CARD_ONESHOT_SHELL_CLASS =
  "shrink-0 w-full overflow-hidden rounded-xl border border-yellow-300/70 bg-[linear-gradient(135deg,rgba(245,158,11,0.25),rgba(234,179,8,0.1))] px-1.5 py-2 shadow-[0_0_30px_rgba(250,204,21,0.35)]";

/**
 * flex 줄에서 카드가 줄어들지 않도록 고정.
 * width/min(100%)로 좁은 뷰포트에서는 한 줄당 한 장까지 줄어들게 한다.
 */
export function clampSigOverlayResultScalePct(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw || "").replace(/[^\d]/g, "") || "78", 10);
  if (!Number.isFinite(n)) return 78;
  return Math.max(50, Math.min(100, Math.floor(n)));
}

/**
 * 확정 결과 카드 줄(개별+한방) 축소. `width: 100/scale%` 보정은 레이아웃 폭을 키워 가로 스크롤이 생김 → 사용 안 함.
 * Chromium OBS: `zoom` 우선, 미지원 시 `transform: scale` (부모 `overflow-x-hidden` 권장).
 */
export function sigOverlayResultBandStyle(scalePct: number): CSSProperties {
  const scale = clampSigOverlayResultScalePct(scalePct) / 100;
  const base: CSSProperties = {
    width: "max-content",
    maxWidth: "100%",
  };
  if (Math.abs(scale - 1) < 0.001) {
    return { ...base, transformOrigin: "top center" };
  }
  return {
    ...base,
    zoom: scale,
    transform: `scale(${scale})`,
    transformOrigin: "top center",
  };
}

export function sigOverlayBroadcastCardShellStyle(scalePct = 100): CSSProperties {
  const max = Math.round((SIG_OVERLAY_CARD_MAX_PX * clampSigOverlayResultScalePct(scalePct)) / 100);
  return {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `min(100%, ${max}px)`,
    width: `min(100%, ${max}px)`,
    maxWidth: max,
  };
}
