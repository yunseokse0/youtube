export const runtime = "nodejs";
export const revalidate = 0;

import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import { mergeSettlementRecords, normalizeSettlementRecords } from "@/lib/settlement";
import type { SettlementRecord } from "@/types";
import { getUserIdFromRequest, resolveWriteUserId, writeUserIdErrorResponse } from "../_shared/user-id";
import {
  upstashGetJson,
  isPersistentKvConfigured,
} from "../_shared/upstash";
import {
  invalidateSettlementRecordsCache,
  loadSettlementRecordsForUserId,
  SETTLEMENT_RECENT_DEFAULT,
} from "@/lib/settlement-server-load";

const STORAGE_KEY_BASE = "excel-broadcast-settlement-records-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-settlement-records-v1";

const memoryRecords: Record<string, unknown[]> = {};

function getUserId(req: Request): string | null {
  return getUserIdFromRequest(req);
}

function recordsKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

async function upstashGet<T = unknown>(key: string): Promise<T | null> {
  return upstashGetJson<T>(key);
}

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
    const recentParam = url.searchParams.get("recent");
    const recent = recentParam ? Math.max(1, parseInt(recentParam, 10) || SETTLEMENT_RECENT_DEFAULT) : SETTLEMENT_RECENT_DEFAULT;

    let filtered: SettlementRecord[] = [];
    if (isPersistentKvConfigured()) {
      filtered = await loadSettlementRecordsForUserId(userId, {
        full,
        recent,
        bypassCache: url.searchParams.has("_t"),
      });
    } else if (isLegacyMigrationTargetUserId(userId)) {
      const legacy = await upstashGet<SettlementRecord[]>(STORAGE_KEY_LEGACY);
      filtered = Array.isArray(legacy) ? legacy : [];
    } else {
      filtered = Array.isArray(memoryRecords[userId])
        ? (memoryRecords[userId] as SettlementRecord[])
        : [];
    }

    return new Response(JSON.stringify(filtered), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        "X-Settlement-Mode": full ? "full" : `recent-${recent}`,
      },
    });
  } catch {
    return new Response(JSON.stringify([]), {
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
    const body = await req.json();
    const payload = Array.isArray(body) ? (body as SettlementRecord[]) : [];
    const replace = new URL(req.url).searchParams.get("mode") === "replace";

    if (!isPersistentKvConfigured()) {
      const existing = Array.isArray(memoryRecords[userId])
        ? (memoryRecords[userId] as SettlementRecord[])
        : [];
      const toSave =
        payload.length === 0
          ? existing
          : replace
            ? normalizeSettlementRecords(payload)
            : mergeSettlementRecords(existing, normalizeSettlementRecords(payload));
      memoryRecords[userId] = toSave;
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
      });
    }

    const {
      saveSettlementRecordsMonolith,
      saveSettlementRecordsSharded,
    } = await import("@/lib/settlement-server-save");

    if (payload.length === 0 && !replace) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const sharded = await saveSettlementRecordsSharded(userId, payload, { replace });
    if (sharded.ok) {
      return new Response(JSON.stringify({ ok: true, sharded: true, days: sharded.dateKeys.length }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
      });
    }

    /** monolith fallback — 마이그레이션 전 */
    const existingRaw = await upstashGet<SettlementRecord[]>(recordsKey(userId));
    const existing = Array.isArray(existingRaw) ? existingRaw : [];
    const toSave =
      payload.length === 0
        ? existing
        : replace
          ? normalizeSettlementRecords(payload)
          : mergeSettlementRecords(existing, normalizeSettlementRecords(payload));
    const ok = await saveSettlementRecordsMonolith(userId, toSave);
    if (!ok) {
      return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
        status: 503,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    invalidateSettlementRecordsCache(userId);
    return new Response(JSON.stringify({ ok: true, sharded: false }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}
