import {
  SIG_ROLLING_MEDIA_HEIGHT_PX,
  SIG_ROLLING_MEDIA_WIDTH_PX,
  type SigOverlayMediaOrientation,
} from "@/components/sig-sales/sig-overlay-card-size";

/** 가로형(원본 아트) 300×180 — 세로형은 가로·세로를 교환(180×300) */
export const SIG_ROLLING_LANDSCAPE_MEDIA_WIDTH_PX = SIG_ROLLING_MEDIA_WIDTH_PX;
export const SIG_ROLLING_LANDSCAPE_MEDIA_HEIGHT_PX = SIG_ROLLING_MEDIA_HEIGHT_PX;

export type SigRollingMediaOrientation = SigOverlayMediaOrientation;

export function classifySigRollingOrientation(
  naturalWidth: number,
  naturalHeight: number
): SigRollingMediaOrientation {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return "landscape";
  if (naturalWidth <= 0 || naturalHeight <= 0) return "landscape";
  /** 정사각·가로는 landscape — dummy-sig.svg(320×320)가 세로 프레임으로 잡히지 않게 */
  return naturalWidth >= naturalHeight ? "landscape" : "portrait";
}

export function sigRollingMediaFramePx(orientation: SigRollingMediaOrientation): {
  width: number;
  height: number;
} {
  if (orientation === "landscape") {
    return {
      width: SIG_ROLLING_LANDSCAPE_MEDIA_WIDTH_PX,
      height: SIG_ROLLING_LANDSCAPE_MEDIA_HEIGHT_PX,
    };
  }
  /** 세로형: 300×180을 뒤집은 180×300 */
  return {
    width: SIG_ROLLING_MEDIA_HEIGHT_PX,
    height: SIG_ROLLING_MEDIA_WIDTH_PX,
  };
}

export function sigRollingShellOuterPx(
  orientation: SigRollingMediaOrientation,
  shellPadPx = 6
): { outerWidth: number; outerHeight: number; mediaWidth: number; mediaHeight: number } {
  const { width, height } = sigRollingMediaFramePx(orientation);
  return {
    mediaWidth: width,
    mediaHeight: height,
    outerWidth: width + shellPadPx * 2,
    outerHeight: height + shellPadPx * 2,
  };
}

/** 이름·금액 기본 글자(이전 17/16 → OBS에서 더 잘 보이게 상향) */
export const SIG_ROLLING_CAPTION_NAME_PX_DEFAULT = 24;
export const SIG_ROLLING_CAPTION_PRICE_PX_DEFAULT = 28;
export const SIG_ROLLING_CAPTION_NAME_PX_MIN = 14;
export const SIG_ROLLING_CAPTION_NAME_PX_MAX = 48;
export const SIG_ROLLING_CAPTION_PRICE_PX_MIN = 14;
export const SIG_ROLLING_CAPTION_PRICE_PX_MAX = 56;

export function clampSigRollingCaptionNamePx(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return SIG_ROLLING_CAPTION_NAME_PX_DEFAULT;
  return Math.max(
    SIG_ROLLING_CAPTION_NAME_PX_MIN,
    Math.min(SIG_ROLLING_CAPTION_NAME_PX_MAX, n)
  );
}

export function clampSigRollingCaptionPricePx(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return SIG_ROLLING_CAPTION_PRICE_PX_DEFAULT;
  return Math.max(
    SIG_ROLLING_CAPTION_PRICE_PX_MIN,
    Math.min(SIG_ROLLING_CAPTION_PRICE_PX_MAX, n)
  );
}

/** 패딩·줄간격 포함 캡션 슬롯 높이 */
export function sigRollingCaptionHeightPx(
  namePx = SIG_ROLLING_CAPTION_NAME_PX_DEFAULT,
  pricePx = SIG_ROLLING_CAPTION_PRICE_PX_DEFAULT
): number {
  const name = clampSigRollingCaptionNamePx(namePx);
  const price = clampSigRollingCaptionPricePx(pricePx);
  const padY = 10;
  const gap = 4;
  return Math.ceil(padY + name * 1.2 + gap + price * 1.2 + padY);
}

/** @deprecated 기본 글자 기준 높이 — `sigRollingCaptionHeightPx()` 사용 권장 */
export const SIG_ROLLING_CAPTION_H_PX = sigRollingCaptionHeightPx();

/**
 * 롤링 카드 고정 셸 — 항상 가로 프레임(300×180) + 하단 캡션.
 * 세로 이미지로 셸을 키우면 OBS에서 여백·어긋남이 생기므로 미디어 크기는 고정하고 object-contain 만 사용.
 */
export function sigRollingFixedShellOuterPx(
  shellPadPx = 6,
  opts?: { withCaption?: boolean; captionHeight?: number }
): {
  outerWidth: number;
  outerHeight: number;
  mediaWidth: number;
  mediaHeight: number;
  captionHeight: number;
} {
  const base = sigRollingShellOuterPx("landscape", shellPadPx);
  const captionHeight =
    opts?.withCaption === false
      ? 0
      : typeof opts?.captionHeight === "number" && Number.isFinite(opts.captionHeight)
        ? Math.max(0, Math.floor(opts.captionHeight))
        : SIG_ROLLING_CAPTION_H_PX;
  return {
    ...base,
    captionHeight,
    outerHeight: base.outerHeight + captionHeight,
  };
}

export function sigRollingPairLayoutPx(
  left: SigRollingMediaOrientation,
  right: SigRollingMediaOrientation,
  shellPadPx = 6
): { totalOuterWidth: number; maxOuterHeight: number } {
  const l = sigRollingShellOuterPx(left, shellPadPx);
  const r = sigRollingShellOuterPx(right, shellPadPx);
  return {
    totalOuterWidth: l.outerWidth + r.outerWidth,
    maxOuterHeight: Math.max(l.outerHeight, r.outerHeight),
  };
}

/** 좌·우 모두 고정 셸일 때 페어 레이아웃 */
export function sigRollingFixedPairLayoutPx(
  shellPadPx = 6,
  cards = 2,
  opts?: { withCaption?: boolean; captionHeight?: number }
): {
  totalOuterWidth: number;
  maxOuterHeight: number;
} {
  const s = sigRollingFixedShellOuterPx(shellPadPx, opts);
  const n = Math.max(1, Math.min(2, Math.floor(cards) || 1));
  return {
    totalOuterWidth: s.outerWidth * n,
    maxOuterHeight: s.outerHeight,
  };
}
