"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import {
  defaultState,
  loadState,
  loadStateFromApi,
  storageKey,
  type AppState,
} from "@/lib/state";

import { shouldSuppressOverlaySseConnection } from "@/lib/overlay-params";

import {
  createStateUpdatedScheduler,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  readOverlayPollIntervalMs,
  readOverlaySseFallbackPollMs,
  shouldSyncDonorRankingsFromStateUpdatedEvent,
  shouldSyncOverlayFromStateUpdatedEvent,
} from "@/lib/overlay-pull-policy";

import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";

import { useSSEConnection } from "@/lib/sse-client";

import { buildOverlaySyncSignature } from "@/lib/overlay-sync-signature";

import {
  obsTextRegistrySyncSignature,
  readObsTextRegistryFromState,
} from "@/lib/obs-text-overlay";

import {
  isOverlayStateViable,
  loadOverlayLastGood,
  saveOverlayLastGood,
  shouldKeepLastGoodInsteadOf,
} from "@/lib/overlay-last-good";

import type { StateApiPick } from "@/lib/state-api-pick";

import {
  STATE_PICK_OBS_TEXT,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
} from "@/lib/state-api-pick";

export type UseOverlayRemoteStateOptions = {
  /** false면 동기화 비활성 */

  enabled?: boolean;

  /** 기본 `overlay`. 후원 목록 필요 시 `overlay-donors` */

  statePick?: StateApiPick;

  /** 후원·기여도 반영용 짧은 폴링(ms). 미지정 시 env/0(기본 폴링 없음) */

  overlayPollMs?: number;

  /** 고정 스냅샷(시그 대전 미리보기 등) — 설정 시 폴링·SSE 생략 */

  frozenState?: AppState | null;

  /** 로컬 스냅샷 없을 때 lastUpdated 초기값 — `default`면 defaultState().updatedAt */

  noLocalBaseline?: "zero" | "default";

  /** storage 이벤트 후 API 동기화 지연(ms). 0이면 즉시 */

  storageDebounceMs?: number;

  /** true면 관리자 storageKey 스냅샷은 쓰지 않음(OBS 전용). last-good 캐시는 사용 */

  skipLocalSnapshot?: boolean;

  /** 마운트 시 since 무시·전체 pick 본문 1회 수신 */

  forceInitialFull?: boolean;

  /** 서버 끊김 시 localStorage last-good (기본 true) */

  persistLastGood?: boolean;
};

function overlaySyncSignatureForPick(
  state: AppState,
  pick: StateApiPick
): string {
  if (pick === STATE_PICK_OBS_TEXT) {
    return obsTextRegistrySyncSignature(readObsTextRegistryFromState(state));
  }

  return buildOverlaySyncSignature(state);
}

function readLocalStateIfExists(userId?: string): AppState | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(storageKey(userId));

    if (!raw) return null;

    return loadState(userId ?? undefined);
  } catch {
    return null;
  }
}

function applySyncedState(
  data: AppState,

  pick: StateApiPick,

  refs: {
    lastVisualSigRef: MutableRefObject<string>;

    lastSyncedUpdatedAtRef: MutableRefObject<number>;

    lastSyncedDonorRevRef: MutableRefObject<number>;

    lastGoodRef: MutableRefObject<AppState | null>;

    persistLastGood: boolean;

    userId?: string;

    setState: Dispatch<SetStateAction<AppState | null>>;
  }
): boolean {
  const nextSig = overlaySyncSignatureForPick(data, pick);

  const ts = data.updatedAt || 0;

  if (ts > 0) {
    refs.lastSyncedUpdatedAtRef.current = Math.max(
      refs.lastSyncedUpdatedAtRef.current,
      ts
    );
  }

  const dr = readDonorRankingsRevision(data);

  if (dr > 0)
    refs.lastSyncedDonorRevRef.current = Math.max(
      refs.lastSyncedDonorRevRef.current,
      dr
    );

  if (nextSig === refs.lastVisualSigRef.current) return false;

  refs.lastVisualSigRef.current = nextSig;

  refs.setState(data);

  if (refs.persistLastGood && isOverlayStateViable(data, pick)) {
    refs.lastGoodRef.current = data;

    saveOverlayLastGood(data, refs.userId, pick);
  }

  return true;
}

/**

 * OBS·방송 오버레이 공통: SSE 변동 시만 GET, `since`+304, SSE 끊김 시 last-good 유지.

 */

