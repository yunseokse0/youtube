import { broadcastDateKey } from "@/lib/state";
import type { SettlementRecord } from "@/types";

/** monolith: excel-broadcast-settlement-records-v1:din */
/** shard:   excel-broadcast-settlement-records-v1:din:YYYY-MM-DD */
/** index:   excel-broadcast-settlement-records-index-v1:din */

export const SETTLEMENT_RECORDS_KEY_BASE = "excel-broadcast-settlement-records-v1";
export const SETTLEMENT_RECORDS_INDEX_KEY = "excel-broadcast-settlement-records-index-v1";

/** recent 목록 — index 상위 날짜부터 읽어 N건 채움 */
export const SETTLEMENT_SHARD_RECENT_DAYS_SCAN = 120;

export function settlementRecordsMonolithKvKey(userId: string): string {
  return `${SETTLEMENT_RECORDS_KEY_BASE}:${userId}`;
}

export function settlementRecordsShardKvKey(userId: string, dateKey: string): string {
  return `${SETTLEMENT_RECORDS_KEY_BASE}:${userId}:${dateKey}`;
}

export function settlementRecordsShardKeyPrefix(userId: string): string {
  return `${SETTLEMENT_RECORDS_KEY_BASE}:${userId}:`;
}

export function settlementRecordsIndexKvKey(userId: string): string {
  return `${SETTLEMENT_RECORDS_INDEX_KEY}:${userId}`;
}

export function isSettlementRecordsShardKvKey(key: string, userId: string): boolean {
  const prefix = settlementRecordsShardKeyPrefix(userId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(rest);
}

export function parseSettlementShardDateFromKey(key: string, userId: string): string | null {
  const prefix = settlementRecordsShardKeyPrefix(userId);
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(rest) ? rest : null;
}

export function settlementRecordDateKey(record: Pick<SettlementRecord, "createdAt">): string {
  const at = Number(record.createdAt) || Date.now();
  return broadcastDateKey(new Date(at));
}

export type SettlementRecordsIndex = {
  dateKeys: string[];
  updatedAt: number;
};

export function normalizeSettlementRecordsIndex(raw: unknown): SettlementRecordsIndex | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.dateKeys)) return null;
  const dateKeys = [
    ...new Set(
      o.dateKeys
        .map((k) => String(k || "").trim())
        .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    ),
  ].sort((a, b) => b.localeCompare(a));
  return {
    dateKeys,
    updatedAt: Number(o.updatedAt) || Date.now(),
  };
}

export function isSettlementMonolithMigratedStub(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as { __migrated?: boolean }).__migrated === true;
}

/** monolith stub 또는 index 문서에서 dateKeys 추출 */
export function dateKeysFromSettlementMeta(raw: unknown): string[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.dateKeys)) {
    return [
      ...new Set(
        o.dateKeys
          .map((k) => String(k || "").trim())
          .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
      ),
    ].sort((a, b) => b.localeCompare(a));
  }
  return [];
}

export function groupSettlementRecordsByDate(
  records: SettlementRecord[]
): Map<string, SettlementRecord[]> {
  const map = new Map<string, SettlementRecord[]>();
  for (const record of records) {
    const dateKey = settlementRecordDateKey(record);
    const list = map.get(dateKey);
    if (list) list.push(record);
    else map.set(dateKey, [record]);
  }
  return map;
}

export function mergeSettlementRecordLists(
  ...parts: SettlementRecord[][]
): SettlementRecord[] {
  const byId = new Map<string, SettlementRecord>();
  for (const part of parts) {
    for (const r of part) {
      const id = String(r?.id || "").trim();
      if (!id) continue;
      const prev = byId.get(id);
      if (!prev || (r.createdAt || 0) >= (prev.createdAt || 0)) {
        byId.set(id, r);
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function settlementRecordsFromShardPayload(raw: unknown): SettlementRecord[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as SettlementRecord[];
  return null;
}
