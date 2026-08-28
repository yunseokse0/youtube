import { upstashSetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import { dailyLogStorageKey, loadDailyLogForUserId } from "@/lib/daily-log-server-load";
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

const MAX_ENTRIES_PER_DAY = 200;

function snapshotSignature(state: AppState): string {
  const donors = normalizeDonorsArray(state.donors);
  return `${donors.length}:${totalAccount(state)}`;
}

/**
 * 후원 저장 파이프라인에서 일일 로그(KV)에 스냅샷 적재.
 * 수동 「스냅샷 지금」과 달리 3분·변경 감지로 throttle.
 */
export async function maybeAppendDailyLogFromState(
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

  if (!opts?.force) {
    const withinWindow = now - prevAt < DAILY_LOG_AUTO_APPEND_MIN_MS;
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
    lastAppendAt.set(userId, now);
    lastSnapshotSig.set(userId, sig);
  }
  return ok;
}
