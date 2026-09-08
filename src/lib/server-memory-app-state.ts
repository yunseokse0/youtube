import type { AppState } from "@/types";

const SERVER_MEMORY_APP_STATE_GLOBAL_KEY =
  "__YOUTUBE_HARMONY_SERVER_MEMORY_APP_STATE_V1__";

type MemoryStore = Map<string, AppState>;

function getGlobalMemoryStore(): MemoryStore {
  const g = globalThis as unknown as Record<string, unknown>;
  if (!g[SERVER_MEMORY_APP_STATE_GLOBAL_KEY]) {
    g[SERVER_MEMORY_APP_STATE_GLOBAL_KEY] = new Map<string, AppState>();
  }
  return g[SERVER_MEMORY_APP_STATE_GLOBAL_KEY] as MemoryStore;
}

export function getServerMemoryAppState(userId: string | null | undefined): AppState | null {
  const uid = String(userId || "").trim();
  if (!uid) return null;
  const cacheByUserId = getGlobalMemoryStore();
  return cacheByUserId.get(uid) ?? null;
}

export function setServerMemoryAppState(
  userId: string | null | undefined,
  next: AppState | null
): void {
  const uid = String(userId || "").trim();
  if (!uid) return;
  const cacheByUserId = getGlobalMemoryStore();
  if (next === null) cacheByUserId.delete(uid);
  else cacheByUserId.set(uid, next);
}
