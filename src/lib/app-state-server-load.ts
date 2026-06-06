import { getRedisEnv } from "@/app/api/_shared/upstash";
import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import { defaultState, type AppState } from "@/lib/state";
import { getServerMemoryAppState } from "@/lib/server-memory-app-state";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";

export function appStateStorageKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

export async function loadAppStateForUserId(userId: string): Promise<AppState> {
  const { base, token } = getRedisEnv();
  if (base && token) {
    const saved = await upstashGetAppStateJson<AppState>(appStateStorageKey(userId));
    if (saved && Array.isArray(saved.members)) {
      return saved;
    }
  }
  return getServerMemoryAppState() || defaultState();
}
