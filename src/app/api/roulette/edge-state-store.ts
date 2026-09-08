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

const EDGE_STATE_GLOBAL_KEY = "__YOUTUBE_HARMONY_ROULETTE_EDGE_STATE_STORE_V1__";

type EdgeStateGlobalStore = {
  broadcastLastRunAt: Map<string, number>;
  broadcastPending: Map<
    string,
    {
      timer: ReturnType<typeof setTimeout> | null;
      payload: { persisted: AppState; opts?: SaveAppStateForRouletteOptions; scheduledAt: number } | null;
    }
  >;
  /** Fix⑲-3: 고부하 burst 감지 — userId별 고부하 모드 만료 시각(ms) · 해당 시간 전까지는 동적 Throttle 단축 적용 */
  burstHighLoadUntilAt: Map<string, number>;
  /** Fix⑲-3: 최종 donors 수 snapshot — 직전 save 대비 증가폭으로 burst 자동 감지 */
  lastSeenDonorCount: Map<string, number>;
};

function getEdgeStateGlobalStore(): EdgeStateGlobalStore {
  const g = globalThis as unknown as Record<string, EdgeStateGlobalStore | undefined>;
  if (!g[EDGE_STATE_GLOBAL_KEY]) {
    g[EDGE_STATE_GLOBAL_KEY] = {
      broadcastLastRunAt: new Map<string, number>(),
      broadcastPending: new Map(),
      burstHighLoadUntilAt: new Map<string, number>(),
      lastSeenDonorCount: new Map<string, number>(),
    };
  }
  const store = g[EDGE_STATE_GLOBAL_KEY]!;
  if (!store.burstHighLoadUntilAt) store.burstHighLoadUntilAt = new Map();
  if (!store.lastSeenDonorCount) store.lastSeenDonorCount = new Map();
  return store;
}

const broadcastLastRunAt: Map<string, number> = getEdgeStateGlobalStore().broadcastLastRunAt;
const broadcastPending: Map<
  string,
  {
    timer: ReturnType<typeof setTimeout> | null;
    payload: { persisted: AppState; opts?: SaveAppStateForRouletteOptions; scheduledAt: number } | null;
  }
> = getEdgeStateGlobalStore().broadcastPending;
const burstHighLoadUntilAt: Map<string, number> = getEdgeStateGlobalStore().burstHighLoadUntilAt;
const lastSeenDonorCount: Map<string, number> = getEdgeStateGlobalStore().lastSeenDonorCount;

