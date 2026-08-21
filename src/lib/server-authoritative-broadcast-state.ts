import type { AppState } from "@/types";

const sessionByUser = new Map<string, AppState>();

function cacheKey(userId?: string | null): string {
  return String(userId || "").trim() || "__default__";
}

/** 방송 AppState 정본은 서버(MySQL/Redis)만 — localStorage read/write 금지.
 *  관리자(/admin)는 조회·편집 UI일 뿐이며, 저장은 항상 POST /api/state 등 서버 경로로만 한다.
 *  세션 캐시는 같은 탭 iframe·즉시 미리보기용이며 디스크·다른 PC와 공유되지 않는다. */
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
