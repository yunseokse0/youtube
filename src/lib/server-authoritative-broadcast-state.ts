import type { AppState } from "@/types";

const sessionByUser = new Map<string, AppState>();

function cacheKey(userId?: string | null): string {
  return String(userId || "").trim() || "__default__";
}

/** 방송 AppState 정본은 서버(MySQL/Redis)만 — localStorage read/write 금지 */
export function isServerAuthoritativeBroadcastState(): boolean {
  return true;
}

export function readSessionBroadcastState(userId?: string | null): AppState | null {
  if (typeof window === "undefined") return null;
  return sessionByUser.get(cacheKey(userId)) ?? null;
}

export function writeSessionBroadcastState(state: AppState, userId?: string | null): void {
  if (typeof window === "undefined") return;
  sessionByUser.set(cacheKey(userId), state);
}

export function clearSessionBroadcastState(userId?: string | null): void {
  if (typeof window === "undefined") return;
  sessionByUser.delete(cacheKey(userId));
}