export function useOverlayRemoteState(
  userId?: string,

  options: UseOverlayRemoteStateOptions = {}
): { state: AppState | null; ready: boolean } {
  const frozen = options.frozenState ?? null;

  const enabled = options.enabled !== false && frozen == null;

  const statePick = options.statePick ?? STATE_PICK_OVERLAY;

  const persistLastGood = options.persistLastGood !== false;

  const [state, setState] = useState<AppState | null>(frozen);

  const lastSyncedUpdatedAtRef = useRef(0);

  const lastSyncedDonorRevRef = useRef(0);

  const lastVisualSigRef = useRef("");

  const lastGoodRef = useRef<AppState | null>(null);

  const syncingRef = useRef(false);

  const syncFromApiRef = useRef<() => Promise<void>>(async () => {});

  const scheduleSseSyncRef = useRef<(() => void) | null>(null);

  const restoreFallback = useCallback(() => {
    const cached =
      lastGoodRef.current || loadOverlayLastGood(userId, statePick);

    if (!cached || !isOverlayStateViable(cached, statePick)) return;

    lastGoodRef.current = cached;

    lastVisualSigRef.current = overlaySyncSignatureForPick(cached, statePick);

    lastSyncedUpdatedAtRef.current = Math.max(
      lastSyncedUpdatedAtRef.current,

      cached.updatedAt || 0
    );

    lastSyncedDonorRevRef.current = Math.max(
      lastSyncedDonorRevRef.current,

      readDonorRankingsRevision(cached)
    );

    setState(cached);
  }, [userId, statePick]);

  const syncFromApi = useCallback(
    async (opts?: { forceFull?: boolean }) => {
      if (!enabled || syncingRef.current) return;

      syncingRef.current = true;

      const refs = {
        lastVisualSigRef,

        lastSyncedUpdatedAtRef,

        lastSyncedDonorRevRef,

        lastGoodRef,

        persistLastGood,

        userId,

        setState,
      };

      try {
        const sinceBaseline = Math.max(
          lastSyncedUpdatedAtRef.current,

          lastSyncedDonorRevRef.current
        );

        const remote = await loadStateFromApi(userId, {
          ifUpdatedSince: opts?.forceFull ? 0 : sinceBaseline,

          forceFull: opts?.forceFull,

          pick: statePick,
        });

        if (!remote) {
          restoreFallback();

          return;
        }

        if (
          shouldKeepLastGoodInsteadOf(remote, statePick, lastGoodRef.current)
        ) {
          restoreFallback();

          return;
        }

        applySyncedState(remote, statePick, refs);
      } catch {
        restoreFallback();
      } finally {
        syncingRef.current = false;
      }
    },

    [enabled, userId, statePick, persistLastGood, restoreFallback]
  );

  const { connected: sseConnected } = useSSEConnection((d: unknown) => {
    if (!enabled) return;

    const o = d as {
      type?: string;
      updatedAt?: number;
      donorRankingsUpdatedAt?: number;
    };

    if (o?.type !== "state_updated") return;

    const donorRev = Number(o.donorRankingsUpdatedAt);

    if (Number.isFinite(donorRev) && donorRev > 0) {
      if (
        shouldSyncDonorRankingsFromStateUpdatedEvent(
          o,
          lastSyncedDonorRevRef.current
        )
      ) {
        scheduleSseSyncRef.current?.();

        return;
      }
    }

    if (
      !shouldSyncOverlayFromStateUpdatedEvent(
        o.updatedAt,
        lastSyncedUpdatedAtRef.current
      )
    )
      return;

    scheduleSseSyncRef.current?.();
  });

  useEffect(() => {
    if (frozen) {
      setState(frozen);

      return;
    }

    if (!enabled) return;

    const skipLocal = options.skipLocalSnapshot === true;

    const local = skipLocal ? null : readLocalStateIfExists(userId);

    const lastGood = persistLastGood
      ? loadOverlayLastGood(userId, statePick)
      : null;

    if (local && isOverlayStateViable(local, statePick)) {
      setState(local);

      lastVisualSigRef.current = overlaySyncSignatureForPick(local, statePick);

      lastSyncedUpdatedAtRef.current = local.updatedAt || 0;

      lastSyncedDonorRevRef.current = readDonorRankingsRevision(local);

      lastGoodRef.current = local;

      if (persistLastGood) saveOverlayLastGood(local, userId, statePick);
    } else if (lastGood && isOverlayStateViable(lastGood, statePick)) {
      setState(lastGood);

      lastVisualSigRef.current = overlaySyncSignatureForPick(
        lastGood,
        statePick
      );

      lastSyncedUpdatedAtRef.current = lastGood.updatedAt || 0;

      lastSyncedDonorRevRef.current = readDonorRankingsRevision(lastGood);

      lastGoodRef.current = lastGood;
    } else {
      const base = defaultState();

      setState(base);

      lastVisualSigRef.current = overlaySyncSignatureForPick(base, statePick);

      lastSyncedUpdatedAtRef.current = skipLocal
        ? 0
        : options.noLocalBaseline === "default"
        ? base.updatedAt || 0
        : 0;
    }

    syncFromApiRef.current = syncFromApi;

    const debounceOpts =
      statePick === STATE_PICK_OVERLAY_DONORS
        ? {
            debounceMs: DONOR_STATE_UPDATED_DEBOUNCE_MS,
            maxWaitMs: DONOR_STATE_UPDATED_MAX_WAIT_MS,
          }
        : undefined;

    const { schedule, cancel } = createStateUpdatedScheduler(() => {
      void syncFromApiRef.current();
    }, debounceOpts);

    scheduleSseSyncRef.current = schedule;

    const runInitialSync = () => {
      if (shouldSuppressOverlaySseConnection()) {
        if (!local && !skipLocal) void syncFromApi();
        else
          void syncFromApi({
            forceFull: options.forceInitialFull || skipLocal,
          });

        return;
      }

      void syncFromApi({ forceFull: options.forceInitialFull || skipLocal });
    };

    runInitialSync();

    const pollMs =
      options.overlayPollMs != null && options.overlayPollMs >= 0
        ? options.overlayPollMs
        : readOverlayPollIntervalMs();

    let pollId: number | undefined;

    if (pollMs > 0)
      pollId = window.setInterval(() => void syncFromApi(), pollMs);

    const sseFallbackMs = pollMs > 0 ? 0 : readOverlaySseFallbackPollMs();

    let sseFallbackId: number | undefined;

    if (sseFallbackMs > 0 && !sseConnected) {
      sseFallbackId = window.setInterval(
        () => void syncFromApi(),
        sseFallbackMs
      );
    }

    const storageDebounceMs = options.storageDebounceMs ?? 400;

    let storageDebounce: ReturnType<typeof setTimeout> | null = null;

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;

      if (shouldSuppressOverlaySseConnection()) {
        try {
          const localNow = readLocalStateIfExists(userId);

          if (!localNow) return;

          const u = localNow.updatedAt || 0;

          if (
            lastSyncedUpdatedAtRef.current <= 0 ||
            u >= lastSyncedUpdatedAtRef.current
          ) {
            if (
              !shouldKeepLastGoodInsteadOf(
                localNow,
                statePick,
                lastGoodRef.current
              )
            ) {
              applySyncedState(localNow, statePick, {
                lastVisualSigRef,

                lastSyncedUpdatedAtRef,

                lastSyncedDonorRevRef,

                lastGoodRef,

                persistLastGood,

                userId,

                setState,
              });
            }
          }
        } catch {
          /* noop */
        }

        return;
      }

      const trigger = () => {
        void syncFromApi();
      };

      if (storageDebounceMs <= 0) {
        trigger();

        return;
      }

      if (storageDebounce) clearTimeout(storageDebounce);

      storageDebounce = setTimeout(() => {
        storageDebounce = null;

        trigger();
      }, storageDebounceMs);
    };

    window.addEventListener("storage", onStorage);

    return () => {
      cancel();

      scheduleSseSyncRef.current = null;

      if (pollId) window.clearInterval(pollId);

      if (sseFallbackId) window.clearInterval(sseFallbackId);

      if (storageDebounce) clearTimeout(storageDebounce);

      window.removeEventListener("storage", onStorage);
    };
  }, [
    enabled,

    frozen,

    userId,

    syncFromApi,

    sseConnected,

    persistLastGood,

    options.noLocalBaseline,

    options.storageDebounceMs,

    options.skipLocalSnapshot,

    options.forceInitialFull,

    options.overlayPollMs,

    statePick,
  ]);

  return { state: frozen ?? state, ready: (frozen ?? state) !== null };
}
