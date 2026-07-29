import type { AppState } from "@/types";

/** Redis 미설정·장애 시 계정(userId)별 인메모리 스냅샷 — 전역 단일 캐시 금지 */
const cacheByUserId = new Map<string, AppState>();

export function getServerMemoryAppState(userId: string | null | undefined): AppState | null {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  return cacheByUserId.get(uid) ?? null;
}

export function setServerMemoryAppState(
  userId: string | null | undefined,
  next: AppState | null
): void {
  const uid = String(userId || "").trim();
  if (!uid) return;
  if (next === null) cacheByUserId.delete(uid);
  else cacheByUserId.set(uid, next);
}
