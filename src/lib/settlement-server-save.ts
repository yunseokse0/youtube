import { upstashGetAppStateJson, upstashSetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import {
  mergeSettlementRecords,
  normalizeSettlementRecords,
} from "@/lib/settlement";
import {
  groupSettlementRecordsByDate,
  isSettlementMonolithMigratedStub,
  mergeSettlementRecordLists,
  settlementRecordsFromShardPayload,
  settlementRecordsMonolithKvKey,
  settlementRecordsShardKvKey,
} from "@/lib/settlement-records-shard";
import {
  deleteSettlementShardKeysNotIn,
  invalidateSettlementRecordsCache,
  listSettlementShardDateKeys,
  writeSettlementRecordsIndex,
} from "@/lib/settlement-server-load";
import type { SettlementRecord } from "@/types";

async function loadShard(userId: string, dateKey: string): Promise<SettlementRecord[]> {
  const raw = await upstashGetAppStateJson<unknown>(settlementRecordsShardKvKey(userId, dateKey));
  const list = settlementRecordsFromShardPayload(raw);
  return list ? normalizeSettlementRecords(list) : [];
}

async function saveShard(
  userId: string,
  dateKey: string,
  records: SettlementRecord[]
): Promise<boolean> {
  const key = settlementRecordsShardKvKey(userId, dateKey);
  if (records.length === 0) {
    const { mysqlKvDel } = await import("@/app/api/_shared/mysql-kv");
    await mysqlKvDel(key);
    return true;
  }
  return upstashSetAppStateJson(key, normalizeSettlementRecords(records));
}

async function ensureShardsPreferred(userId: string): Promise<boolean> {
  const mono = await upstashGetAppStateJson<unknown>(settlementRecordsMonolithKvKey(userId));
  if (isSettlementMonolithMigratedStub(mono)) return true;
  const existingDates = await listSettlementShardDateKeys(userId);
  return existingDates.length > 0;
}

/**
 * settlement 저장 — shard 단위 write.
 * replace: payload 날짜 집합으로 재작성 + 빠진 shard 삭제
 * merge: 관련 날짜 shard만 읽어 union
 */
export async function saveSettlementRecordsSharded(
  userId: string,
  payload: SettlementRecord[],
  opts?: { replace?: boolean }
): Promise<{ ok: boolean; dateKeys: string[] }> {
  const replace = opts?.replace === true;
  const incoming = normalizeSettlementRecords(payload);
  const preferShards = await ensureShardsPreferred(userId);

  /** 아직 monolith만 있으면 호출측이 monolith 경로를 쓰도록 ok:false 아님 — 빈 shards + 플래그 */
  if (!preferShards && !replace && incoming.length === 0) {
    return { ok: false, dateKeys: [] };
  }

  if (!preferShards && !replace) {
    /** merge into monolith-era: caller should fall back */
    return { ok: false, dateKeys: [] };
  }

  const byDate = groupSettlementRecordsByDate(incoming);
  const touched = [...byDate.keys()];
  const nextDateKeys = new Set<string>();

  if (replace) {
    for (const [dateKey, rows] of byDate) {
      const ok = await saveShard(userId, dateKey, rows);
      if (!ok) return { ok: false, dateKeys: [] };
      if (rows.length > 0) nextDateKeys.add(dateKey);
    }
    await deleteSettlementShardKeysNotIn(userId, nextDateKeys);
  } else {
    const prevKeys = await listSettlementShardDateKeys(userId);
    for (const k of prevKeys) nextDateKeys.add(k);
    for (const dateKey of touched) {
      const existing = await loadShard(userId, dateKey);
      const merged = mergeSettlementRecordLists(existing, byDate.get(dateKey) || []);
      const ok = await saveShard(userId, dateKey, merged);
      if (!ok) return { ok: false, dateKeys: [] };
      if (merged.length > 0) nextDateKeys.add(dateKey);
    }
  }

  const dateKeyList = [...nextDateKeys].sort((a, b) => b.localeCompare(a));
  await writeSettlementRecordsIndex(userId, dateKeyList);

  /** monolith stub — GET이 8MB array를 다시 읽지 않게 */
  await upstashSetAppStateJson(settlementRecordsMonolithKvKey(userId), {
    __migrated: true,
    at: Date.now(),
    dateKeys: dateKeyList,
  });

  invalidateSettlementRecordsCache(userId);
  return { ok: true, dateKeys: dateKeyList };
}

export async function saveSettlementRecordsMonolith(
  userId: string,
  records: SettlementRecord[]
): Promise<boolean> {
  const key = settlementRecordsMonolithKvKey(userId);
  const ok = await upstashSetAppStateJson(key, normalizeSettlementRecords(records));
  if (ok) invalidateSettlementRecordsCache(userId);
  return ok;
}

export { mergeSettlementRecords };
