import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import type { DailyLogEntry } from "@/lib/state";

const DAILY_LOG_KEY_BASE = "excel-broadcast-daily-log-v1";

export function dailyLogStorageKey(userId: string): string {
  return `${DAILY_LOG_KEY_BASE}:${userId}`;
}

/** 서버 — MySQL/Redis 일일 로그 (후원 스냅샷·작업 로그) */
export async function loadDailyLogForUserId(
  userId: string
): Promise<Record<string, DailyLogEntry[]>> {
  const user = await upstashGetAppStateJson<Record<string, DailyLogEntry[]>>(
    dailyLogStorageKey(userId)
  );
  const legacy = await upstashGetAppStateJson<Record<string, DailyLogEntry[]>>(
    DAILY_LOG_KEY_BASE
  );
  return {
    ...(legacy && typeof legacy === "object" ? legacy : {}),
    ...(user && typeof user === "object" ? user : {}),
  };
}
