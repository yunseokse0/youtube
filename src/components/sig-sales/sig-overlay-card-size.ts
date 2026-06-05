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
 * 고정 px 높이(`sigOverlayBroadcastMediaBoxStyle`)와 함께 쓸 때는 aspect 클래스를 쓰지 않는다(충돌 시 한방 카드만 납작해짐).
 */
export const SIG_OVERLAY_CARD_MEDIA_BOX_CLASS =
  "mb-1 aspect-[202/300] w-full";

/** 방송 결과 줄: 미디어 영역 고정 높이(px) — aspect 없음 */
export const SIG_OVERLAY_CARD_MEDIA_BOX_BROADCAST_CLASS =
  "relative mb-1 w-full shrink-0 overflow-hidden";

/** 방송 오버레이: 개별·한방 카드 하단 이름·금액 줄(동일 높이) */
export const SIG_OVERLAY_CARD_FOOTER_CLASS =
  "space-y-0.5 rounded-b-[10px] border-t border-white/20 bg-black/92 px-2 py-2";
export const SIG_OVERLAY_CARD_NAME_CLASS =
  "truncate font-extrabold text-[15px] leading-tight text-white sm:text-[17px] [text-shadow:0_1px_0_rgba(0,0,0,1),0_0_10px_rgba(0,0,0,0.95)]";
export const SIG_OVERLAY_CARD_PRICE_CLASS =
  "text-base font-black tabular-nums text-yellow-200 sm:text-[18px] [text-shadow:0_1px_0_rgba(0,0,0,1),0_0_8px_rgba(0,0,0,0.9)]";

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
 * 결과 카드 줄 래퍼. 축소는 `cardScalePct`·셸 px에만 반영(이중 zoom/transform 금지).
 * OBS 구형 CEF는 `zoom`+`transform` 동시 적용 시 줄이 사라지거나 검게 보일 수 있음.
 */
export function sigOverlayResultBandStyle(_scalePct?: number): CSSProperties {
  return {
    width: "max-content",
    maxWidth: "100%",
    transformOrigin: "bottom center",
  };
}

/** `cardScalePct` 반영 폭(px) — 미디어·셸 높이 계산 공통 */
export function sigOverlayBroadcastCardWidthPx(scalePct = 100): number {
  return Math.round((SIG_OVERLAY_CARD_MAX_PX * clampSigOverlayResultScalePct(scalePct)) / 100);
}

/** 개별·한방 동일 202×300 미디어 영역 높이(px) */
export function sigOverlayBroadcastMediaHeightPx(scalePct = 100): number {
  const w = sigOverlayBroadcastCardWidthPx(scalePct);
  return Math.round(w * (SIG_ROLLING_MEDIA_HEIGHT_PX / SIG_ROLLING_MEDIA_WIDTH_PX));
}

export function sigOverlayBroadcastMediaBoxStyle(scalePct = 100): CSSProperties {
  const h = sigOverlayBroadcastMediaHeightPx(scalePct);
  return {
    width: "100%",
    height: `${h}px`,
    minHeight: `${h}px`,
    maxHeight: `${h}px`,
    flexShrink: 0,
  };
}

/** 개별·한방 결과 카드 셸 전체 높이(px) — 동일 값으로 맞춤 */
export function sigOverlayBroadcastCardTotalHeightPx(
  scalePct = 100,
  withToggle = false
): number {
  const mediaH = sigOverlayBroadcastMediaHeightPx(scalePct);
  const footerH = withToggle ? 76 : 58;
  const shellPad = 16;
  return mediaH + footerH + shellPad;
}

export function sigOverlayBroadcastCardShellStyle(
  scalePct = 100,
  opts?: { withToggle?: boolean }
): CSSProperties {
  const max = sigOverlayBroadcastCardWidthPx(scalePct);
  const totalH = sigOverlayBroadcastCardTotalHeightPx(scalePct, Boolean(opts?.withToggle));
  return {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `${max}px`,
    width: `${max}px`,
    minWidth: max,
    maxWidth: max,
    height: totalH,
    minHeight: totalH,
    alignSelf: "stretch",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  };
}

/** 당첨 N장+한방이 한 줄에 잘리지 않도록 카드 폭을 행 너비에 맞춘다(줌 래퍼 대신 카드 자체 축소) */
export function layoutSigOverlayResultRow(opts: {
  cellCount: number;
  userScalePct?: number;
  maxRowWidthPx?: number;
  /** true: OBS에서 카드가 화면보다 넓어져도 뷰포트 맞춤 축소 생략 */
  allowOverflow?: boolean;
}): { cardScalePct: number; bandStyle: CSSProperties } {
  const cells = Math.max(1, Math.floor(opts.cellCount || 1));
  const user = clampSigOverlayResultScalePct(opts.userScalePct ?? 92) / 100;
  const maxW = Math.max(360, Math.floor(opts.maxRowWidthPx ?? 1080));
  const gapPx = 6;
  const natural = cells * SIG_OVERLAY_CARD_MAX_PX + Math.max(0, cells - 1) * gapPx;
  const fit =
    opts.allowOverflow || natural <= 0 ? 1 : Math.min(1, maxW / natural);
  const combined = Math.min(user, fit);
  const cardScalePct = Math.max(62, Math.min(100, Math.floor(combined * 100)));
  return {
    cardScalePct,
    bandStyle: sigOverlayResultBandStyle(cardScalePct),
  };
}
