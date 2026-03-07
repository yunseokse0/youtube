export const runtime = "edge";
export const revalidate = 0;

import { AUTH_COOKIE } from "@/lib/auth";
import type { DailyLogEntry } from "@/lib/state";

const STORAGE_KEY_BASE = "excel-broadcast-daily-log-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-daily-log-v1";

// In-memory fallback when Upstash is unavailable (per-instance)
const memoryDailyLog: Record<string, Record<string, DailyLogEntry[]>> = {};

function getUserId(req: Request): string | null {
  const url = new URL(req.url);
  const fromUrl = url.searchParams.get("user");
  if (fromUrl && fromUrl.trim()) return fromUrl.trim();
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`));
  if (match) {
    try {
      const parsed = JSON.parse(decodeURIComponent(match[1]));
      return parsed?.id || null;
    } catch {
      return null;
    }
  }
  return null;
}

function logKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

function getEnv() {
  const base =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";
  return { base, token };
}

async function upstashGet(key: string) {
  const { base, token } = getEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { result?: string | null };
  if (!data || data.result == null) return null;
  try {
    return JSON.parse(data.result as string);
  } catch {
    return null;
  }
}

async function upstashSet(key: string, value: unknown) {
  const { base, token } = getEnv();
  if (!base || !token) return false;
  const json = JSON.stringify(value);
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([["SET", key, json]]),
  });
  return r.ok;
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
    let data: DailyLogData | null = await upstashGet(logKey(userId));
    if (!data || typeof data !== "object" || Object.keys(data).length === 0) {
      const legacy = await upstashGet(STORAGE_KEY_LEGACY);
      if (legacy && typeof legacy === "object" && Object.keys(legacy).length > 0) {
        await upstashSet(logKey(userId), legacy);
        data = legacy;
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
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = (await req.json()) as DailyLogData;
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ ok: false }), {
        headers: { "Content-Type": "application/json" },
        status: 400,
      });
    }
    let ok = await upstashSet(logKey(userId), body);
    if (!ok) {
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
