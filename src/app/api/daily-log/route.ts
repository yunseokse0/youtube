export const runtime = "nodejs";
export const revalidate = 0;

import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import type { DailyLogEntry } from "@/lib/state";
import { getUserIdFromRequest, resolveWriteUserId, writeUserIdErrorResponse } from "../_shared/user-id";
import {
  upstashGetJson,
  isPersistentKvConfigured,
} from "../_shared/upstash";
import { upstashSetAppStateJson } from "../_shared/upstash-app-state";
import {
  DAILY_LOG_SHARD_DAYS_ADMIN,
  dailyLogFromMonolith,
  dailyLogMonolithKvKey,
  dailyLogShardKvKey,
} from "@/lib/daily-log-shard";
import {
  invalidateDailyLogCache,
  loadDailyLogForUserId,
} from "@/lib/daily-log-server-load";

const STORAGE_KEY_LEGACY = "excel-broadcast-daily-log-v1";

// In-memory fallback when Upstash is unavailable (per-instance)
const memoryDailyLog: Record<string, Record<string, DailyLogEntry[]>> = {};

function getUserId(req: Request): string | null {
  return getUserIdFromRequest(req);
}

export type DailyLogData = Record<string, DailyLogEntry[]>;

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const url = new URL(req.url);
    const full = url.searchParams.get("full") === "1";
    let data: DailyLogData | null = null;

    if (isPersistentKvConfigured()) {
      data = await loadDailyLogForUserId(userId, {
        full,
        recentDays: full ? undefined : DAILY_LOG_SHARD_DAYS_ADMIN,
        bypassCache: url.searchParams.has("_t"),
      });
    } else {
      data = memoryDailyLog[userId] || {};
    }

    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      if (isLegacyMigrationTargetUserId(userId)) {
        const legacy = await upstashGetJson<DailyLogData>(STORAGE_KEY_LEGACY);
        if (legacy && typeof legacy === "object" && Object.keys(legacy).length > 0) {
          data = legacy;
        } else {
          data = memoryDailyLog[userId] || {};
        }
      } else {
        data = memoryDailyLog[userId] || {};
      }
    }
    return new Response(
      JSON.stringify(data && typeof data === "object" ? data : {}),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
      }
    );
  } catch {
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}

export async function POST(req: Request) {
  try {
    const writeUid = resolveWriteUserId(req);
    if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
    const userId = writeUid.userId;
    const body = (await req.json()) as DailyLogData;
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }

    let ok = true;
    if (isPersistentKvConfigured()) {
      const monolith = dailyLogFromMonolith(body);
      const payload = monolith ?? body;
      for (const [dateKey, entries] of Object.entries(payload)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Array.isArray(entries)) continue;
        const shardOk = await upstashSetAppStateJson(
          dailyLogShardKvKey(userId, dateKey),
          entries
        );
        if (!shardOk) {
          ok = false;
          break;
        }
      }
      if (ok) {
        invalidateDailyLogCache(userId);
        await upstashSetAppStateJson(dailyLogMonolithKvKey(userId), {
          __migrated: true,
          at: Date.now(),
          via: "api-post",
        });
      } else if (isPersistentKvConfigured()) {
        return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    } else {
      memoryDailyLog[userId] = body;
    }

    return new Response(JSON.stringify({ ok }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
      status: ok ? 200 : 500,
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}
