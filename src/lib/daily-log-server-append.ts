import { upstashGetAppStateJson, upstashSetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import {
  dailyLogCachedRawLen,
  invalidateDailyLogCache,
  migrateDailyLogMonolithToShards,
  primeDailyLogCache,
} from "@/lib/daily-log-server-load";
import {
  DAILY_LOG_MAX_ENTRIES_PER_DAY_STORE,
  dailyLogEntriesFromShardPayload,
  dailyLogMonolithKvKey,
  dailyLogShardKvKey,
  slimDailyLogEntry,
  trimDailyLogEntries,
} from "@/lib/daily-log-shard";
import {
  broadcastDateKey,
  normalizeDonorsArray,
  totalAccount,
  type DailyLogEntry,
} from "@/lib/state";
import type { AppState } from "@/types";

const lastAppendAt = new Map<string, number>();
const lastSnapshotSig = new Map<string, string>();
const migrateOnce = new Set<string>();

/** 후원 persist 시 서버 일일 로그 자동 적재 최소 간격 */
export const DAILY_LOG_AUTO_APPEND_MIN_MS = 3 * 60 * 1000;

/** monolith 잔존 시 auto append 완화 */
export const DAILY_LOG_LARGE_AUTO_APPEND_MIN_MS = 15 * 60 * 1000;
export const DAILY_LOG_LARGE_BYTES = 500_000;

/** userId별 append 직렬 */
const appendChains = new Map<string, Promise<boolean>>();

function snapshotSignature(state: AppState): string {
  const donors = normalizeDonorsArray(state.donors);
  return `${donors.length}:${totalAccount(state)}`;
}

function autoAppendMinMs(userId: string): number {
  return dailyLogCachedRawLen(userId) > DAILY_LOG_LARGE_BYTES
    ? DAILY_LOG_LARGE_AUTO_APPEND_MIN_MS
    : DAILY_LOG_AUTO_APPEND_MIN_MS;
}

async function ensureMonolithMigrated(userId: string): Promise<void> {
  if (migrateOnce.has(userId)) return;
  const stub = await upstashGetAppStateJson<{ __migrated?: boolean }>(dailyLogMonolithKvKey(userId));
  if (stub && stub.__migrated === true) {
    migrateOnce.add(userId);
    return;
  }
  const raw = await upstashGetAppStateJson<unknown>(dailyLogMonolithKvKey(userId));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  const o = raw as Record<string, unknown>;
  if (o.__migrated === true) {
    migrateOnce.add(userId);
    return;
  }
  const hasDates = Object.keys(o).some((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
  if (!hasDates) return;
  void migrateDailyLogMonolithToShards(userId).then((r) => {
    if (r.ok) migrateOnce.add(userId);
  });
}

async function appendDailyLogEntry(
  userId: string,
  state: AppState,
  opts?: { force?: boolean }
): Promise<boolean> {
  const donors = normalizeDonorsArray(state.donors);
  const total = totalAccount(state);
  if (donors.length === 0 && total <= 0) return false;

  const now = Date.now();
  const sig = snapshotSignature(state);
  const prevAt = lastAppendAt.get(userId) || 0;
  const prevSig = lastSnapshotSig.get(userId) || "";
  const minMs = autoAppendMinMs(userId);

  if (!opts?.force) {
    const withinWindow = now - prevAt < minMs;
    if (withinWindow && sig === prevSig) return false;
  }

  void ensureMonolithMigrated(userId);

  const dateKey = broadcastDateKey(new Date(now));
  const entry = slimDailyLogEntry({
    at: new Date(now).toISOString(),
    total,
    members: state.members,
    donors: state.donors,
  });

  const shardKey = dailyLogShardKvKey(userId, dateKey);
  const existingRaw = await upstashGetAppStateJson<unknown>(shardKey);
  const dayEntries = [...(dailyLogEntriesFromShardPayload(existingRaw) ?? []), entry];
  const trimmed = trimDailyLogEntries(dayEntries, DAILY_LOG_MAX_ENTRIES_PER_DAY_STORE);

  const ok = await upstashSetAppStateJson(shardKey, trimmed);
  if (ok) {
    invalidateDailyLogCache(userId);
    primeDailyLogCache(userId, { [dateKey]: trimmed });
    lastAppendAt.set(userId, now);
    lastSnapshotSig.set(userId, sig);
  }
  return ok;
}

/**
 * 후원 저장 파이프라인 — 오늘 shard 에만 append (monolith 23MB R+W 제거)
 */
export async function maybeAppendDailyLogFromState(
  userId: string,
  state: AppState,
  opts?: { force?: boolean }
): Promise<boolean> {
  const prev = appendChains.get(userId) ?? Promise.resolve(false);
  const next = prev
    .catch(() => false)
    .then(() => appendDailyLogEntry(userId, state, opts));
  appendChains.set(userId, next);
  try {
    return await next;
  } finally {
    if (appendChains.get(userId) === next) appendChains.delete(userId);
  }
}
