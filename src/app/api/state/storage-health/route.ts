export const runtime = "nodejs";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import {
  getPersistentKvLastError,
  isPersistentKvConfigured,
} from "@/app/api/_shared/upstash";
import { isMysqlKvConfigured } from "@/app/api/_shared/mysql-kv";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { loadDailyLogForUserId } from "@/lib/daily-log-server-load";
import { loadDonationRosterBackup } from "@/lib/donation-roster-backup";
import { pickDailyLogEntryForRestore } from "@/lib/state-restore";
import { getServerMemoryAppState } from "@/lib/server-memory-app-state";
import { defaultState, normalizeDonorsArray, totalCombined } from "@/lib/state";

/** MySQL/Redis에 후원·백업·일일로그가 어떻게 저장돼 있는지 진단 */
export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const kvConfigured = isPersistentKvConfigured();
  const mysqlConfigured = isMysqlKvConfigured();
  const kvError = kvConfigured ? await getPersistentKvLastError() : null;

  const main = (await loadAppStateForUserId(userId)) || defaultState();
  const mem = getServerMemoryAppState(userId);
  const backup = await loadDonationRosterBackup(userId);
  const dailyLog = await loadDailyLogForUserId(userId);
  const latestLog = pickDailyLogEntryForRestore(dailyLog);

  const mainDonors = normalizeDonorsArray(main.donors);
  const memDonors = mem ? normalizeDonorsArray(mem.donors) : [];

  return new Response(
    JSON.stringify({
      userId,
      storage: {
        persistentKv: kvConfigured,
        mysql: mysqlConfigured,
        kvError,
        backendHint: mysqlConfigured
          ? "mysql(app_kv)"
          : kvConfigured
            ? "redis"
            : "memory_only",
      },
      mainState: {
        donorsCount: mainDonors.length,
        totalCombined: totalCombined(main),
        updatedAt: main.updatedAt || 0,
        settlementResetAt: Number(main.settlementResetAt || 0),
      },
      memoryState: mem
        ? {
            donorsCount: memDonors.length,
            totalCombined: totalCombined(mem),
            updatedAt: mem.updatedAt || 0,
          }
        : null,
      donationBackup: backup
        ? {
            donorsCount: backup.donorsCount,
            total: backup.total,
            savedAt: backup.savedAt,
            settlementResetAt: Number(backup.settlementResetAt || 0),
          }
        : null,
      dailyLogLatest: latestLog
        ? {
            at: latestLog.at,
            donorsCount: Array.isArray(latestLog.donors) ? latestLog.donors.length : 0,
            membersCount: Array.isArray(latestLog.members) ? latestLog.members.length : 0,
          }
        : null,
      hint:
        mainDonors.length === 0 && latestLog && (latestLog.donors?.length || 0) > 0
          ? "main_state_empty_but_daily_log_has_donors"
          : mainDonors.length === 0 && backup && backup.donorsCount > 0
            ? "main_state_empty_but_backup_has_donors"
            : null,
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
}
