import { broadcastDateKey, DAILY_LOG_KEY, type DailyLogEntry } from "@/lib/state";

/** monolith: excel-broadcast-daily-log-v1:din — shard: excel-broadcast-daily-log-v1:din:YYYY-MM-DD */
export const DAILY_LOG_SHARD_DAYS_DEFAULT = 2;
export const DAILY_LOG_SHARD_DAYS_ADMIN = 2;

export function dailyLogMonolithKvKey(userId: string): string {
  return `${DAILY_LOG_KEY}:${userId}`;
}

export function dailyLogShardKvKey(userId: string, dateKey: string): string {
  return `${DAILY_LOG_KEY}:${userId}:${dateKey}`;
}

export function dailyLogShardKeyPrefix(userId: string): string {
  return `${DAILY_LOG_KEY}:${userId}:`;
}

export function isDailyLogShardKvKey(key: string, userId: string): boolean {
  const prefix = dailyLogShardKeyPrefix(userId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(rest);
}

export function parseDailyLogShardDateFromKey(key: string, userId: string): string | null {
  const prefix = dailyLogShardKeyPrefix(userId);
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(rest) ? rest : null;
}

/** KST 기준 최근 N일 dateKey (오늘 포함) */
export function recentDailyLogDateKeys(days: number, from = new Date()): string[] {
  const n = Math.max(1, Math.min(90, Math.floor(days)));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(from.getTime() - i * 86_400_000);
    out.push(broadcastDateKey(d));
  }
  return out;
}

export function mergeDailyLogShardMaps(
  ...parts: Array<Record<string, DailyLogEntry[]>>
): Record<string, DailyLogEntry[]> {
  const out: Record<string, DailyLogEntry[]> = {};
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    for (const [dateKey, entries] of Object.entries(part)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const prev = out[dateKey];
      out[dateKey] = prev ? [...prev, ...entries] : [...entries];
    }
  }
  return out;
}

export function dailyLogFromMonolith(raw: unknown): Record<string, DailyLogEntry[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.__migrated === true) return null;
  const out: Record<string, DailyLogEntry[]> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v)) continue;
    out[k] = v as DailyLogEntry[];
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function dailyLogEntriesFromShardPayload(raw: unknown): DailyLogEntry[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as DailyLogEntry[];
  if (typeof raw === "object") {
    const o = raw as Record<string, DailyLogEntry[]>;
    const keys = Object.keys(o).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
    if (keys.length === 1 && Array.isArray(o[keys[0]!])) return o[keys[0]!]!;
  }
  return null;
}
