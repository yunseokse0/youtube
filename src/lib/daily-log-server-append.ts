import { upstashSetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import {
  dailyLogCachedRawLen,
  dailyLogStorageKey,
  loadDailyLogForUserId,
  primeDailyLogCache,
} from "@/lib/daily-log-server-load";
import {
  broadcastDateKey,
  normalizeDonorsArray,
  totalAccount,
  type DailyLogEntry,
} from "@/lib/state";
import type { AppState } from "@/types";

const lastAppendAt = new Map<string, number>();
const lastSnapshotSig = new Map<string, string>();

/** 후원 persist 시 서버 일일 로그 자동 적재 최소 간격 */
export const DAILY_LOG_AUTO_APPEND_MIN_MS = 3 * 60 * 1000;

/** 23MB+ daily-log — auto append 시 MySQL read/write 가 라이브 state·후원을 막음 */
export const DAILY_LOG_LARGE_AUTO_APPEND_MIN_MS = 15 * 60 * 1000;
export const DAILY_LOG_LARGE_BYTES = 5_000_000;

const MAX_ENTRIES_PER_DAY = 200;

/** userId별 append 직렬 — 동시 23MB write 2건 방지 */
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

  const dateKey = broadcastDateKey(new Date(now));
  const entry: DailyLogEntry = {
    at: new Date(now).toISOString(),
    total,
    members: state.members,
    donors: state.donors,
  };

  const log = await loadDailyLogForUserId(userId);
  const nextLog: Record<string, DailyLogEntry[]> = { ...(log as Record<string, DailyLogEntry[]>) };
  const dayEntries = Array.isArray(nextLog[dateKey]) ? [...nextLog[dateKey]!] : [];
  dayEntries.push(entry);
  nextLog[dateKey] =
    dayEntries.length > MAX_ENTRIES_PER_DAY
      ? dayEntries.slice(-MAX_ENTRIES_PER_DAY)
      : dayEntries;

  const ok = await upstashSetAppStateJson(dailyLogStorageKey(userId), nextLog);
  if (ok) {
    primeDailyLogCache(userId, nextLog);
    lastAppendAt.set(userId, now);
    lastSnapshotSig.set(userId, sig);
  }
  return ok;
}

/**
 * 후원 저장 파이프라인에서 일일 로그(KV)에 스냅샷 적재.
 * 수동 「스냅샷 지금」과 달리 3분·변경 감지로 throttle (대용량 log 는 15분).
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
