import type { AppState } from "@/types";

/** Redis 미설정 시 /api/state 및 /api/roulette 이 공유하는 인메모리 스냅샷 */
let cached: AppState | null = null;

export function getServerMemoryAppState(): AppState | null {
  return cached;
}

export function setServerMemoryAppState(next: AppState | null): void {
  cached = next;
}
