import type { CSSProperties } from "react";

/**
 * 방송 결과 카드 셸 폭 상한(px). 원본 아트 비율은 202×300이나 OBS 세로 합성에서는 더 작게 두는 편이 안전함.
 * 추가 축소는 `/overlay/sig-sales` 의 `sigResultScalePct`(zoom)로 조절.
 */
export const SIG_OVERLAY_CARD_MAX_PX = 168;

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

/**
 * flex 줄에서 카드가 줄어들지 않도록 고정.
 * width/min(100%)로 좁은 뷰포트에서는 한 줄당 한 장까지 줄어들게 한다.
 */
export function sigOverlayBroadcastCardShellStyle(): CSSProperties {
  const max = SIG_OVERLAY_CARD_MAX_PX;
  return {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `min(100%, ${max}px)`,
    width: `min(100%, ${max}px)`,
    maxWidth: max,
  };
}
