import type { CSSProperties } from "react";

/**
 * `/overlay/sig-sales` 등 방송용: 당첨 시그 줄과 한방 시그 카드의 가로를 통일해 비율을 맞춘다.
 * 중간 크기(약 288px): 5개+한방 한 줄·두 줄 배치 시 화면에 들어가기 쉽게 함.
 */
export const SIG_OVERLAY_CARD_MAX_PX = 288;

/** 미디어 영역: 한방 카드(compact)와 동일 비율·최소 높이 */
export const SIG_OVERLAY_CARD_MEDIA_BOX_CLASS =
  "mb-1.5 aspect-[4/3] min-h-[176px] w-full sm:min-h-[196px]";

/**
 * flex 줄에서 카드가 `max-w-[188px]`처럼 줄어들지 않도록 고정.
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
