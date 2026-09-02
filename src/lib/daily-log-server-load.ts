import { upstashGetAppStateJson, upstashSetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import { mysqlKvDel, mysqlKvListKeys } from "@/app/api/_shared/mysql-kv";
import type { DailyLogEntry } from "@/lib/state";
import {
  dailyLogEntriesFromShardPayload,
  dailyLogFromMonolith,
  dailyLogMonolithKvKey,
  dailyLogShardKvKey,
  DAILY_LOG_SHARD_DAYS_DEFAULT,
  mergeDailyLogShardMaps,
  parseDailyLogShardDateFromKey,
  recentDailyLogDateKeys,
} from "@/lib/daily-log-shard";

const DAILY_LOG_CACHE_TTL_MS = 120_000;
type DailyLogCacheEntry = {
  data: Record<string, DailyLogEntry[]>;
  rawLen: number;
  loadedAt: number;
  mode: "recent" | "full";
};
const dailyLogCache = new Map<string, DailyLogCacheEntry>();

export function invalidateDailyLogCache(userId?: string): void {
  if (userId) dailyLogCache.delete(userId);
  else dailyLogCache.clear();
}

export function dailyLogCachedRawLen(userId: string): number {
  return dailyLogCache.get(userId)?.rawLen ?? 0;
}

export function primeDailyLogCache(userId: string, data: Record<string, DailyLogEntry[]>): void {
  const rawLen = JSON.stringify(data).length;
  dailyLogCache.set(userId, { data, rawLen, loadedAt: Date.now(), mode: "recent" });
}

export type LoadDailyLogOptions = {
  bypassCache?: boolean;
  /** 최근 N일 shard만 (기본 3) — state enrich·storage-health lite */
  recentDays?: number;
  /** true: monolith + 등록된 모든 shard (admin 다운로드·복구) */
  full?: boolean;
};

async function loadDailyLogShardDay(
  userId: string,
  dateKey: string
): Promise<DailyLogEntry[] | null> {
  const raw = await upstashGetAppStateJson<unknown>(dailyLogShardKvKey(userId, dateKey));
  const entries = dailyLogEntriesFromShardPayload(raw);
  return entries && entries.length > 0 ? entries : null;
}

async function loadDailyLogRecentShards(
  userId: string,
  days: number
): Promise<Record<string, DailyLogEntry[]>> {
  const dateKeys = recentDailyLogDateKeys(days);
  const parts = await Promise.all(
    dateKeys.map(async (dateKey) => {
      const entries = await loadDailyLogShardDay(userId, dateKey);
      return entries ? { [dateKey]: entries } : {};
    })
  );
  return mergeDailyLogShardMaps(...parts);
}

async function loadDailyLogAllShards(userId: string): Promise<Record<string, DailyLogEntry[]>> {
  const prefix = `${dailyLogMonolithKvKey(userId)}:`;
  const keys = await mysqlKvListKeys(prefix, 400);
  const shardKeys = keys
    .map((k) => parseDailyLogShardDateFromKey(k, userId))
    .filter((d): d is string => Boolean(d));
  const uniqueDates = [...new Set(shardKeys)].sort();
  const parts = await Promise.all(
    uniqueDates.map(async (dateKey) => {
      const entries = await loadDailyLogShardDay(userId, dateKey);
      return entries ? { [dateKey]: entries } : {};
    })
  );
  return mergeDailyLogShardMaps(...parts);
}

/** monolith(23MB) — full 요청·마이그레이션 시에만 */
async function loadDailyLogMonolith(userId: string): Promise<Record<string, DailyLogEntry[]> | null> {
  const raw = await upstashGetAppStateJson<unknown>(dailyLogMonolithKvKey(userId));
  return dailyLogFromMonolith(raw);
}

/**
 * 서버 daily-log — 기본은 최근 N일 shard만 (23MB monolith read 회피)
 */
export async function loadDailyLogForUserId(
  userId: string,
  opts?: LoadDailyLogOptions
): Promise<Record<string, DailyLogEntry[]>> {
  const full = opts?.full === true;
  const recentDays = full ? 0 : Math.max(1, opts?.recentDays ?? DAILY_LOG_SHARD_DAYS_DEFAULT);
  const cacheKey = full ? `${userId}:full` : `${userId}:recent:${recentDays}`;

  if (!opts?.bypassCache) {
    const hit = dailyLogCache.get(cacheKey);
    if (hit && Date.now() - hit.loadedAt < DAILY_LOG_CACHE_TTL_MS) {
      return hit.data;
    }
  }

  let merged: Record<string, DailyLogEntry[]> = {};

  if (full) {
    merged = mergeDailyLogShardMaps(merged, await loadDailyLogAllShards(userId));
    const monolith = await loadDailyLogMonolith(userId);
    if (monolith) merged = mergeDailyLogShardMaps(monolith, merged);
  } else {
    merged = await loadDailyLogRecentShards(userId, recentDays);
  }

  const rawLen = JSON.stringify(merged).length;
  dailyLogCache.set(cacheKey, {
    data: merged,
    rawLen,
    loadedAt: Date.now(),
    mode: full ? "full" : "recent",
  });
  return merged;
}

/** monolith → 일별 shard 이전 (운영 중 1회) */
export async function migrateDailyLogMonolithToShards(
  userId: string
): Promise<{ ok: boolean; days: number; bytesEst: number }> {
  const monolith = await loadDailyLogMonolith(userId);
  if (!monolith) {
    return { ok: true, days: 0, bytesEst: 0 };
  }
  let bytesEst = 0;
  let days = 0;
  for (const [dateKey, entries] of Object.entries(monolith)) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    const payload = entries;
    bytesEst += JSON.stringify(payload).length;
    const ok = await upstashSetAppStateJson(dailyLogShardKvKey(userId, dateKey), payload);
    if (!ok) return { ok: false, days, bytesEst };
    days += 1;
  }
  const bakKey = `${dailyLogMonolithKvKey(userId)}:BAK`;
  await upstashSetAppStateJson(bakKey, monolith);
  await upstashSetAppStateJson(dailyLogMonolithKvKey(userId), {
    __migrated: true,
    at: Date.now(),
    days,
    bakKey,
  });
  invalidateDailyLogCache(userId);
  return { ok: true, days, bytesEst };
}

export async function deleteDailyLogMonolithBackup(userId: string): Promise<void> {
  await mysqlKvDel(`${dailyLogMonolithKvKey(userId)}:BAK`);
}
