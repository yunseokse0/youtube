/** 후원 알림·플레이어 알림 금액 단위 (overlaySettings.amountUnit) */

export const DEFAULT_OVERLAY_AMOUNT_UNIT = "원";

export const OVERLAY_AMOUNT_UNIT_OPTIONS = ["원", "캐시"] as const;
export type OverlayAmountUnitOption = (typeof OVERLAY_AMOUNT_UNIT_OPTIONS)[number];

/** 빈 값이면 fallback. 허용 목록 밖 문자열도 그대로 수용(커스텀 대비). */
export function normalizeOverlayAmountUnit(
  raw: unknown,
  fallback: string = DEFAULT_OVERLAY_AMOUNT_UNIT
): string {
  const v = String(raw ?? "").trim();
  return v || fallback;
}

export function readOverlayAmountUnitFromSettings(
  settings: unknown,
  fallback: string = DEFAULT_OVERLAY_AMOUNT_UNIT
): string {
  if (!settings || typeof settings !== "object") return fallback;
  return normalizeOverlayAmountUnit(
    (settings as Record<string, unknown>).amountUnit,
    fallback
  );
}

/**
 * 우선순위: 서버 overlaySettings > URL 파라미터 > 기본값.
 * OBS는 URL을 다시 복사하지 않아도 서버 설정이 단위를 갱신한다.
 */
export function resolveOverlayAmountUnit(opts: {
  settings?: unknown;
  urlParam?: string | null;
  fallback?: string;
}): string {
  const fallback = opts.fallback ?? DEFAULT_OVERLAY_AMOUNT_UNIT;
  const fromSettings = readOverlayAmountUnitFromSettings(opts.settings, "");
  if (fromSettings) return fromSettings;
  const fromUrl = normalizeOverlayAmountUnit(opts.urlParam, "");
  if (fromUrl) return fromUrl;
  return fallback;
}
