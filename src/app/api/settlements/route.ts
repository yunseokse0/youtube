export const runtime = "nodejs";
export const revalidate = 0;

import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import { mergeSettlementRecords, normalizeSettlementRecords } from "@/lib/settlement";
import type { SettlementRecord } from "@/types";
import { getUserIdFromRequest, resolveWriteUserId, writeUserIdErrorResponse } from "../_shared/user-id";
import {
  upstashGetJson,
  upstashSetJsonWithSetPath,
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

async function upstashSet(key: string, value: unknown) {
  return upstashSetJsonWithSetPath(key, value);
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
    const existingRaw = await upstashGet<SettlementRecord[]>(recordsKey(userId));
    const existing = Array.isArray(existingRaw) ? existingRaw : [];
    let toSave: SettlementRecord[];
    if (payload.length === 0) {
      toSave = existing.length > 0 ? existing : [];
    } else if (replace) {
      toSave = normalizeSettlementRecords(payload);
    } else {
      toSave = mergeSettlementRecords(existing, normalizeSettlementRecords(payload));
    }
    if (payload.length === 0 && existing.length === 0) {
      toSave = Array.isArray(memoryRecords[userId])
        ? (memoryRecords[userId] as SettlementRecord[])
        : [];
    }
    let ok = await upstashSet(recordsKey(userId), toSave);
    if (!ok) {
      if (isPersistentKvConfigured()) {
        return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      memoryRecords[userId] = toSave;
      ok = true;
    }
    if (ok) invalidateSettlementRecordsCache(userId);
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
