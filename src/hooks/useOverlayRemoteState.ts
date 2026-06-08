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
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";

import {
  createStateUpdatedScheduler,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  readOverlayPollIntervalMs,
  readOverlaySseFallbackPollMs,
  shouldSyncDonorRankingsFromStateUpdatedEvent,
  shouldSyncObsTextFromStateUpdatedEvent,
  shouldSyncOverlayFromStateUpdatedEvent,
  shouldSyncSigSalesFromRouletteSseHint,
  sigSalesRouletteSyncCursorFromState,
  type SigSalesRouletteSyncCursor,
} from "@/lib/overlay-pull-policy";

import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";

import { useSSEConnection } from "@/lib/sse-client";

import {
  buildOverlaySyncSignature,
  buildSigSalesOverlaySyncSignature,
} from "@/lib/overlay-sync-signature";

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
  revisionForStatePick,
  STATE_PICK_OBS_TEXT,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
  STATE_PICK_SIG_SALES,
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

  /**
   * sig-sales pick 주기 폴링 시 `since`/304 사용(매 tick forceFull 생략).
   * 수동 OBS·다중 브라우저 소스 시 EC2 GET 폭주·502 완화.
   */
  sigSalesIncrementalPoll?: boolean;
};

function overlaySyncSignatureForPick(
  state: AppState,
  pick: StateApiPick
): string {
  if (pick === STATE_PICK_OBS_TEXT) {
    return obsTextRegistrySyncSignature(readObsTextRegistryFromState(state));
  }
  if (pick === STATE_PICK_SIG_SALES) {
    return buildSigSalesOverlaySyncSignature(state);
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

  /** obs-text pick 304 비교는 max(updatedAt, config.revision) — updatedAt 만 쓰면 영구 304 */
  const pickRev = revisionForStatePick(data, pick);
  if (pickRev > 0) {
    refs.lastSyncedUpdatedAtRef.current = Math.max(
      refs.lastSyncedUpdatedAtRef.current,
      pickRev
    );
  }

  if (pick !== STATE_PICK_OBS_TEXT) {
    const dr = readDonorRankingsRevision(data);
    if (dr > 0) {
      refs.lastSyncedDonorRevRef.current = Math.max(
        refs.lastSyncedDonorRevRef.current,
        dr
      );
    }
  }

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
): {
  state: AppState | null;
  ready: boolean;
  resync: (opts?: { forceFull?: boolean }) => Promise<void>;
} {
  const frozen = options.frozenState ?? null;

  const enabled = options.enabled !== false && frozen == null;

  const statePick = options.statePick ?? STATE_PICK_OVERLAY;

  const persistLastGood = options.persistLastGood !== false;

  const sigSalesPick = statePick === STATE_PICK_SIG_SALES;
  const sigSalesIncrementalPoll = Boolean(options.sigSalesIncrementalPoll);
  const obsTextPick = statePick === STATE_PICK_OBS_TEXT;

  const [state, setState] = useState<AppState | null>(frozen);

  const [syncedOnce, setSyncedOnce] = useState(Boolean(frozen));

  const lastSyncedUpdatedAtRef = useRef(0);

  const lastSyncedDonorRevRef = useRef(0);

  const lastVisualSigRef = useRef("");

  const lastRouletteSyncRef = useRef<SigSalesRouletteSyncCursor>({
    sessionId: "",
    phase: "",
  });

  const lastGoodRef = useRef<AppState | null>(null);

  const syncingRef = useRef(false);

  const syncFromApiRef = useRef<
    (opts?: { forceFull?: boolean }) => Promise<void>
  >(async () => {});

  const scheduleSseSyncRef = useRef<(() => void) | null>(null);

  const restoreFallback = useCallback(() => {
    const cached =
      lastGoodRef.current || loadOverlayLastGood(userId, statePick);

    if (!cached || !isOverlayStateViable(cached, statePick)) return;

    lastGoodRef.current = cached;

    lastVisualSigRef.current = overlaySyncSignatureForPick(cached, statePick);

    lastSyncedUpdatedAtRef.current = Math.max(
      lastSyncedUpdatedAtRef.current,
      revisionForStatePick(cached, statePick)
    );

    if (statePick !== STATE_PICK_OBS_TEXT) {
      lastSyncedDonorRevRef.current = Math.max(
        lastSyncedDonorRevRef.current,
        readDonorRankingsRevision(cached)
      );
    }

    if (statePick === STATE_PICK_SIG_SALES) {
      lastRouletteSyncRef.current = sigSalesRouletteSyncCursorFromState(
        cached.rouletteState
      );
    }

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
        const sinceBaseline =
          statePick === STATE_PICK_OBS_TEXT
            ? lastSyncedUpdatedAtRef.current
            : Math.max(
                lastSyncedUpdatedAtRef.current,
                lastSyncedDonorRevRef.current
              );

        /** 텍스트 OBS: 304로 구문이 안 바뀌는 현상 방지 — pick 본문은 항상 전체 수신 */
        const forceFull = Boolean(opts?.forceFull) || obsTextPick;

        const remote = await loadStateFromApi(userId, {
          ifUpdatedSince: forceFull ? 0 : sinceBaseline,
          forceFull,
          pick: statePick,
        });

        if (!remote) {
          /** 304 등 변경 없음 — 이미 동기화된 표시를 last-good으로 덮지 않음(OBS 텍스트가 사라지는 현상 방지) */
          if (lastSyncedUpdatedAtRef.current > 0) return;

          restoreFallback();

          return;
        }

        if (
          shouldKeepLastGoodInsteadOf(remote, statePick, lastGoodRef.current)
        ) {
          restoreFallback();

          return;
        }

        if (sigSalesPick) {
          lastRouletteSyncRef.current = sigSalesRouletteSyncCursorFromState(
            remote.rouletteState
          );
        }

        applySyncedState(remote, statePick, refs);
      } catch {
        restoreFallback();
      } finally {
        syncingRef.current = false;
        setSyncedOnce(true);
      }
    },

    [enabled, userId, statePick, persistLastGood, restoreFallback, sigSalesPick]
  );

  const { connected: sseConnected } = useSSEConnection((d: unknown) => {
    if (!enabled) return;

    const o = d as {
      type?: string;
      updatedAt?: number;
      donorRankingsUpdatedAt?: number;
      roulettePhase?: string;
      rouletteSessionId?: string;
    };

    if (o?.type !== "state_updated") return;

    if (obsTextPick) {
      if (
        shouldSyncObsTextFromStateUpdatedEvent(
          o as { updatedAt?: unknown; obsTextRevision?: unknown },
          lastSyncedUpdatedAtRef.current
        )
      ) {
        scheduleSseSyncRef.current?.();
        return;
      }
    }

    if (sigSalesPick) {
      const rouletteHint = shouldSyncSigSalesFromRouletteSseHint(
        o,
        lastRouletteSyncRef.current
      );
      if (rouletteHint) {
        const sid = String(
          o.rouletteSessionId || lastRouletteSyncRef.current.sessionId || ""
        ).trim();
        const phase = String(
          o.roulettePhase || lastRouletteSyncRef.current.phase || ""
        ).trim();
        if (sid) lastRouletteSyncRef.current = { sessionId: sid, phase };
        scheduleSseSyncRef.current?.();
        return;
      }
    }

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

      lastSyncedUpdatedAtRef.current = revisionForStatePick(local, statePick);

      if (statePick !== STATE_PICK_OBS_TEXT) {
        lastSyncedDonorRevRef.current = readDonorRankingsRevision(local);
      }

      lastGoodRef.current = local;

      if (persistLastGood) saveOverlayLastGood(local, userId, statePick);
    } else if (lastGood && isOverlayStateViable(lastGood, statePick)) {
      setState(lastGood);

      lastVisualSigRef.current = overlaySyncSignatureForPick(
        lastGood,
        statePick
      );

      lastSyncedUpdatedAtRef.current = revisionForStatePick(lastGood, statePick);

      if (statePick !== STATE_PICK_OBS_TEXT) {
        lastSyncedDonorRevRef.current = readDonorRankingsRevision(lastGood);
      }

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
      void syncFromApiRef.current(
        sigSalesPick || statePick === STATE_PICK_OBS_TEXT
          ? { forceFull: true }
          : undefined
      );
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

    let stopPoll: (() => void) | undefined;

    if (pollMs > 0) {
      const pollSourceKey = `${statePick}:${userId || "default"}:${typeof window !== "undefined" ? window.location.pathname : ""}:${typeof window !== "undefined" ? window.location.search : ""}`;
      stopPoll = startStaggeredOverlayPoll(
        () => {
          const pollOpts =
            obsTextPick || (sigSalesPick && !sigSalesIncrementalPoll)
              ? { forceFull: true as const }
              : undefined;
          void syncFromApiRef.current(pollOpts);
        },
        pollMs,
        pollSourceKey
      );
    }

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

    const onPageShow = (ev: PageTransitionEvent) => {
      if (!ev.persisted) return;
      lastSyncedUpdatedAtRef.current = 0;
      lastVisualSigRef.current = "";
      void syncFromApiRef.current({ forceFull: true });
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancel();

      scheduleSseSyncRef.current = null;

      stopPoll?.();

      if (sseFallbackId) window.clearInterval(sseFallbackId);

      if (storageDebounce) clearTimeout(storageDebounce);

      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
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

    sigSalesPick,
  ]);

  const resync = useCallback(
    (opts?: { forceFull?: boolean }) => syncFromApi(opts),
    [syncFromApi]
  );

  return {
    state: frozen ?? state,
    ready: Boolean(frozen) || syncedOnce,
    resync,
  };
}
