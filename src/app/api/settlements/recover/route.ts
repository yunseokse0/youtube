export const runtime = "nodejs";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
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
import { normalizeSettlementRecords } from "@/lib/settlement";
import type { SettlementRecord } from "@/types";

const SETTLEMENT_KEY_BASE = "excel-broadcast-settlement-records-v1";
const SETTLEMENT_KEY_LEGACY = "excel-broadcast-settlement-records-v1";
const DAILY_LOG_KEY_BASE = "excel-broadcast-daily-log-v1";
const DAILY_LOG_KEY_LEGACY = "excel-broadcast-daily-log-v1";

function settlementKey(userId: string): string {
  return `${SETTLEMENT_KEY_BASE}:${userId}`;
}

function dailyLogKey(userId: string): string {
  return `${DAILY_LOG_KEY_BASE}:${userId}`;
}

type RecoverBody = {
  titleHint?: string;
};

/**
 * 레거시·사용자 Redis 키 + 일일 로그 고아 스냅샷에서 정산 기록 union 복구.
 */
export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => ({}))) as RecoverBody;
  const titleHint = String(body.titleHint || "").trim();

  const userRecordsRaw = await upstashGetJson<SettlementRecord[]>(settlementKey(userId));
  const legacyRecordsRaw = await upstashGetJson<SettlementRecord[]>(SETTLEMENT_KEY_LEGACY);
  const userRecords = Array.isArray(userRecordsRaw) ? userRecordsRaw : [];
  const legacyRecords = Array.isArray(legacyRecordsRaw) ? legacyRecordsRaw : [];

  let merged = mergeSettlementRecordArrays(userRecords, legacyRecords);

  const dailyLogUser = await upstashGetJson<Record<string, DailyLogEntry[]>>(dailyLogKey(userId));
  const dailyLogLegacy = await upstashGetJson<Record<string, DailyLogEntry[]>>(
    DAILY_LOG_KEY_LEGACY
  );
  const dailyLog: Record<string, DailyLogEntry[]> = {
    ...(dailyLogLegacy && typeof dailyLogLegacy === "object" ? dailyLogLegacy : {}),
    ...(dailyLogUser && typeof dailyLogUser === "object" ? dailyLogUser : {}),
  };

  const beforeDaily = merged.length;
  merged = recoverSettlementRecordsFromDailyLog(dailyLog, merged, {
    titleHint: titleHint || undefined,
  });
  merged = enrichSettlementRecordsDonorsFromDailyLog(merged, dailyLog);
  merged = normalizeSettlementRecords(merged);

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
