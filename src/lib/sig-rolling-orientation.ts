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
