import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { coalesceAppStateRedisAndMemory } from "@/lib/app-state-server-load";
import {
  mergeDonationReplaceForPersist,
  mergeStatePreservingDonorsUntilSettlementReset,
} from "@/lib/donation/merge-donation-apply-base";
import { snapshotTimerForPersist } from "@/lib/timer-utils";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { getUserIdFromRequest } from "../_shared/user-id";
import { isPersistentKvConfigured } from "../_shared/upstash";
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
  if (isPersistentKvConfigured()) {
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

export type DonorsPersistMode = "add" | "replace";

export type SaveAppStateForRouletteOptions = {
  /** add=투네·수동 추가(union), replace=삭제·나누기·재배치(incoming donors 그대로) */
  donorsMode?: DonorsPersistMode;
};

export async function saveAppStateForRoulette(
  userId: string,
  next: AppState,
  opts?: SaveAppStateForRouletteOptions
): Promise<AppState> {
  /**
   * 투네 반영이 구 스냅샷 위에 저장되면 직전 수동 계좌 donors 가 사라짐.
   * 정산 리셋이 아닌 한 Redis·메모리 기존 donors 와 union 후 기록.
   * replace 는 삭제·단체짠 등 intentional shrink — union 금지.
   */
  const mem = getServerMemoryAppState(userId);
  let existing: AppState | null = mem && Array.isArray(mem.members) ? mem : null;
  const kvOk = isPersistentKvConfigured();
  if (kvOk) {
    const raw = await upstashGet(stateKey(userId));
    existing = coalesceAppStateRedisAndMemory(raw as AppState | null, mem);
  }
  const merged =
    opts?.donorsMode === "replace"
      ? mergeDonationReplaceForPersist(next, existing)
      : mergeStatePreservingDonorsUntilSettlementReset(next, existing);
  const persisted: AppState = {
    ...merged,
    generalTimer: snapshotTimerForPersist(merged.generalTimer),
  };
  setServerMemoryAppState(userId, persisted);
  if (kvOk) {
    await upstashSet(stateKey(userId), persisted);
  }
  return persisted;
}
