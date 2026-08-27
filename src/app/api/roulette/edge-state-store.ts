import type { AppState } from "@/lib/state";
import {
  defaultState,
  hasMeaningfulMemberRoster,
  isAccidentalEmptyRosterState,
  shouldBlockAccidentalEmptyOverwrite,
} from "@/lib/state";
import { coalesceAppStateRedisAndMemory, loadAppStateForUserId } from "@/lib/app-state-server-load";
import {
  mergeDonationReplaceForPersist,
  mergeStatePreservingDonorsUntilSettlementReset,
} from "@/lib/donation/merge-donation-apply-base";
import { loadDonationRosterBackupFromKv } from "@/lib/donation-roster-backup-redis";
import { unionAppStateDonorsFromBackupIfRicher } from "@/lib/donation-roster-backup-core";
import { clearIntentionalDonationClearIfHasDonations } from "@/lib/intentional-donation-clear";
import { snapshotTimerForPersist } from "@/lib/timer-utils";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { resolveWriteUserId } from "../_shared/user-id";
import { isPersistentKvConfigured } from "../_shared/upstash";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "../_shared/upstash-app-state";

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

export function getRouletteUserId(req: Request): string | null {
  /** OBS 시그 오버레이 spin/land — `?u=` 허용, 쿠키와 불일치 시 거부 */
  const writeUid = resolveWriteUserId(req, { allowAnonymousUrlUser: true });
  return writeUid.ok ? writeUid.userId : null;
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

/**
 * 룰렛·후원 저장용 로드.
 * Edge 번들에 fs 백업을 넣지 않음 — 디스크 복구는 /api/state·restore-backup(Node) 경로.
 * KV/메모리에 실데이터가 있으면 그걸 쓰고, 없을 때만 default.
 */
export async function loadAppStateForRoulette(userId: string): Promise<AppState> {
  const loaded = await loadAppStateForUserId(userId);
  if (loaded && !isAccidentalEmptyRosterState(loaded)) {
    return loaded;
  }
  if (loaded) return loaded;
  const mem = getServerMemoryAppState(userId);
  if (mem && Array.isArray(mem.members) && !isAccidentalEmptyRosterState(mem)) return mem;
  return mem || defaultState();
}

export type DonorsPersistMode = "add" | "replace";

export type SaveAppStateForRouletteOptions = {
  /** add=투네·수동 추가(union), replace=삭제·나누기·재배치(incoming donors 그대로) */
  donorsMode?: DonorsPersistMode;
  /** true 일 때만 사고성 빈 로스터로 기존 실데이터를 덮을 수 있음(정산 리셋) */
  allowEmptyRosterWipe?: boolean;
};

export async function saveAppStateForRoulette(
  userId: string,
  next: AppState,
  opts?: SaveAppStateForRouletteOptions
): Promise<{ ok: boolean; state: AppState }> {
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

  let incoming = next;
  /** 정산 리셋 등 의도적 비우기 — 백업 union 이 구 후원을 다시 넣지 않게 */
  if (kvOk && !opts?.allowEmptyRosterWipe) {
    try {
      const backup = await loadDonationRosterBackupFromKv(userId);
      incoming = unionAppStateDonorsFromBackupIfRicher(incoming, backup);
    } catch {
      /* noop */
    }
  }
  if (
    !opts?.allowEmptyRosterWipe &&
    existing &&
    shouldBlockAccidentalEmptyOverwrite(existing, next)
  ) {
    /** 사고성 멤버1·2…/빈 후원으로 실데이터 덮지 않음 */
    incoming = {
      ...next,
      members: existing.members,
      memberPositions: existing.memberPositions ?? next.memberPositions,
      donors: existing.donors,
      settlementResetAt: existing.settlementResetAt,
      donorRankingsUpdatedAt: Math.max(
        Number(existing.donorRankingsUpdatedAt || 0),
        Number(next.donorRankingsUpdatedAt || 0)
      ),
    };
  }

  const wipeOpts = opts?.allowEmptyRosterWipe ? { allowEmptyRosterWipe: true } : undefined;
  const merged =
    opts?.donorsMode === "replace"
      ? mergeDonationReplaceForPersist(incoming, existing, wipeOpts)
      : mergeStatePreservingDonorsUntilSettlementReset(incoming, existing, wipeOpts);

  let persisted: AppState = {
    ...merged,
    generalTimer: snapshotTimerForPersist(merged.generalTimer),
    matchTimer: snapshotTimerForPersist(merged.matchTimer ?? merged.generalTimer),
  };
  persisted = clearIntentionalDonationClearIfHasDonations(persisted);

  if (
    !opts?.allowEmptyRosterWipe &&
    existing &&
    shouldBlockAccidentalEmptyOverwrite(existing, persisted)
  ) {
    persisted = {
      ...persisted,
      members: existing.members,
      memberPositions: existing.memberPositions ?? persisted.memberPositions,
      donors: existing.donors,
      settlementResetAt: existing.settlementResetAt,
    };
  }

  /** 실멤버가 플레이스홀더로 바뀌지 않게 */
  if (
    !opts?.allowEmptyRosterWipe &&
    existing &&
    hasMeaningfulMemberRoster(existing) &&
    !hasMeaningfulMemberRoster(persisted)
  ) {
    persisted = {
      ...persisted,
      members: existing.members,
      memberPositions: existing.memberPositions ?? persisted.memberPositions,
    };
  }

  setServerMemoryAppState(userId, persisted);
  if (!kvOk) {
    return { ok: true, state: persisted };
  }
  const wrote = await upstashSet(stateKey(userId), persisted);
  return { ok: wrote, state: persisted };
}
