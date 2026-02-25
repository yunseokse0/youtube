export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { createModuleLogger } from "@/lib/logger";

const logger = createModuleLogger('API/State');

const STORAGE_KEY = "excel-broadcast-state-v1";

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

let memoryState: AppState | null = null;

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
  const url = `${base.replace(/\/$/, "")}/set/${encodeURIComponent(
    key
  )}/${encodeURIComponent(json)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok;
}

export async function GET() {
  try {
    const { base, token } = getEnv();
    if (!base || !token) {
      const state = memoryState || defaultState();
      logger.debug('메모리 상태 반환', { membersCount: state.members.length, donorsCount: state.donors.length });
      return new Response(JSON.stringify(state), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
      });
    }

    const state = await upstashGet(STORAGE_KEY);
    logger.debug('Redis 상태 반환', { hasState: !!state });
    return new Response(JSON.stringify(state || {}), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
    });
  } catch (error) {
    logger.error('상태 조회 실패', error);
    const fallback = memoryState || defaultState();
    return new Response(JSON.stringify(fallback), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AppState;
    const next: AppState = { ...body, updatedAt: Date.now() };

    const { base, token } = getEnv();
    if (!base || !token) {
      memoryState = next;
      logger.info('메모리 상태 업데이트', { updatedAt: next.updatedAt });
      return new Response(JSON.stringify({ ok: true }), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
        status: 200,
      });
    }

    const ok = await upstashSet(STORAGE_KEY, next);
    logger.info('Redis 상태 업데이트', { updatedAt: next.updatedAt, success: ok });
    return new Response(JSON.stringify({ ok }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
      status: ok ? 200 : 500,
    });
  } catch (error) {
    logger.error('상태 업데이트 실패', error);
    return new Response(JSON.stringify({ ok: false }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}