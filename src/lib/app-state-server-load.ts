import { isPersistentKvConfigured } from "@/app/api/_shared/upstash";
import { getPersistentKvLastError } from "@/app/api/_shared/upstash";
import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import { pickFresherAppState } from "@/lib/app-state-freshness";
import { mergeStatePreservingDonorsUntilSettlementReset } from "@/lib/donation/merge-donation-apply-base";
import {
  defaultState,
  hasMeaningfulMemberRoster,
  normalizeDonorsArray,
  totalCombined,
  type AppState,
} from "@/lib/state";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";

export function appStateStorageKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

/**
 * Redis·메모리 donors 를 리셋 가드 하에 모두 union.
 * pickFresherAppState 승자만 merge 하면 다른 쪽(예: Redis 단체짠 split) donors 가 유실될 수 있다.
 */
export function coalesceAppStateRedisAndMemory(
  redis: AppState | null | undefined,
  mem: AppState | null | undefined
): AppState | null {
  if (!redis && !mem) return null;
  if (!redis) return mem ?? null;
  if (!mem) return redis;
  if (!Array.isArray(redis.members) || !Array.isArray(mem.members)) {
    return pickFresherAppState(redis, mem);
  }
  const picked = pickFresherAppState(redis, mem) || redis;
  let merged = mergeStatePreservingDonorsUntilSettlementReset(picked, mem) ?? picked;
  merged = mergeStatePreservingDonorsUntilSettlementReset(merged, redis) ?? merged;
  return merged;
}

/**
 * Redis와 인메모리 중 더 신선한 상태를 반환.
 * 투네 후원 직후 메모리는 갱신됐는데 Redis GET이 지연되면 첫 후원이 엑셀에 안 보이는 문제를 막는다.
 * 같은 리셋 구간에서는 Redis·메모리 donors 를 union 해 수동 계좌·단체짠 유실을 막는다.
 *
 * KV 장애로 본문을 못 읽었을 때 빈 defaultState 를 반환하지 않는다 —
 * 호출측이 null 을 받으면 저장·반영을 건너뛴다 (엑셀/후원 자동 초기화 방지).
 */
export async function loadAppStateForUserId(userId: string): Promise<AppState | null> {
  const mem = getServerMemoryAppState(userId);
  if (isPersistentKvConfigured()) {
    const saved = await upstashGetAppStateJson<AppState>(appStateStorageKey(userId));
    const picked = coalesceAppStateRedisAndMemory(saved, mem);
    if (picked) {
      /** 메모리보다 Redis가 앞서면 메모리도 맞춤(반대는 덮어쓰지 않음) */
      if (mem !== picked) setServerMemoryAppState(userId, picked);
      return picked;
    }
    const kvErr = await getPersistentKvLastError();
    if (kvErr) {
      if (
        mem &&
        (normalizeDonorsArray(mem.donors).length > 0 ||
          totalCombined(mem) > 0 ||
          hasMeaningfulMemberRoster(mem))
      ) {
        return mem;
      }
      return null;
    }
  }
  return mem || defaultState();
}
