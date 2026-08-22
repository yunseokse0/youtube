export const runtime = "nodejs";
export const revalidate = 0;

import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import type { DailyLogEntry } from "@/lib/state";
import { getUserIdFromRequest, resolveWriteUserId, writeUserIdErrorResponse } from "../_shared/user-id";
import {
  upstashGetJson,
  upstashSetJsonWithPipeline,
  isPersistentKvConfigured,
} from "../_shared/upstash";

const STORAGE_KEY_BASE = "excel-broadcast-daily-log-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-daily-log-v1";

// In-memory fallback when Upstash is unavailable (per-instance)
const memoryDailyLog: Record<string, Record<string, DailyLogEntry[]>> = {};

function getUserId(req: Request): string | null {
  return getUserIdFromRequest(req);
}

function logKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

async function upstashGet<T = unknown>(key: string): Promise<T | null> {
  return upstashGetJson<T>(key);
}

async function upstashSet(key: string, value: unknown) {
  return upstashSetJsonWithPipeline(key, value);
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
    let data: DailyLogData | null = await upstashGet<DailyLogData>(logKey(userId));
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      if (isLegacyMigrationTargetUserId(userId)) {
        const legacy = await upstashGet<DailyLogData>(STORAGE_KEY_LEGACY);
        if (legacy && typeof legacy === "object" && Object.keys(legacy).length > 0) {
          await upstashSet(logKey(userId), legacy);
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
    let ok = await upstashSet(logKey(userId), body);
    if (!ok) {
      if (isPersistentKvConfigured()) {
        return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      memoryDailyLog[userId] = body;
      ok = true;
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
