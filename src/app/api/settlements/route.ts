export const runtime = "edge";
export const revalidate = 0;

import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import { getUserIdFromRequest } from "../_shared/user-id";
import {
  upstashGetJson,
  upstashSetJsonWithSetPath,
} from "../_shared/upstash";

const STORAGE_KEY_BASE = "excel-broadcast-settlement-records-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-settlement-records-v1";

// In-memory fallback for environments without Upstash (per-instance)
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
    let records = await upstashGet(recordsKey(userId));
    if (!Array.isArray(records) || records.length === 0) {
      if (isLegacyMigrationTargetUserId(userId)) {
        const legacy = await upstashGet(STORAGE_KEY_LEGACY);
        if (Array.isArray(legacy) && legacy.length > 0) {
          await upstashSet(recordsKey(userId), legacy);
          records = legacy;
        } else {
          records = Array.isArray(memoryRecords[userId]) ? memoryRecords[userId] : [];
        }
      } else {
        records = Array.isArray(memoryRecords[userId]) ? memoryRecords[userId] : [];
      }
    }
    return new Response(JSON.stringify(Array.isArray(records) ? records : []), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
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
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = await req.json();
    const payload = Array.isArray(body) ? body : [];
    let ok = await upstashSet(recordsKey(userId), payload);
    if (!ok) {
      // Fallback to memory store when Upstash is unavailable
      memoryRecords[userId] = payload;
      ok = true;
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

