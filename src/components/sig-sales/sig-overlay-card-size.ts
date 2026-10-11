import type { CSSProperties } from "react";
import { buildTextOutlineStyle } from "@/lib/text-outline-style";

/** 시그 판매/롤링 미디어 방향 — 원본 natural 비율로 판별 */
export type SigOverlayMediaOrientation = "portrait" | "landscape";

/**
 * 방송 결과 카드 셸 폭 상한(px). 가로 원본 아트는 **300×180**(5:3).
 * 추가 축소는 `/overlay/sig-sales` 의 `sigResultScalePct`(50~100%)로 조절.
 */
/** 방송 결과 카드 공통 폭. 세로 시그 이름·금액이 한 카드에 들어가게 가로형보다 여유 있게. */
export const SIG_OVERLAY_CARD_MAX_PX = 230;

/** 시그 롤링·카드 미디어 고정 프레임(px) — 가로 원본 300×180 / 세로는 교환 */
export const SIG_ROLLING_MEDIA_WIDTH_PX = 300;
export const SIG_ROLLING_MEDIA_HEIGHT_PX = 180;

/**
 * 방송용 미디어 박스 aspect — 가로 300×180 / 세로 180×300.
 * 고정 px 높이(`sigOverlayBroadcastMediaBoxStyle`)와 함께 쓸 때는 aspect 클래스를 쓰지 않는다.
 */
export const SIG_OVERLAY_CARD_MEDIA_BOX_CLASS =
  "mb-1 aspect-[300/180] w-full";
export const SIG_OVERLAY_CARD_MEDIA_BOX_LANDSCAPE_CLASS = SIG_OVERLAY_CARD_MEDIA_BOX_CLASS;
export const SIG_OVERLAY_CARD_MEDIA_BOX_PORTRAIT_CLASS =
  "mb-1 aspect-[180/300] w-full";

export function sigOverlayCardMediaBoxClass(
  orientation: SigOverlayMediaOrientation = "landscape"
): string {
  return orientation === "portrait"
    ? SIG_OVERLAY_CARD_MEDIA_BOX_PORTRAIT_CLASS
    : SIG_OVERLAY_CARD_MEDIA_BOX_LANDSCAPE_CLASS;
}

/** 방송 결과 줄: 미디어 영역 고정 높이(px) — aspect 없음 */
export const SIG_OVERLAY_CARD_MEDIA_BOX_BROADCAST_CLASS =
  "relative mb-1 w-full shrink-0 overflow-hidden";

/** 방송 오버레이: 개별 시그 하단 이름·금액 — 금액 줄은 잘리지 않게 고정 */
export const SIG_OVERLAY_CARD_FOOTER_H_PX = 90;
export const SIG_OVERLAY_CARD_FOOTER_H_TOGGLE_PX = 108;
export const SIG_OVERLAY_CARD_FOOTER_CLASS =
  "mt-auto flex min-h-[90px] shrink-0 flex-col justify-center gap-0.5 rounded-b-[10px] border-t border-white/15 px-2 py-2";
/** 한방 시그: 이름·금액 영역 반투명 검은 배경 — Tailwind opacity 클래스 대신 인라인 rgba(OBS CEF) */
export const SIG_OVERLAY_CARD_ONESHOT_FOOTER_BG = "rgba(0, 0, 0, 0.72)";
export const SIG_OVERLAY_CARD_ONESHOT_FOOTER_CLASS =
  "relative z-[3] mt-auto flex min-h-[90px] w-full shrink-0 flex-col justify-center gap-0.5 rounded-b-[10px] border-t border-white/15 px-2 py-2";

export function sigOverlayOneShotFooterStyle(): CSSProperties {
  return {
    backgroundColor: SIG_OVERLAY_CARD_ONESHOT_FOOTER_BG,
    width: "100%",
    flexShrink: 0,
    position: "relative",
    zIndex: 3,
  };
}
export const SIG_OVERLAY_CARD_NAME_CLASS =
  "line-clamp-2 shrink-0 break-words font-extrabold text-[18px] leading-snug sm:text-[20px]";
export const SIG_OVERLAY_CARD_PRICE_CLASS =
  "shrink-0 text-[17px] font-black tabular-nums sm:text-[20px]";

const SIG_OVERLAY_TEXT_OUTLINE_COLOR = "rgba(6, 12, 24, 0.95)";

/** 텍스트 오버레이와 동일 — OBS CEF에서 stroke + shadow 병행 */
export function sigOverlayCardNameOutlineStyle(fontSizePx = 18): CSSProperties {
  return {
    color: "#ffffff",
    ...buildTextOutlineStyle({
      fontSizePx,
      outlineColor: SIG_OVERLAY_TEXT_OUTLINE_COLOR,
      outlineWidthPx: 1.25,
    }),
  };
}