function serializedSaveAppStateForRoulette(
  userId: string,
  next: AppState,
  opts: SaveAppStateForRouletteOptions | undefined,
  exec: () => Promise<{ ok: boolean; state: AppState }>
): Promise<{ ok: boolean; state: AppState }> {
  return exec();
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

  const currentDonorCount = Array.isArray(persisted.donors) ? persisted.donors.length : 0;
  const prevCount = lastSeenDonorCount.get(userId) ?? 0;
  const donorDelta = Math.max(0, currentDonorCount - prevCount);
  const optsAggCount = Number((opts as unknown as { _aggregatedCountHint?: number })?._aggregatedCountHint || 0);
  const burstSize = Math.max(donorDelta, optsAggCount);

  if (burstSize >= 3) {
    const extendedUntil = now + 15_000;
    const curUntil = burstHighLoadUntilAt.get(userId) ?? 0;
    if (extendedUntil > curUntil) burstHighLoadUntilAt.set(userId, extendedUntil);
  }
  lastSeenDonorCount.set(userId, currentDonorCount);

  const highLoadUntil = burstHighLoadUntilAt.get(userId) ?? 0;
  const isHighLoad = highLoadUntil > now;
  const throttleMs = isHighLoad ? 500 : BROADCAST_WRITE_THROTTLE_MS;
  const debounceMs = isHighLoad ? 300 : BROADCAST_WRITE_DEBOUNCE_MS;
  const capMs = isHighLoad ? 1_500 : 5_000;

  const lastRun = broadcastLastRunAt.get(userId) || 0;
  entry.payload = { persisted, opts, scheduledAt: now };

  const gap = now - lastRun;
  const waitMs = gap >= throttleMs ? debounceMs : throttleMs - gap + debounceMs;

  entry.timer = setTimeout(() => {
    const live = broadcastPending.get(userId);
    const payload = live?.payload;
    if (live) {
      live.timer = null;
      live.payload = null;
    }
    broadcastLastRunAt.set(userId, Date.now());
    if (payload) void dualWriteBroadcastDonations(userId, payload.persisted, payload.opts).catch(() => {});
  }, Math.max(0, Math.min(waitMs, capMs)));

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
  /**
   * Fix ⑱ FINAL: state-patch.usecase.ts 바깥에서 이미 Per-User Mutex R-M-W로
   * base READ → donor merge/dedupe → Shrink Guard 전부 정확히 완료한 next state를
   * 전달받는 경우 true 로 설정. save pipeline 내부에서 절대로 KV/Memory를 재 READ
   * 해서 기존 state 와 union merge 하지 않고 incoming=next 를 그대로 최종 persisted 로
   * WRITE ONLY 함. cold start memWarm=false case 에서 구 버전 KV READ + existing
   * merge 로 incoming 50 donors 가 1건으로 덮어씌워지는 Lost Update 49건 Bug 방지.
   */
  skipOuterRead?: boolean;
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
   * Fix ⑱ FINAL: skipOuterRead=true 일 때는 state-patch 바깥에서 이미 정확히
   * R-M-W merge 완료한 next state 가 전달되므로, save pipeline 내부에서 절대로
   * 기존 state (Memory/KV/backup) 를 재 READ 하거나 union merge 해서는 안됨.
   * cold start memWarm=false case 에서 구 버전 KV READ + existing merge 로
   * incoming 50 donors 가 1건으로 덮어씌워지는 Lost Update 49건 Bug 를 방지하기
   * 위해, skipOuterRead=true 면 incoming=next existing=null 로 고정하고
   * 모든 READ / merge 로직을 완전히 bypass 한다.
   */
  const forceSkip = Boolean(opts?.skipOuterRead);

  const mem = forceSkip ? null : getServerMemoryAppState(userId);
  const memWarm = forceSkip ? false : Boolean(mem && Array.isArray((mem as AppState).members));
  let existing: AppState | null = forceSkip ? null : (memWarm ? (mem as AppState) : null);
  const kvOk = isPersistentKvConfigured();
  /**
   * Fix ⑱ FINAL: skipOuterRead=true 일 때 KV READ 완전 스킵.
   * forceSkip=false 이면 기존 rule (cold start 일 때만 KV READ fallback) 유지.
   */
  if (!forceSkip && kvOk && !memWarm) {
    const raw = await upstashGet(stateKey(userId));
    existing = coalesceAppStateRedisAndMemory(raw as AppState | null, mem as AppState | null);
  }

  let incoming = next;
  /**
   * Fix ⑱ FINAL: skipOuterRead=true 일 때 backup union 완전 스킵.
   * forceSkip=false 이면 기존 cold start fallback backup union rule 유지.
   */
  if (
    !forceSkip &&
    kvOk &&
    !memWarm &&
    !opts?.allowEmptyRosterWipe &&
    opts?.donorsMode !== "replace"
  ) {
    try {
      const backup = await loadDonationRosterBackupFromKv(userId);
      incoming = unionAppStateDonorsFromBackupIfRicher(incoming, backup);
    } catch {
      /* noop */
    }
  }

  const wipeOpts = opts?.allowEmptyRosterWipe ? { allowEmptyRosterWipe: true } : undefined;
  /**
   * Fix ⑱ FINAL: skipOuterRead=true 일 때 mergeStatePreservingDonors /
   * mergeDonationReplace existing merge 완전 스킵하고 merged = incoming (next) 를
   * 그대로 사용. forceSkip=false 이면 기존 merge rule 유지.
   */
  const merged: AppState = forceSkip
    ? incoming
    : opts?.donorsMode === "replace"
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
