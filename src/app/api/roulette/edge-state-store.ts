import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { coalesceAppStateRedisAndMemory } from "@/lib/app-state-server-load";
import { mergeStatePreservingDonorsUntilSettlementReset } from "@/lib/donation/merge-donation-apply-base";
import { snapshotTimerForPersist } from "@/lib/timer-utils";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { getUserIdFromRequest } from "../_shared/user-id";
import { getRedisEnv } from "../_shared/upstash";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "../_shared/upstash-app-state";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

export function getRouletteUserId(req: Request): string | null {
  return getUserIdFromRequest(req);
}

function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

async function upstashGet(key: string): Promise<unknown | null> {
  return upstashGetAppStateJson(key);
}

async function upstashSet(key: string, value: unknown): Promise<boolean> {
  return upstashSetAppStateJson(key, value);
}

export async function loadAppStateForRoulette(userId: string): Promise<AppState> {
  const mem = getServerMemoryAppState(userId);
  const { base, token } = getRedisEnv();
  if (base && token) {
    const raw = await upstashGet(stateKey(userId));
    const redis = raw as AppState | null;
    const picked = coalesceAppStateRedisAndMemory(redis, mem);
    if (picked) {
      /** 오래된 Redis로 최신 메모리(방금 반영된 후원)를 덮어쓰지 않음 */
      if (mem !== picked) setServerMemoryAppState(userId, picked);
      return picked;
    }
  }
  if (mem && Array.isArray(mem.members)) return mem;
  return defaultState();
}

export async function saveAppStateForRoulette(userId: string, next: AppState): Promise<void> {
  const { base, token } = getRedisEnv();
  /**
   * 투네 반영이 구 스냅샷 위에 저장되면 직전 수동 계좌 donors 가 사라짐.
   * 정산 리셋이 아닌 한 Redis·메모리 기존 donors 와 union 후 기록.
   */
  const mem = getServerMemoryAppState(userId);
  let existing: AppState | null = mem && Array.isArray(mem.members) ? mem : null;
  if (base && token) {
    const raw = await upstashGet(stateKey(userId));
    existing = coalesceAppStateRedisAndMemory(raw as AppState | null, mem);
  }
  const merged = mergeStatePreservingDonorsUntilSettlementReset(next, existing);
  const persisted: AppState = {
    ...merged,
    generalTimer: snapshotTimerForPersist(merged.generalTimer),
  };
  setServerMemoryAppState(userId, persisted);
  if (base && token) {
    await upstashSet(stateKey(userId), persisted);
  }
}