export function sigOverlayCardPriceOutlineStyle(fontSizePx = 18): CSSProperties {
  return {
    color: "#fde68a",
    ...buildTextOutlineStyle({
      fontSizePx,
      outlineColor: SIG_OVERLAY_TEXT_OUTLINE_COLOR,
      outlineWidthPx: 1.25,
    }),
  };
}

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

/** `cardScalePct` 반영 가로형 기준 폭(px) */
export function sigOverlayBroadcastCardWidthPx(scalePct = 100): number {
  const n = Math.floor(Number(scalePct) || 100);
  const clamped = Math.max(16, Math.min(100, n));
  return Math.round((SIG_OVERLAY_CARD_MAX_PX * clamped) / 100);
}

/**
 * 방송 미디어 박스 크기(px).
 * - 카드 폭은 가로/세로 모두 기준폭(이름·금액이 들어갈 자리).
 * - landscape: 높이 = 폭×180/300
 * - portrait: 높이 = 폭×300/180 (세로 사진이 좁은 칸에 찌그러지지 않게)
 */
export function sigOverlayBroadcastMediaSizePx(
  scalePct = 100,
  orientation: SigOverlayMediaOrientation = "landscape"
): { width: number; height: number } {
  const baseW = sigOverlayBroadcastCardWidthPx(scalePct);
  if (orientation === "portrait") {
    return {
      width: baseW,
      height: Math.max(
        1,
        Math.round((baseW * SIG_ROLLING_MEDIA_WIDTH_PX) / SIG_ROLLING_MEDIA_HEIGHT_PX)
      ),
    };
  }
  return {
    width: baseW,
    height: Math.max(1, Math.round((baseW * SIG_ROLLING_MEDIA_HEIGHT_PX) / SIG_ROLLING_MEDIA_WIDTH_PX)),
  };
}

/** 가로/세로 미디어 높이 — `sigOverlayBroadcastMediaSizePx` 래퍼 */
export function sigOverlayBroadcastMediaHeightPx(
  scalePct = 100,
  orientation: SigOverlayMediaOrientation = "landscape"
): number {
  return sigOverlayBroadcastMediaSizePx(scalePct, orientation).height;
}

export function sigOverlayBroadcastMediaBoxStyle(
  scalePct = 100,
  orientation: SigOverlayMediaOrientation = "landscape"
): CSSProperties {
  const { height: h } = sigOverlayBroadcastMediaSizePx(scalePct, orientation);
  return {
    width: "100%",
    height: `${h}px`,
    minHeight: `${h}px`,
    maxHeight: `${h}px`,
    flexShrink: 0,
  };
}

/** 개별·한방 결과 카드 셸 전체 높이(px) */
export function sigOverlayBroadcastCardTotalHeightPx(
  scalePct = 100,
  withToggle = false,
  orientation: SigOverlayMediaOrientation = "landscape"
): number {
  const mediaH = sigOverlayBroadcastMediaSizePx(scalePct, orientation).height;
  const footerH = withToggle ? SIG_OVERLAY_CARD_FOOTER_H_TOGGLE_PX : SIG_OVERLAY_CARD_FOOTER_H_PX;
  const shellPad = 16;
  return mediaH + footerH + shellPad;
}

/** 한방 카드는 세로형 개별 시그와 같은 폭·3:5 미디어(가로 이미지를 contain). */
export const SIG_OVERLAY_ONESHOT_WIDTH_MULT = 1;

export function sigOverlayBroadcastOneShotWidthPx(scalePct = 100): number {
  return sigOverlayBroadcastCardWidthPx(scalePct);
}

export function sigOverlayBroadcastOneShotMediaSizePx(scalePct = 100): {
  width: number;
  height: number;
} {
  return sigOverlayBroadcastMediaSizePx(scalePct, "portrait");
}

export function sigOverlayBroadcastOneShotMediaBoxStyle(scalePct = 100): CSSProperties {
  const { height: h } = sigOverlayBroadcastOneShotMediaSizePx(scalePct);
  return {
    width: "100%",
    height: `${h}px`,
    minHeight: `${h}px`,
    maxHeight: `${h}px`,
    flexShrink: 0,
  };
}

export function sigOverlayBroadcastOneShotShellStyle(
  scalePct = 100,
  opts?: { withToggle?: boolean }
): CSSProperties {
  const media = sigOverlayBroadcastOneShotMediaSizePx(scalePct);
  const footerH = opts?.withToggle ? SIG_OVERLAY_CARD_FOOTER_H_TOGGLE_PX : SIG_OVERLAY_CARD_FOOTER_H_PX;
  const shellPad = 16;
  const totalH = media.height + footerH + shellPad;
  return {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `${media.width}px`,
    width: `${media.width}px`,
    minWidth: media.width,
    maxWidth: media.width,
    height: totalH,
    minHeight: totalH,
    alignSelf: "flex-start",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  };
}

