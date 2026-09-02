import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import {
  applySettlementDeleteTombstones,
  normalizeSettlementRecords,
  settlementDeleteLogsKey,
  settlementRecordsKey,
} from "@/lib/settlement";
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
  if (userId) settlementCache.delete(userId);
  else settlementCache.clear();
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

export type LoadSettlementRecordsOptions = {
  bypassCache?: boolean;
  /** false/생략: 최근 N건만 (admin·목록). true: 전체 */
  full?: boolean;
  recent?: number;
};

/**
 * settlement-records (~8MB) — 2분 in-memory 캐시 + recent 슬라이스로 응답 축소
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

  const raw = await upstashGetAppStateJson<unknown>(settlementRecordsKey(userId));
  let records = normalizeSettlementRecords(
    Array.isArray(raw) ? (raw as SettlementRecord[]) : []
  );
  const deleteLogsRaw = await upstashGetAppStateJson<SettlementDeleteLog[]>(
    settlementDeleteLogsKey(userId)
  );
  records = applySettlementDeleteTombstones(records, normalizeDeleteLogs(deleteLogsRaw));
  records = sortLatest(records);

  const rawLen = JSON.stringify(raw ?? []).length;
  const fullCacheKey = `${userId}:full`;
  settlementCache.set(fullCacheKey, { records, rawLen, loadedAt: Date.now() });

  const out = full ? records : records.slice(0, recentN);
  settlementCache.set(cacheKey, { records: out, rawLen, loadedAt: Date.now() });
  return out;
}

export { SETTLEMENT_RECENT_DEFAULT };
