export const runtime = "nodejs";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { upstashGetJson, upstashSetJsonWithSetPath } from "@/app/api/_shared/upstash";
import type { DailyLogEntry } from "@/lib/state";
import {
  collectAllDailyLogEntries,
  enrichSettlementRecordsDonorsFromDailyLog,
  findDailyLogEntriesNotStronglyCovered,
  mergeSettlementRecordArrays,
  recoverSettlementRecordsFromDailyLog,
  type SettlementServerRecoveryCounts,
} from "@/lib/settlement-recovery";
import { applySettlementDeleteTombstones, normalizeSettlementRecords } from "@/lib/settlement";
import { loadDailyLogForUserId } from "@/lib/daily-log-server-load";
import { dailyLogFromMonolith } from "@/lib/daily-log-shard";
import type { SettlementDeleteLog, SettlementRecord } from "@/types";

const SETTLEMENT_KEY_BASE = "excel-broadcast-settlement-records-v1";
const SETTLEMENT_KEY_LEGACY = "excel-broadcast-settlement-records-v1";
const DAILY_LOG_KEY_LEGACY = "excel-broadcast-daily-log-v1";
const DELETE_LOGS_KEY_BASE = "excel-broadcast-settlement-delete-logs-v1";

function settlementKey(userId: string): string {
  return `${SETTLEMENT_KEY_BASE}:${userId}`;
}

function deleteLogsKey(userId: string): string {
  return `${DELETE_LOGS_KEY_BASE}:${userId}`;
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

type RecoverBody = {
  titleHint?: string;
};

/**
 * 레거시·사용자 Redis 키 + 일일 로그 고아 스냅샷에서 정산 기록 union 복구.
 */
export async function POST(req: Request) {
  const writeUid = resolveWriteUserId(req);
  if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
  const userId = writeUid.userId;

  const body = (await req.json().catch(() => ({}))) as RecoverBody;
  const titleHint = String(body.titleHint || "").trim();

  const deleteLogsRaw = await upstashGetJson<SettlementDeleteLog[]>(deleteLogsKey(userId));
  const deleteLogs = normalizeDeleteLogs(deleteLogsRaw);

  const userRecordsRaw = await upstashGetJson<SettlementRecord[]>(settlementKey(userId));
  const legacyRecordsRaw = await upstashGetJson<SettlementRecord[]>(SETTLEMENT_KEY_LEGACY);
  const userRecords = applySettlementDeleteTombstones(
    Array.isArray(userRecordsRaw) ? userRecordsRaw : [],
    deleteLogs
  );
  const legacyRecords = applySettlementDeleteTombstones(
    Array.isArray(legacyRecordsRaw) ? legacyRecordsRaw : [],
    deleteLogs
  );

  let merged = mergeSettlementRecordArrays(userRecords, legacyRecords);

  /** shard-aware full load — monolith stub 만 읽던 경로 수정 */
  const dailyLogUser = await loadDailyLogForUserId(userId, { full: true });
  const dailyLogLegacyRaw = await upstashGetJson<unknown>(DAILY_LOG_KEY_LEGACY);
  const dailyLogLegacy = dailyLogFromMonolith(dailyLogLegacyRaw) || {};
  const dailyLog: Record<string, DailyLogEntry[]> = {
    ...dailyLogLegacy,
    ...dailyLogUser,
  };

  const beforeDaily = merged.length;
  merged = recoverSettlementRecordsFromDailyLog(dailyLog, merged, {
    titleHint: titleHint || undefined,
    deletedLogs: deleteLogs,
  });
  merged = enrichSettlementRecordsDonorsFromDailyLog(merged, dailyLog);
  merged = applySettlementDeleteTombstones(normalizeSettlementRecords(merged), deleteLogs);

  const dailyLogOrphansAdded = Math.max(0, merged.length - beforeDaily);
  const allDailyEntries = collectAllDailyLogEntries(dailyLog).filter(
    (e) => (Array.isArray(e.donors) && e.donors.length > 0) || Number(e.total) > 0
  );
  const uncoveredDaily = findDailyLogEntriesNotStronglyCovered(dailyLog, merged);
  const hasKkang = merged.some((r) => r.title.includes("깡깡"));
  const needsTitleHint =
    Boolean(titleHint) &&
    !hasKkang &&
    !merged.some((r) => r.title.toLowerCase().includes(titleHint.toLowerCase()));

  if (merged.length > 0) {
    await upstashSetJsonWithSetPath(settlementKey(userId), merged);
  }

  const counts: SettlementServerRecoveryCounts = {
    userKey: userRecords.length,
    legacyKey: legacyRecords.length,
    dailyLogOrphans: dailyLogOrphansAdded,
    merged: merged.length,
  };

  return new Response(
    JSON.stringify({
      ok: true,
      records: merged,
      counts,
      titles: merged.map((r) => r.title),
      hasKkang,
      needsTitleHint,
      dailyLogStats: {
        totalEntries: allDailyEntries.length,
        uncoveredEntries: uncoveredDaily.length,
      },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
