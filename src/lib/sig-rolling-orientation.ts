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

/**
 * 가로(300×180)·세로(180×300)를 모두 담는 고정 셸.
 * 방향이 바뀔 때마다 프레임 크기가 바뀌면 OBS에서 깜빡임처럼 보인다.
 */
export function sigRollingFixedShellOuterPx(shellPadPx = 6): {
  outerWidth: number;
  outerHeight: number;
  mediaWidth: number;
  mediaHeight: number;
} {
  const mediaWidth = Math.max(SIG_ROLLING_LANDSCAPE_MEDIA_WIDTH_PX, SIG_ROLLING_LANDSCAPE_MEDIA_HEIGHT_PX);
  const mediaHeight = mediaWidth;
  return {
    mediaWidth,
    mediaHeight,
    outerWidth: mediaWidth + shellPadPx * 2,
    outerHeight: mediaHeight + shellPadPx * 2,
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
export function sigRollingFixedPairLayoutPx(shellPadPx = 6, cards = 2): {
  totalOuterWidth: number;
  maxOuterHeight: number;
} {
  const s = sigRollingFixedShellOuterPx(shellPadPx);
  const n = Math.max(1, Math.min(2, Math.floor(cards) || 1));
  return {
    totalOuterWidth: s.outerWidth * n,
    maxOuterHeight: s.outerHeight,
  };
}
