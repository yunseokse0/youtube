export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { createModuleLogger } from "@/lib/logger";
import { AUTH_COOKIE } from "@/lib/auth";

const logger = createModuleLogger('API/State');

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

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
    } catch { return null; }
  }
  return null;
}

function stateKey(userId: string | null): string {
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

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
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

    let state = await upstashGet(stateKey(userId));
    if (!state || !Array.isArray(state.members)) {
      const legacy = await upstashGet(STORAGE_KEY_LEGACY);
      if (legacy && (Array.isArray(legacy.members) || Array.isArray(legacy.overlayPresets))) {
        await upstashSet(stateKey(userId), legacy);
        state = legacy;
        logger.info('기존 데이터 계정으로 마이그레이션', { userId });
      }
    }
    // Redis에서 상태를 못 가져오더라도 방송 지속성을 위해 메모리/기본 상태 반환
    const effective = state || memoryState || defaultState();
    logger.debug('Redis 상태 반환', { hasState: !!state, usedMemory: !!memoryState, userId });
    return new Response(JSON.stringify(effective), {
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
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
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

    const ok = await upstashSet(stateKey(userId), next);
    logger.info('Redis 상태 업데이트', { updatedAt: next.updatedAt, success: ok, userId });
    // Redis 오류 시에도 방송 중단 방지를 위해 메모리에 저장 후 200 반환
    if (!ok) {
      memoryState = next;
      logger.warn('Redis 업데이트 실패로 메모리에 기록', { updatedAt: next.updatedAt, userId });
    } else {
      memoryState = next;
    }
    return new Response(JSON.stringify({ ok: true, fallback: ok ? undefined : "memory" }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
      status: 200,
    });
  } catch (error) {
    logger.error('상태 업데이트 실패', error);
    // 예외 발생 시에도 메모리에 저장 시도
    try {
      const body = (await req.json()) as AppState;
      memoryState = { ...body, updatedAt: Date.now() };
      logger.warn('예외 발생으로 메모리에 기록', { updatedAt: memoryState.updatedAt });
    } catch {}
    return new Response(JSON.stringify({ ok: true, fallback: "memory" }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}
