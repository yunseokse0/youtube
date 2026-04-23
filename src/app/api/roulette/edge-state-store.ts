import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { AUTH_COOKIE } from "@/lib/auth";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

function isLocalRequest(req: Request): boolean {
  const host = (req.headers.get("host") || "").toLowerCase();
  return host.includes("localhost") || host.includes("127.0.0.1") || host.includes("[::1]");
}

export function getRouletteUserId(req: Request): string | null {
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
  if (isLocalRequest(req)) return "admin";
  return null;
}

function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

function getEnv() {
  const base = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return { base, token };
}

async function upstashGet(key: string): Promise<unknown | null> {
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

async function upstashSet(key: string, value: unknown): Promise<boolean> {
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

export async function loadAppStateForRoulette(userId: string): Promise<AppState> {
  const { base, token } = getEnv();
  if (base && token) {
    const raw = await upstashGet(stateKey(userId));
    const s = raw as AppState | null;
    if (s && Array.isArray(s.members)) {
      setServerMemoryAppState(s);
      return s;
    }
  }
  const mem = getServerMemoryAppState();
  if (mem && Array.isArray(mem.members)) return mem;
  return defaultState();
}

export async function saveAppStateForRoulette(userId: string, next: AppState): Promise<void> {
  const { base, token } = getEnv();
  setServerMemoryAppState(next);
  if (base && token) {
    await upstashSet(stateKey(userId), next);
  }
}
