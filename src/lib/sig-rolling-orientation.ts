import {
  SIG_ROLLING_MEDIA_HEIGHT_PX,
  SIG_ROLLING_MEDIA_WIDTH_PX,
} from "@/components/sig-sales/sig-overlay-card-size";

/** 세로형(기본) 202×300 — 가로형은 가로·세로를 교환(300×202) */
export const SIG_ROLLING_LANDSCAPE_MEDIA_WIDTH_PX = SIG_ROLLING_MEDIA_HEIGHT_PX;
export const SIG_ROLLING_LANDSCAPE_MEDIA_HEIGHT_PX = SIG_ROLLING_MEDIA_WIDTH_PX;

export type SigRollingMediaOrientation = "portrait" | "landscape";

export function classifySigRollingOrientation(
  naturalWidth: number,
  naturalHeight: number
): SigRollingMediaOrientation {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight)) return "portrait";
  if (naturalWidth <= 0 || naturalHeight <= 0) return "portrait";
  return naturalWidth > naturalHeight ? "landscape" : "portrait";
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
  return {
    width: SIG_ROLLING_MEDIA_WIDTH_PX,
    height: SIG_ROLLING_MEDIA_HEIGHT_PX,
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
