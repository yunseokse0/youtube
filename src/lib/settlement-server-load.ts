import { upstashGetAppStateJson, upstashSetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import { mysqlKvDel, mysqlKvListKeys } from "@/app/api/_shared/mysql-kv";
import {
  applySettlementDeleteTombstones,
  normalizeSettlementRecords,
  settlementDeleteLogsKey,
  settlementRecordsKey,
} from "@/lib/settlement";
import {
  dateKeysFromSettlementMeta,
  isSettlementMonolithMigratedStub,
  mergeSettlementRecordLists,
  settlementRecordsFromShardPayload,
  settlementRecordsIndexKvKey,
  settlementRecordsMonolithKvKey,
  settlementRecordsShardKvKey,
  settlementRecordsShardKeyPrefix,
  parseSettlementShardDateFromKey,
  normalizeSettlementRecordsIndex,
  type SettlementRecordsIndex,
} from "@/lib/settlement-records-shard";
import type { SettlementDeleteLog, SettlementRecord } from "@/types";

const SETTLEMENT_CACHE_TTL_MS = 120_000;
const SETTLEMENT_RECENT_DEFAULT = 50;

type SettlementCacheEntry = {
  records: SettlementRecord[];
  rawLen: number;
  loadedAt: number;
};
const settlementCache = new Map<string, SettlementCacheEntry>();

export function invalidateSettlementRecordsCache(userId?: string): void {
  if (!userId) {
    settlementCache.clear();
    return;
  }
  for (const key of [...settlementCache.keys()]) {
    if (key === userId || key.startsWith(`${userId}:`)) settlementCache.delete(key);
  }
}

function sortLatest(records: SettlementRecord[]): SettlementRecord[] {
  return [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function normalizeDeleteLogs(logs: unknown): SettlementDeleteLog[] {
  if (!Array.isArray(logs)) return [];
  const byId = new Map<string, SettlementDeleteLog>();
  for (const raw of logs) {
    if (!raw || typeof raw !== "object") continue;
    const log = raw as SettlementDeleteLog;
    const recordId = String(log.recordId || "").trim();
    if (!recordId) continue;
    const prev = byId.get(recordId);
    if (!prev || (log.deletedAt || 0) >= (prev.deletedAt || 0)) byId.set(recordId, log);
  }
  return Array.from(byId.values());
}

async function loadDeleteLogs(userId: string): Promise<SettlementDeleteLog[]> {
  const deleteLogsRaw = await upstashGetAppStateJson<SettlementDeleteLog[]>(
    settlementDeleteLogsKey(userId)
  );
  return normalizeDeleteLogs(deleteLogsRaw);
}

async function loadShardDay(userId: string, dateKey: string): Promise<SettlementRecord[]> {
  const raw = await upstashGetAppStateJson<unknown>(settlementRecordsShardKvKey(userId, dateKey));
  const list = settlementRecordsFromShardPayload(raw);
  return list ? normalizeSettlementRecords(list) : [];
}

async function resolveDateKeys(userId: string): Promise<string[]> {
  const index = normalizeSettlementRecordsIndex(
    await upstashGetAppStateJson<unknown>(settlementRecordsIndexKvKey(userId))
  );
  if (index?.dateKeys.length) return index.dateKeys;

  const monoMeta = await upstashGetAppStateJson<unknown>(settlementRecordsMonolithKvKey(userId));
  const fromStub = dateKeysFromSettlementMeta(monoMeta);
  if (fromStub.length) return fromStub;

  const prefix = settlementRecordsShardKeyPrefix(userId);
  const keys = await mysqlKvListKeys(prefix, 400);
  const dates = keys
    .map((k) => parseSettlementShardDateFromKey(k, userId))
    .filter((d): d is string => Boolean(d));
  return [...new Set(dates)].sort((a, b) => b.localeCompare(a));
}

async function loadFromShards(
  userId: string,
  opts: { full: boolean; recentN: number }
): Promise<{ records: SettlementRecord[]; rawLen: number } | null> {
  const dateKeys = await resolveDateKeys(userId);
  if (dateKeys.length === 0) {
    const mono = await upstashGetAppStateJson<unknown>(settlementRecordsMonolithKvKey(userId));
    if (isSettlementMonolithMigratedStub(mono)) {
      return { records: [], rawLen: 0 };
    }
    return null;
  }

  const selected = opts.full ? dateKeys : dateKeys.slice(0, Math.max(30, opts.recentN));
  const parts = await Promise.all(selected.map((d) => loadShardDay(userId, d)));
  let records = mergeSettlementRecordLists(...parts);
  const rawLen = JSON.stringify(records).length;

  if (!opts.full && opts.recentN > 0 && records.length < opts.recentN) {
    const extra = dateKeys.slice(selected.length);
    for (const dateKey of extra) {
      if (records.length >= opts.recentN) break;
      const more = await loadShardDay(userId, dateKey);
      records = mergeSettlementRecordLists(records, more);
    }
  }

  records = sortLatest(records);
  if (!opts.full && opts.recentN > 0) records = records.slice(0, opts.recentN);
  return { records, rawLen };
}

async function loadMonolithFallback(userId: string): Promise<{
  records: SettlementRecord[];
  rawLen: number;
}> {
  const raw = await upstashGetAppStateJson<unknown>(settlementRecordsKey(userId));
  if (isSettlementMonolithMigratedStub(raw)) {
    return { records: [], rawLen: 0 };
  }
  const records = normalizeSettlementRecords(
    Array.isArray(raw) ? (raw as SettlementRecord[]) : []
  );
  return { records: sortLatest(records), rawLen: JSON.stringify(raw ?? []).length };
}

export type LoadSettlementRecordsOptions = {
  bypassCache?: boolean;
  /** false/생략: 최근 N건만 (admin·목록). true: 전체 */
  full?: boolean;
  recent?: number;
};

/**
 * settlement-records — shard 우선, monolith fallback.
 * 기본 recent=50 으로 8MB full read 회피.
 */
export async function loadSettlementRecordsForUserId(
  userId: string,
  opts?: LoadSettlementRecordsOptions
): Promise<SettlementRecord[]> {
  const full = opts?.full === true;
  const recentN = full
    ? 0
    : Math.max(1, Math.min(500, opts?.recent ?? SETTLEMENT_RECENT_DEFAULT));
  const cacheKey = full ? `${userId}:full` : `${userId}:recent:${recentN}`;

  if (!opts?.bypassCache) {
    const hit = settlementCache.get(cacheKey);
    if (hit && Date.now() - hit.loadedAt < SETTLEMENT_CACHE_TTL_MS) {
      return hit.records;
    }
  }

  const fromShards = await loadFromShards(userId, { full, recentN });
  let records: SettlementRecord[];
  let rawLen: number;
  if (fromShards) {
    records = fromShards.records;
    rawLen = fromShards.rawLen;
  } else {
    const mono = await loadMonolithFallback(userId);
    records = mono.records;
    rawLen = mono.rawLen;
  }

  const deleteLogs = await loadDeleteLogs(userId);
  records = applySettlementDeleteTombstones(records, deleteLogs);
  records = sortLatest(records);
  if (!full && recentN > 0) records = records.slice(0, recentN);

  settlementCache.set(cacheKey, { records, rawLen, loadedAt: Date.now() });
  if (full) {
    settlementCache.set(`${userId}:full`, { records, rawLen, loadedAt: Date.now() });
  }
  return records;
}

export async function writeSettlementRecordsIndex(
  userId: string,
  dateKeys: string[]
): Promise<boolean> {
  const unique = [...new Set(dateKeys.filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)))].sort((a, b) =>
    b.localeCompare(a)
  );
  const payload: SettlementRecordsIndex = { dateKeys: unique, updatedAt: Date.now() };
  return upstashSetAppStateJson(settlementRecordsIndexKvKey(userId), payload);
}

export async function listSettlementShardDateKeys(userId: string): Promise<string[]> {
  return resolveDateKeys(userId);
}

export async function deleteSettlementShardKeysNotIn(
  userId: string,
  keepDateKeys: Set<string>
): Promise<number> {
  const prefix = settlementRecordsShardKeyPrefix(userId);
  const keys = await mysqlKvListKeys(prefix, 400);
  let deleted = 0;
  for (const key of keys) {
    const dateKey = parseSettlementShardDateFromKey(key, userId);
    if (!dateKey || keepDateKeys.has(dateKey)) continue;
    await mysqlKvDel(key);
    deleted += 1;
  }
  return deleted;
}

export { SETTLEMENT_RECENT_DEFAULT };