export function sigOverlayBroadcastCardShellStyle(
  scalePct = 100,
  opts?: { withToggle?: boolean; orientation?: SigOverlayMediaOrientation }
): CSSProperties {
  const orientation = opts?.orientation ?? "landscape";
  const media = sigOverlayBroadcastMediaSizePx(scalePct, orientation);
  const totalH = sigOverlayBroadcastCardTotalHeightPx(
    scalePct,
    Boolean(opts?.withToggle),
    orientation
  );
  return {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: `${media.width}px`,
    width: `${media.width}px`,
    minWidth: media.width,
    maxWidth: media.width,
    height: totalH,
    minHeight: totalH,
    alignSelf: "flex-start",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  };
}

/** 한방은 개별 세로 시그와 같은 칸 크기(비율 맞춤). */
export const SIG_OVERLAY_ONESHOT_BOOST_MAX_CELLS = 0;

export function shouldBoostOneShotOverlaySize(_cellCount: number, _hasOneShot = true): boolean {
  return false;
}

/** 당첨 N장+한방이 한 줄에 잘리지 않도록 카드 폭을 행 너비에 맞춘다(줌 래퍼 대신 카드 자체 축소) */
export function layoutSigOverlayResultRow(opts: {
  cellCount: number;
  userScalePct?: number;
  maxRowWidthPx?: number;
  /** true: OBS에서 카드가 화면보다 넓어져도 뷰포트 맞춤 축소 생략 */
  allowOverflow?: boolean;
  /** true면 마지막 칸은 한방 가로 카드(더 넓음)로 두고 행 맞춤 폭을 계산 */
  hasOneShot?: boolean;
}): { cardScalePct: number; bandStyle: CSSProperties } {
  const cells = Math.max(1, Math.floor(opts.cellCount || 1));
  const user = clampSigOverlayResultScalePct(opts.userScalePct ?? 92) / 100;
  const maxW = Math.max(360, Math.floor(opts.maxRowWidthPx ?? 1080));
  const gapPx = 6;
  const boostOneShot = shouldBoostOneShotOverlaySize(cells, opts.hasOneShot);
  const oneShotExtra = boostOneShot
    ? SIG_OVERLAY_CARD_MAX_PX * (SIG_OVERLAY_ONESHOT_WIDTH_MULT - 1)
    : 0;
  const natural =
    cells * SIG_OVERLAY_CARD_MAX_PX + Math.max(0, cells - 1) * gapPx + oneShotExtra;
  const fromUser = Math.floor(user * 100);
  if (opts.allowOverflow) {
    const cardScalePct = Math.min(100, Math.max(16, fromUser));
    return {
      cardScalePct,
      bandStyle: sigOverlayResultBandStyle(cardScalePct),
    };
  }
  const fit = natural <= 0 ? 1 : Math.min(1, maxW / natural);
  const combined = Math.min(user, fit);
  /** 정수 폭 반올림까지 고려해 행이 maxW를 넘지 않게(한방 추가 폭 포함) */
  const regularCells = boostOneShot ? Math.max(1, cells - 1) : cells;
  const oneShotFactor = boostOneShot ? SIG_OVERLAY_ONESHOT_WIDTH_MULT : 0;
  const denom =
    regularCells + (boostOneShot ? oneShotFactor : 0);
  const maxCardW = Math.floor(
    (maxW - Math.max(0, cells - 1) * gapPx) / Math.max(1, denom)
  );
  const fromFit = Math.floor((maxCardW / SIG_OVERLAY_CARD_MAX_PX) * 100);
  let cardScalePct = Math.min(100, Math.max(16, Math.min(Math.floor(combined * 100), fromFit)));
  const rowWidthAt = (pct: number) => {
    const regular = boostOneShot ? Math.max(0, cells - 1) : cells;
    const gaps = Math.max(0, cells - 1) * gapPx;
    return (
      regular * sigOverlayBroadcastCardWidthPx(pct) +
      (boostOneShot ? sigOverlayBroadcastOneShotWidthPx(pct) : 0) +
      gaps
    );
  };
  while (cardScalePct > 16 && rowWidthAt(cardScalePct) > maxW) {
    cardScalePct -= 1;
  }
  return {
    cardScalePct,
    bandStyle: sigOverlayResultBandStyle(cardScalePct),
  };
}
