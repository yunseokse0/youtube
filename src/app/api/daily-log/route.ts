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
  DAILY_LOG_ADMIN_MAX_ENTRIES_PER_DAY,
  DAILY_LOG_MAX_ENTRIES_PER_DAY_STORE,
  DAILY_LOG_SHARD_DAYS_ADMIN,
  dailyLogEntriesFromShardPayload,
  dailyLogFromMonolith,
  dailyLogMonolithKvKey,
  dailyLogShardKvKey,
  slimDailyLogEntry,
  trimDailyLogEntries,
} from "@/lib/daily-log-shard";
import {
  invalidateDailyLogCache,
  loadDailyLogForUserId,
} from "@/lib/daily-log-server-load";
import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";

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
    const daysParam = Number(url.searchParams.get("days") || "");
    const maxEntriesParam = Number(url.searchParams.get("maxEntries") || "");
    const recentDays =
      Number.isFinite(daysParam) && daysParam > 0
        ? Math.min(90, Math.floor(daysParam))
        : DAILY_LOG_SHARD_DAYS_ADMIN;
    const maxEntriesPerDay =
      Number.isFinite(maxEntriesParam) && maxEntriesParam > 0
        ? Math.min(200, Math.floor(maxEntriesParam))
        : DAILY_LOG_ADMIN_MAX_ENTRIES_PER_DAY;

    let data: DailyLogData | null = null;

    if (isPersistentKvConfigured()) {
      data = await loadDailyLogForUserId(userId, {
        full,
        recentDays: full ? undefined : recentDays,
        maxEntriesPerDay: full ? undefined : maxEntriesPerDay,
        /** _t 는 명시적 bust 전용 — 기본 hydrate는 캐시 사용 */
        bypassCache: url.searchParams.get("bust") === "1" || url.searchParams.get("_t") === "1",
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
    const body = data && typeof data === "object" ? data : {};
    const json = JSON.stringify(body);
    return new Response(json, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        "X-Daily-Log-Mode": full ? "full" : `recent-${recentDays}-me${maxEntriesPerDay}`,
        "X-Daily-Log-Bytes": String(json.length),
      },
    });
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
    const body = (await req.json()) as DailyLogData & {
      append?: boolean;
      dateKey?: string;
      entry?: DailyLogEntry;
    };
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }

    let ok = true;
    if (isPersistentKvConfigured()) {
      /** 단일 엔트리 append — 거대 GET→merge→POST 대체 */
      if (body.append === true && body.dateKey && body.entry && typeof body.entry === "object") {
        const dateKey = String(body.dateKey);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          return new Response(JSON.stringify({ ok: false, error: "bad_date" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const shardKey = dailyLogShardKvKey(userId, dateKey);
        const existingRaw = await upstashGetAppStateJson<unknown>(shardKey);
        const prev = dailyLogEntriesFromShardPayload(existingRaw) ?? [];
        const next = trimDailyLogEntries(
          [...prev, slimDailyLogEntry(body.entry as DailyLogEntry)],
          DAILY_LOG_MAX_ENTRIES_PER_DAY_STORE
        );
        ok = await upstashSetAppStateJson(shardKey, next);
        if (ok) {
          invalidateDailyLogCache(userId);
          await upstashSetAppStateJson(dailyLogMonolithKvKey(userId), {
            __migrated: true,
            at: Date.now(),
            via: "api-append",
          });
        }
      } else {
        const monolith = dailyLogFromMonolith(body);
        const payload = monolith ?? body;
        for (const [dateKey, entries] of Object.entries(payload)) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Array.isArray(entries)) continue;
          const slimmed = trimDailyLogEntries(
            (entries as DailyLogEntry[]).map((e) => slimDailyLogEntry(e)),
            DAILY_LOG_MAX_ENTRIES_PER_DAY_STORE
          );
          const shardOk = await upstashSetAppStateJson(
            dailyLogShardKvKey(userId, dateKey),
            slimmed
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
        }
      }
      if (!ok) {
        return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
    } else {
      memoryDailyLog[userId] = body as DailyLogData;
    }

    return new Response(JSON.stringify({ ok }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
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
