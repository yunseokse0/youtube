export const runtime = "nodejs";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import {
  getPersistentKvLastError,
  isPersistentKvConfigured,
} from "@/app/api/_shared/upstash";
import { isMysqlKvConfigured, mysqlKvPeekRevision } from "@/app/api/_shared/mysql-kv";
import { appStateStorageKey, loadAppStateForUserId } from "@/lib/app-state-server-load";
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
  const url = new URL(req.url);
  /** 기본 lite — 23MB monolith·백업 read 차단. ?full=1 만 헤비 진단 */
  const full = url.searchParams.get("full") === "1";
  const lite =
    !full ||
    url.searchParams.get("lite") === "1" ||
    process.env.STORAGE_HEALTH_FORCE_LITE === "1";

  const mem = getServerMemoryAppState(userId);
  let main = mem;
  if (!lite || !mem) {
    main = (await loadAppStateForUserId(userId)) || defaultState();
  } else {
    main = mem || defaultState();
    const rev = await mysqlKvPeekRevision(appStateStorageKey(userId));
    if (rev && rev > (main.updatedAt || 0)) {
      main = { ...main, updatedAt: rev };
    }
  }

  const backup = lite ? null : await loadDonationRosterBackup(userId);
  const dailyLog = lite ? null : await loadDailyLogForUserId(userId, { recentDays: 2 });
  const latestLog = dailyLog ? pickDailyLogEntryForRestore(dailyLog) : null;

  const mainDonors = normalizeDonorsArray(main.donors);
  const memDonors = mem ? normalizeDonorsArray(mem.donors) : [];

  return new Response(
    JSON.stringify({
      userId,
      lite,
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
