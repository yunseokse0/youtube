import type { AppState } from "@/lib/state";
import {
  defaultState,
  hasMeaningfulMemberRoster,
  isAccidentalEmptyRosterState,
  shouldBlockAccidentalEmptyOverwrite,
} from "@/lib/state";
import { coalesceAppStateRedisAndMemory, loadAppStateForUserId, seedAppStateKvCache } from "@/lib/app-state-server-load";
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

const BROADCAST_WRITE_THROTTLE_MS = 3_000;
const BROADCAST_WRITE_DEBOUNCE_MS = 2_000;
const broadcastLastRunAt = new Map<string, number>();
const broadcastPending = new Map<
  string,
  {
    timer: ReturnType<typeof setTimeout> | null;
    payload: { persisted: AppState; opts?: SaveAppStateForRouletteOptions; scheduledAt: number } | null;
  }
>();

const saveMutexMap = new Map<string, Promise<{ ok: boolean; state: AppState }>>();

function serializedSaveAppStateForRoulette(
  userId: string,
  next: AppState,
  opts: SaveAppStateForRouletteOptions | undefined,
  exec: () => Promise<{ ok: boolean; state: AppState }>
): Promise<{ ok: boolean; state: AppState }> {
  const prev = saveMutexMap.get(userId) ?? Promise.resolve({ ok: true, state: next });
  const nextPromise = prev.then(
    () => exec(),
    () => exec()
  );
  saveMutexMap.set(userId, nextPromise);
  void nextPromise.then(
    () => {
      const cur = saveMutexMap.get(userId);
      if (cur === nextPromise) saveMutexMap.delete(userId);
    },
    () => {
      const cur = saveMutexMap.get(userId);
      if (cur === nextPromise) saveMutexMap.delete(userId);
    }
  );
  return nextPromise;
}

function scheduleBroadcastWrite(
  userId: string,
  persisted: AppState,
  opts: SaveAppStateForRouletteOptions | undefined
): void {
  const isResetWipe =
    opts?.allowEmptyRosterWipe === true &&
    Array.isArray(persisted.donors) &&
    persisted.donors.length === 0;

  if (typeof setTimeout === "undefined") {
    void dualWriteBroadcastDonations(userId, persisted, opts).catch(() => {});
    return;
  }

  const now = Date.now();
  const entry = broadcastPending.get(userId) ?? { timer: null, payload: null };

  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
    entry.payload = null;
  }

  if (isResetWipe) {
    broadcastPending.set(userId, entry);
    broadcastLastRunAt.set(userId, Date.now());
    void dualWriteBroadcastDonations(userId, persisted, opts).catch(() => {});
    return;
  }

  const lastRun = broadcastLastRunAt.get(userId) || 0;
  entry.payload = { persisted, opts, scheduledAt: now };

  const gap = now - lastRun;
  const waitMs =
    gap >= BROADCAST_WRITE_THROTTLE_MS ? BROADCAST_WRITE_DEBOUNCE_MS : BROADCAST_WRITE_THROTTLE_MS - gap + BROADCAST_WRITE_DEBOUNCE_MS;

  entry.timer = setTimeout(() => {
    const live = broadcastPending.get(userId);
    const payload = live?.payload;
    if (live) {
      live.timer = null;
      live.payload = null;
    }
    broadcastLastRunAt.set(userId, Date.now());
    if (payload) void dualWriteBroadcastDonations(userId, payload.persisted, payload.opts).catch(() => {});
  }, Math.max(0, Math.min(waitMs, 5_000)));

  broadcastPending.set(userId, entry);
}

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
  /** 멤버 목록 의도적 변경(추가·삭제·개명·정산 리셋)시 true → rosterVersion monotonic bump */
  bumpRosterVersion?: boolean;
  /** 후원 원장 의도적 변경(삭제·재배치·replace 저장·정산 리셋)시 true → donorListVersion monotonic bump */
  bumpDonorListVersion?: boolean;
};

export async function saveAppStateForRoulette(
  userId: string,
  next: AppState,
  opts?: SaveAppStateForRouletteOptions
): Promise<{ ok: boolean; state: AppState }> {
  return serializedSaveAppStateForRoulette(userId, next, opts, () =>
    saveAppStateForRouletteDirect(userId, next, opts)
  );
}

