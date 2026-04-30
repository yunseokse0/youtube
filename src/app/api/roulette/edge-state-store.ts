import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { getUserIdFromRequest } from "../_shared/user-id";
import {
  getRedisEnv,
  upstashGetJson,
  upstashSetJsonWithPipeline,
} from "../_shared/upstash";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

export function getRouletteUserId(req: Request): string | null {
  return getUserIdFromRequest(req);
}

function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

async function upstashGet(key: string): Promise<unknown | null> {
  return upstashGetJson(key);
}

async function upstashSet(key: string, value: unknown): Promise<boolean> {
  return upstashSetJsonWithPipeline(key, value);
}

export async function loadAppStateForRoulette(userId: string): Promise<AppState> {
  const { base, token } = getRedisEnv();
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
  const { base, token } = getRedisEnv();
  setServerMemoryAppState(next);
  if (base && token) {
    await upstashSet(stateKey(userId), next);
  }
}
