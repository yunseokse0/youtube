import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import type { DailyLogEntry } from "@/lib/state";

const DAILY_LOG_KEY_BASE = "excel-broadcast-daily-log-v1";

/** 프로세스 내 daily-log 캐시 — 23MB LONGTEXT 반복 read 로 MySQL pool(2) 점유 방지 */
const DAILY_LOG_CACHE_TTL_MS = 120_000;
type DailyLogCacheEntry = {
  data: Record<string, DailyLogEntry[]>;
  rawLen: number;
  loadedAt: number;
};
const dailyLogCache = new Map<string, DailyLogCacheEntry>();

export function dailyLogStorageKey(userId: string): string {
  return `${DAILY_LOG_KEY_BASE}:${userId}`;
}

export function invalidateDailyLogCache(userId?: string): void {
  if (userId) dailyLogCache.delete(userId);
  else dailyLogCache.clear();
}

export function dailyLogCachedRawLen(userId: string): number {
  return dailyLogCache.get(userId)?.rawLen ?? 0;
}

export function primeDailyLogCache(userId: string, data: Record<string, DailyLogEntry[]>): void {
  const rawLen = JSON.stringify(data).length;
  dailyLogCache.set(userId, { data, rawLen, loadedAt: Date.now() });
}

/** 서버 — MySQL/Redis 일일 로그 (후원 스냅샷·작업 로그) */
export async function loadDailyLogForUserId(
  userId: string,
  opts?: { bypassCache?: boolean }
): Promise<Record<string, DailyLogEntry[]>> {
  if (!opts?.bypassCache) {
    const hit = dailyLogCache.get(userId);
    if (hit && Date.now() - hit.loadedAt < DAILY_LOG_CACHE_TTL_MS) {
      return hit.data;
    }
  }

  const user = await upstashGetAppStateJson<Record<string, DailyLogEntry[]>>(
    dailyLogStorageKey(userId)
  );
  let merged: Record<string, DailyLogEntry[]> =
    user && typeof user === "object" ? { ...user } : {};

  /** legacy 키는 user 키가 비었을 때만 — 라이브 중 2×23MB read 방지 */
  if (Object.keys(merged).length === 0) {
    const legacy = await upstashGetAppStateJson<Record<string, DailyLogEntry[]>>(
      DAILY_LOG_KEY_BASE
    );
    if (legacy && typeof legacy === "object") {
      merged = { ...legacy };
    }
  }

  primeDailyLogCache(userId, merged);
  return merged;
}