async function saveAppStateForRouletteDirect(
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
  /**
   * replace(삭제·나누기) + 서버 메모리 warm — MySQL LONGTEXT GET 생략.
   * mem은 직전 저장에서 갱신되므로 단건 삭제 연속 UX가 GET+SET 이중 I/O에 막히지 않게 한다.
   * add(투네)는 멀티탭 union 안전을 위해 KV 조회 유지.
   */
  const skipKvReadForReplace =
    opts?.donorsMode === "replace" && Boolean(existing) && !opts?.allowEmptyRosterWipe;
  if (kvOk && !skipKvReadForReplace) {
    const raw = await upstashGet(stateKey(userId));
    existing = coalesceAppStateRedisAndMemory(raw as AppState | null, mem);
  }

  let incoming = next;
  /**
   * 정산 리셋 등 의도적 비우기 — 백업 union 이 구 후원을 다시 넣지 않게.
   * replace(삭제·나누기)는 intentional shrink — 백업이 더 많으면 삭제분이 되살아남.
   */
  if (kvOk && !opts?.allowEmptyRosterWipe && opts?.donorsMode !== "replace") {
    try {
      const backup = await loadDonationRosterBackupFromKv(userId);
      incoming = unionAppStateDonorsFromBackupIfRicher(incoming, backup);
    } catch {
      /* noop */
    }
  }

  const wipeOpts = opts?.allowEmptyRosterWipe ? { allowEmptyRosterWipe: true } : undefined;
  const merged =
    opts?.donorsMode === "replace"
      ? mergeDonationReplaceForPersist(incoming, existing, wipeOpts)
      : mergeStatePreservingDonorsUntilSettlementReset(incoming, existing, wipeOpts);

  const persistedBeforeFinalize: AppState = clearIntentionalDonationClearIfHasDonations({
    ...merged,
    generalTimer: snapshotTimerForPersist(merged.generalTimer),
    matchTimer: snapshotTimerForPersist(merged.matchTimer ?? merged.generalTimer),
  });

  /**
   * 🔥 단순화 (P1): 사고성 덮어쓰기 방어 3분산 → 1 finalizePersisted 로 통합
   *  기존: ① blockEmpty(incoming 단계) → ② blockEmpty(persisted 단계) → ③ rosterGuard
   *  변경: merge 최종후 persisted에 1회만 적용 (조건 평가 중복 제거 · 코드 18줄 → 9줄)
   *  동시에 shouldBlock + hasMeaningfulRoster 의 donor/member iteration 2회 → 1회로
   */
  const persisted = finalizePersisted(existing, persistedBeforeFinalize, opts);

  setServerMemoryAppState(userId, persisted);
  /** 무효화 대신 최신 스냅샷으로 워밍 — 다음 admin fast=1 / OBS GET 이 MySQL 을 건너뜀 */
  seedAppStateKvCache(userId, persisted);
  if (!kvOk) {
    return { ok: true, state: persisted };
  }
  const wrote = await upstashSet(stateKey(userId), persisted);
  if (wrote) {
    /** Phase 1 dual-write — 3초 throttle + 2초 debounce 로 반복저장 집계해 최종 1회만 MySQL 반영 */
    scheduleBroadcastWrite(userId, persisted, opts);
  }
  return { ok: wrote, state: persisted };
}

/** 사고성 멤버/후원 덮어쓰기 방어 최종 1단계 + version counter propagation + 의도적 변경 bump
 *  1. blockEmpty fallback 브랜치에서도 기존 member/donors 필드를 재사용 → Math.max version 동시 전파
 *  2. 의도적 변경(opts bump): Math.max(existing, persisted) + 1 단조 증가
 */
function finalizePersisted(
  existing: AppState | null,
  persisted: AppState,
  opts?: SaveAppStateForRouletteOptions
): AppState {
  const baseRosterV = Math.max(
    Number(existing?.rosterVersion || 0),
    Number(persisted.rosterVersion || 0)
  );
  const baseDonorV = Math.max(
    Number(existing?.donorListVersion || 0),
    Number(persisted.donorListVersion || 0)
  );
  const nextRosterV = opts?.bumpRosterVersion ? baseRosterV + 1 : baseRosterV;
  const nextDonorV = opts?.bumpDonorListVersion ? baseDonorV + 1 : baseDonorV;
  const withVersions = (s: AppState): AppState => ({
    ...s,
    rosterVersion: nextRosterV > 0 ? nextRosterV : undefined,
    donorListVersion: nextDonorV > 0 ? nextDonorV : undefined,
  });

  if (opts?.allowEmptyRosterWipe || !existing) return withVersions(persisted);

  /** 1. 빈 로스터로 실 donors 덮지 않음 (기존 L209/L241 2중 → 1회) */
  if (shouldBlockAccidentalEmptyOverwrite(existing, persisted)) {
    return withVersions({
      ...persisted,
      members: existing.members,
      memberPositions: existing.memberPositions ?? persisted.memberPositions,
      donors: existing.donors,
      settlementResetAt: existing.settlementResetAt,
      donorRankingsUpdatedAt: Math.max(
        Number(existing.donorRankingsUpdatedAt || 0),
        Number(persisted.donorRankingsUpdatedAt || 0)
      ),
    });
  }

  /** 2. 실 멤버 로스터가 플레이스홀더로 바뀌지 않게 (기존 L255-L267 · 1번 조건과 상호 배타적) */
  if (hasMeaningfulMemberRoster(existing) && !hasMeaningfulMemberRoster(persisted)) {
    return withVersions({
      ...persisted,
      members: existing.members,
      memberPositions: existing.memberPositions ?? persisted.memberPositions,
    });
  }

  return withVersions(persisted);
}

async function dualWriteBroadcastDonations(
  userId: string,
  persisted: AppState,
  opts?: SaveAppStateForRouletteOptions
): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  try {
    const { syncBroadcastDonationsFromAppState } = await import(
      "@/lib/donation/broadcast-donations-mysql"
    );
    const { normalizeDonorsArray } = await import("@/lib/state");
    await syncBroadcastDonationsFromAppState(userId, normalizeDonorsArray(persisted.donors), {
      mode: opts?.donorsMode === "replace" ? "replace" : "add",
      allowEmptyRosterWipe: Boolean(opts?.allowEmptyRosterWipe),
      updatedAtMs: Number(persisted.updatedAt || Date.now()),
    });
  } catch {
    /* mysql 미등록·edge — no-op; 모듈 내부에서 이미 로그 */
  }
}
