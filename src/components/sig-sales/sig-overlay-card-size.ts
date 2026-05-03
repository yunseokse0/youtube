import type { CSSProperties } from "react";

/** 참조 아트 기준 가로 202px · 세로 미디어 300px(비율 202:300). `/overlay/sig-sales` 결과 카드 셸 폭 상한 */
export const SIG_OVERLAY_CARD_MAX_PX = 202;

/**
 * 방송용 미디어 박스: **202×300** 세로형(약 2:3) — 개별 시그·한방 카드 동일 비율.
 * min-height 제거: aspect만으로 높이 고정되어 왜곡·과대 없음.
 */
export const SIG_OVERLAY_CARD_MEDIA_BOX_CLASS =
  "mb-1 aspect-[202/300] w-full";

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
