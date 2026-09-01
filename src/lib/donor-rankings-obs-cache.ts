import { normalizeDonorsArray, type AppState } from "@/lib/state";

const CACHE_VERSION = 1;

export type DonorRankingsObsCachePayload = Pick<
  AppState,
  | "donors"
  | "donorRankingsWire"
  | "donorRankingsUpdatedAt"
  | "settlementResetAt"
  | "updatedAt"
  | "donorRankingsTheme"
  | "donorRankingsFullTheme"
  | "donorRankingsOverlayConfig"
  | "donorRankingsFullOverlayConfig"
> & {
  savedAt: number;
};

function cacheStorageKey(userId: string): string {
  return `donor-rankings-obs-cache:v${CACHE_VERSION}:${userId}`;
}

export function donorRankingsObsCacheHasRankings(state: Partial<AppState> | null | undefined): boolean {
  if (!state) return false;
  const wire = state.donorRankingsWire;
  if (wire && Array.isArray(wire.unifiedTop) && wire.unifiedTop.length > 0) return true;
  return normalizeDonorsArray(state.donors).length > 0;
}

export function readDonorRankingsObsCache(userId?: string): Partial<AppState> | null {
  if (typeof window === "undefined") return null;
  const uid = String(userId || "").trim();
  if (!uid) return null;
  try {
    const raw = window.sessionStorage.getItem(cacheStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DonorRankingsObsCachePayload;
    if (!parsed || typeof parsed !== "object") return null;
    if (!donorRankingsObsCacheHasRankings(parsed)) return null;
    const {
      savedAt: _savedAt,
      donors,
      donorRankingsWire,
      donorRankingsUpdatedAt,
      settlementResetAt,
      updatedAt,
      donorRankingsTheme,
      donorRankingsFullTheme,
      donorRankingsOverlayConfig,
      donorRankingsFullOverlayConfig,
    } = parsed;
    return {
      donors,
      donorRankingsWire,
      donorRankingsUpdatedAt,
      settlementResetAt,
      updatedAt,
      donorRankingsTheme,
      donorRankingsFullTheme,
      donorRankingsOverlayConfig,
      donorRankingsFullOverlayConfig,
    };
  } catch {
    return null;
  }
}

export function writeDonorRankingsObsCache(userId: string | undefined, state: AppState): void {
  if (typeof window === "undefined") return;
  const uid = String(userId || "").trim();
  if (!uid || !donorRankingsObsCacheHasRankings(state)) return;
  try {
    const payload: DonorRankingsObsCachePayload = {
      savedAt: Date.now(),
      donors: normalizeDonorsArray(state.donors),
      donorRankingsWire: state.donorRankingsWire,
      donorRankingsUpdatedAt: Number(state.donorRankingsUpdatedAt || state.updatedAt || 0),
      settlementResetAt: Number(state.settlementResetAt || 0),
      updatedAt: Number(state.updatedAt || 0),
      donorRankingsTheme: state.donorRankingsTheme,
      donorRankingsFullTheme: state.donorRankingsFullTheme,
      donorRankingsOverlayConfig: state.donorRankingsOverlayConfig,
      donorRankingsFullOverlayConfig: state.donorRankingsFullOverlayConfig,
    };
    window.sessionStorage.setItem(cacheStorageKey(uid), JSON.stringify(payload));
  } catch {
    /* sessionStorage quota / private mode */
  }
}

export function clearDonorRankingsObsCache(userId?: string): void {
  if (typeof window === "undefined") return;
  const uid = String(userId || "").trim();
  if (!uid) return;
  try {
    window.sessionStorage.removeItem(cacheStorageKey(uid));
  } catch {
    /* ignore */
  }
}
