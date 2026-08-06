import { getRedisEnv } from "@/app/api/_shared/upstash";
import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import { pickFresherAppState } from "@/lib/app-state-freshness";
import { mergeStatePreservingDonorsUntilSettlementReset } from "@/lib/donation/merge-donation-apply-base";
import { defaultState, type AppState } from "@/lib/state";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";

export function appStateStorageKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

/**
 * Redis와 인메모리 중 더 신선한 상태를 반환.
 * 투네 후원 직후 메모리는 갱신됐는데 Redis GET이 지연되면 첫 후원이 엑셀에 안 보이는 문제를 막는다.
 * 같은 리셋 구간에서는 Redis·메모리 donors 를 union 해 수동 계좌 유실을 막는다.
 */
export async function loadAppStateForUserId(userId: string): Promise<AppState> {
  const mem = getServerMemoryAppState(userId);
  const { base, token } = getRedisEnv();
  if (base && token) {
    const saved = await upstashGetAppStateJson<AppState>(appStateStorageKey(userId));
    let picked = pickFresherAppState(saved, mem);
    if (saved && mem && Array.isArray(saved.members) && Array.isArray(mem.members)) {
      picked = mergeStatePreservingDonorsUntilSettlementReset(picked || saved, mem);
    }
    if (picked) {
      /** 메모리보다 Redis가 앞서면 메모리도 맞춤(반대는 덮어쓰지 않음) */
      if (mem !== picked) setServerMemoryAppState(userId, picked);
      return picked;
    }
  }
  return mem || defaultState();
}
