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
  hasCustomTimerDisplayStyles,
  isDefaultLikeTimerDisplayStyle,
  loadState,
  loadStateFromApi,
  mergeLocalMemberIdentityOntoRemote,
  shouldAvoidOverwritingLocalStateWithRemote,
  storageKey,
  type AppState,
} from "@/lib/state";

import { shouldSuppressOverlaySseConnection, isExternalOverlayBroadcastHost } from "@/lib/overlay-params";
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";

import {
  createStateUpdatedScheduler,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  readOverlaySseFallbackPollMs,
  resolveOverlayRemotePollMs,
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
  shouldRejectPoorerDonationRemote,
} from "@/lib/overlay-sync-signature";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { mergeDonationApplyBase } from "@/lib/donation/merge-donation-apply-base";

import {
  hasObsTextRegistryInState,
  obsTextRegistrySyncSignature,
  readObsTextRegistryFromState,
} from "@/lib/obs-text-overlay";

import {
  isOverlayStateViable,
  loadOverlayLastGood,
  saveOverlayLastGood,
  shouldKeepLastGoodInsteadOf,
} from "@/lib/overlay-last-good";

import {
  overlayUserIdsMatch,
  readLocalBroadcastState,
  subscribeBroadcastStateLocalUpdated,
} from "@/lib/broadcast-state-local-sync";

import {
  revisionForStatePick,
  STATE_PICK_OBS_TEXT,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
  STATE_PICK_SIG_SALES,
  type StateApiPick,
} from "@/lib/state-api-pick";
import { mergeGeneralTimerPreferEffective } from "@/lib/timer-utils";

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

function bootstrapOverlayCache(
  userId: string | undefined,
  statePick: StateApiPick,
  skipLocalSnapshot: boolean,
  persistLastGood: boolean
): AppState | null {
  if (!skipLocalSnapshot) {
    const local = readLocalStateIfExists(userId);
    if (local && isOverlayStateViable(local, statePick)) return local;
  }
  if (persistLastGood) {
    const lastGood = loadOverlayLastGood(userId, statePick);
    if (lastGood && isOverlayStateViable(lastGood, statePick)) return lastGood;
  }
  return null;
}

function seedOverlaySyncRefs(
  data: AppState,
  statePick: StateApiPick,
  refs: {
    lastGoodRef: MutableRefObject<AppState | null>;
    lastVisualSigRef: MutableRefObject<string>;
    lastSyncedUpdatedAtRef: MutableRefObject<number>;
    lastSyncedDonorRevRef: MutableRefObject<number>;
  }
): void {
  refs.lastGoodRef.current = data;
  refs.lastVisualSigRef.current = overlaySyncSignatureForPick(data, statePick);
  refs.lastSyncedUpdatedAtRef.current = revisionForStatePick(data, statePick);
  if (statePick !== STATE_PICK_OBS_TEXT) {
    refs.lastSyncedDonorRevRef.current = readDonorRankingsRevision(data);
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
  /** 엑셀은 members 합계 — donors 기준 보정 후 서명 비교 (순위만 되고 표만 0인 경우 방지) */
  const dataForApply =
    (pick === STATE_PICK_OVERLAY || pick === STATE_PICK_OVERLAY_DONORS) &&
    Array.isArray(data.donors) &&
    data.donors.length > 0
      ? syncMemberTotalsFromDonors(data)
      : data;

  const nextSig = overlaySyncSignatureForPick(dataForApply, pick);

  /** obs-text pick 304 비교는 max(updatedAt, config.revision) — updatedAt 만 쓰면 영구 304 */
  const pickRev = revisionForStatePick(dataForApply, pick);

  if (
    pick === STATE_PICK_OBS_TEXT &&
    pickRev > 0 &&
    refs.lastSyncedUpdatedAtRef.current > 0 &&
    pickRev < refs.lastSyncedUpdatedAtRef.current
  ) {
    return false;
  }

  if (pick !== STATE_PICK_OBS_TEXT) {
    const dr = readDonorRankingsRevision(dataForApply);
    if (dr > 0) {
      refs.lastSyncedDonorRevRef.current = Math.max(
        refs.lastSyncedDonorRevRef.current,
        dr
      );
    }
  }

  if (nextSig === refs.lastVisualSigRef.current) {
    if (pickRev > 0) {
      refs.lastSyncedUpdatedAtRef.current = Math.max(
        refs.lastSyncedUpdatedAtRef.current,
        pickRev
      );
    }
    return false;
  }

  refs.lastVisualSigRef.current = nextSig;

  if (pickRev > 0) {
    refs.lastSyncedUpdatedAtRef.current = Math.max(
      refs.lastSyncedUpdatedAtRef.current,
      pickRev
    );
  }

  const mergedTimer = mergeGeneralTimerPreferEffective(
    refs.lastGoodRef.current?.generalTimer,
    dataForApply.generalTimer
  );
  /** pick 에 timerDisplayStyles 키가 없을 때만 last-good 로 보정.
   * 키가 있어도 기본(빈 색)이면 last-good 커스텀을 유지 — 첫 페인트 기본색→재설정 회귀 방지 */
  const lastTimerStyles = refs.lastGoodRef.current?.timerDisplayStyles;
  const incomingTimerStyles = dataForApply.timerDisplayStyles;
  const hasIncomingTimerKey = Object.prototype.hasOwnProperty.call(dataForApply, "timerDisplayStyles");
  const preferLastTimer =
    hasCustomTimerDisplayStyles(lastTimerStyles) &&
    (!hasIncomingTimerKey || isDefaultLikeTimerDisplayStyle(incomingTimerStyles?.general));
  const next = {
    ...dataForApply,
    generalTimer: mergedTimer,
    ...(preferLastTimer && lastTimerStyles
      ? { timerDisplayStyles: lastTimerStyles }
      : hasIncomingTimerKey
        ? {}
        : lastTimerStyles
          ? { timerDisplayStyles: lastTimerStyles }
          : {}),
  };

  refs.setState(next);

  if (refs.persistLastGood && isOverlayStateViable(next, pick)) {
    refs.lastGoodRef.current = next;

    saveOverlayLastGood(next, refs.userId, pick);
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

  const [state, setState] = useState<AppState | null>(() => {
    if (frozen != null) return frozen;
    if (typeof window === "undefined") return null;
    const pick = options.statePick ?? STATE_PICK_OVERLAY;
    return bootstrapOverlayCache(
      userId,
      pick,
      options.skipLocalSnapshot === true,
      options.persistLastGood !== false
    );
  });

  const [syncedOnce, setSyncedOnce] = useState(() => Boolean(frozen) || state != null);

  const lastSyncedUpdatedAtRef = useRef(0);

  const lastSyncedDonorRevRef = useRef(0);

  const lastVisualSigRef = useRef("");

  const lastRouletteSyncRef = useRef<SigSalesRouletteSyncCursor>({
    sessionId: "",
    phase: "",
  });

  const lastGoodRef = useRef<AppState | null>(null);

  const syncingRef = useRef(false);
  /** donationApplied SSE가 in-flight GET과 겹치면 완료 후 강제 재동기화 */
  const pendingForceSyncRef = useRef(false);

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
      if (!enabled) return;
      if (syncingRef.current) {
        if (opts?.forceFull) pendingForceSyncRef.current = true;
        return;
      }

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

        /** 텍스트 OBS: 최초·명시 forceFull 만 전체. 이후는 since(config.revision)로 304 허용 */
        const forceFull =
          Boolean(opts?.forceFull) ||
          (obsTextPick && lastSyncedUpdatedAtRef.current <= 0);

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

        let remoteForApply = remote;
        if (
          (statePick === STATE_PICK_OVERLAY || statePick === STATE_PICK_OVERLAY_DONORS) &&
          lastGoodRef.current
        ) {
          const localReset = Number(lastGoodRef.current.settlementResetAt || 0);
          const remoteReset = Number(remote.settlementResetAt || 0);
          if (remoteReset <= localReset) {
            const localDonors = Array.isArray(lastGoodRef.current.donors)
              ? lastGoodRef.current.donors
              : [];
            const remoteDonors = Array.isArray(remote.donors) ? remote.donors : [];
            const localIds = new Set(localDonors.map((d) => String(d.id || "")).filter(Boolean));
            const remoteIds = new Set(remoteDonors.map((d) => String(d.id || "")).filter(Boolean));
            const hasLocalOnly = localDonors.some((d) => {
              const id = String(d.id || "");
              return Boolean(id) && !remoteIds.has(id);
            });
            const hasRemoteOnly = remoteDonors.some((d) => {
              const id = String(d.id || "");
              return Boolean(id) && !localIds.has(id);
            });
            if (hasLocalOnly && hasRemoteOnly) {
              remoteForApply = mergeDonationApplyBase(remote, lastGoodRef.current) ?? remote;
            }
          }
        }

        if (
          (statePick === STATE_PICK_OVERLAY || statePick === STATE_PICK_OVERLAY_DONORS) &&
          shouldRejectPoorerDonationRemote(lastGoodRef.current, remoteForApply)
        ) {
          /** forceFull 이어도 빈/구 Redis 로 엑셀 금액을 지우지 않음 */
          return;
        }
        if (
          (statePick === STATE_PICK_OVERLAY || statePick === STATE_PICK_OVERLAY_DONORS) &&
          shouldAvoidOverwritingLocalStateWithRemote(lastGoodRef.current, remoteForApply)
        ) {
          return;
        }

        if (
          (statePick === STATE_PICK_OVERLAY || statePick === STATE_PICK_OVERLAY_DONORS) &&
          lastGoodRef.current
        ) {
          remoteForApply = mergeLocalMemberIdentityOntoRemote(
            remoteForApply,
            lastGoodRef.current
          );
        }

        if (sigSalesPick) {
          lastRouletteSyncRef.current = sigSalesRouletteSyncCursorFromState(
            remoteForApply.rouletteState
          );
        }

        applySyncedState(remoteForApply, statePick, refs);
      } catch {
        restoreFallback();
      } finally {
        syncingRef.current = false;
        setSyncedOnce(true);
        if (pendingForceSyncRef.current) {
          pendingForceSyncRef.current = false;
          void syncFromApi({ forceFull: true });
        }
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
      donationApplied?: unknown;
    };

    if (o?.type !== "state_updated") return;

    if (o.donationApplied) {
      void syncFromApiRef.current({ forceFull: true });
      return;
    }

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
        if (statePick === STATE_PICK_OVERLAY || statePick === STATE_PICK_OVERLAY_DONORS) {
          void syncFromApiRef.current({ forceFull: true });
          return;
        }
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
    const bootstrap = bootstrapOverlayCache(
      userId,
      statePick,
      skipLocal,
      persistLastGood
    );

    lastSyncedDonorRevRef.current = 0;

    const syncRefs = {
      lastGoodRef,
      lastVisualSigRef,
      lastSyncedUpdatedAtRef,
      lastSyncedDonorRevRef,
    };

    if (bootstrap) {
      const nextSig = overlaySyncSignatureForPick(bootstrap, statePick);
      const sameAsCurrent =
        obsTextPick &&
        nextSig === lastVisualSigRef.current &&
        lastVisualSigRef.current !== "";
      seedOverlaySyncRefs(bootstrap, statePick, syncRefs);
      if (!sameAsCurrent) {
        setState(bootstrap);
      }
      setSyncedOnce(true);
    } else if (obsTextPick) {
      /** OBS 텍스트: effect 재실행 시 null로 지우지 않음(깜빡임 방지) */
      let keepReady = false;
      setState((prev) => {
        if (prev && hasObsTextRegistryInState(prev)) {
          seedOverlaySyncRefs(prev, statePick, syncRefs);
          keepReady = true;
          return prev;
        }
        lastGoodRef.current = null;
        lastVisualSigRef.current = "";
        lastSyncedUpdatedAtRef.current = 0;
        return null;
      });
      setSyncedOnce(keepReady);
    } else {
      lastGoodRef.current = null;
      lastVisualSigRef.current = "";
      lastSyncedUpdatedAtRef.current = 0;
      setState(null);
      setSyncedOnce(false);
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
        sigSalesPick && !sigSalesIncrementalPoll ? { forceFull: true } : undefined
      );
    }, debounceOpts);

    scheduleSseSyncRef.current = schedule;

    const runInitialSync = () => {
      if (shouldSuppressOverlaySseConnection()) {
        if (!bootstrap && !skipLocal) void syncFromApi();
        else
          void syncFromApi({
            forceFull: options.forceInitialFull || skipLocal,
          });

        return;
      }

      void syncFromApi({ forceFull: options.forceInitialFull || skipLocal });
    };

    runInitialSync();

    const pollMs = resolveOverlayRemotePollMs(options.overlayPollMs);

    let stopPoll: (() => void) | undefined;

    if (pollMs > 0) {
      const pollSourceKey = `${statePick}:${userId || "default"}:${typeof window !== "undefined" ? window.location.pathname : ""}:${typeof window !== "undefined" ? window.location.search : ""}`;
      const obsForceFullPoll =
        shouldSuppressOverlaySseConnection() || isExternalOverlayBroadcastHost();
      stopPoll = startStaggeredOverlayPoll(
        () => {
          const pollOpts =
            sigSalesPick && !sigSalesIncrementalPoll
              ? { forceFull: true as const }
              : obsForceFullPoll &&
                  (statePick === STATE_PICK_OVERLAY || statePick === STATE_PICK_OVERLAY_DONORS)
                ? { forceFull: true as const }
                : undefined;
          void syncFromApiRef.current(pollOpts);
        },
        pollMs,
        pollSourceKey
      );
    }

    const sseFallbackMs = pollMs > 0 ? 0 : readOverlaySseFallbackPollMs();

    const storageDebounceMs = options.storageDebounceMs ?? 0;

    let storageDebounce: ReturnType<typeof setTimeout> | null = null;

    const applyLocalBroadcastState = () => {
      const localNow = readLocalBroadcastState(userId);
      if (!localNow) return;
      const pickRev = revisionForStatePick(localNow, statePick);
      if (
        lastSyncedUpdatedAtRef.current > 0 &&
        pickRev > 0 &&
        pickRev < lastSyncedUpdatedAtRef.current
      ) {
        return;
      }
      if (shouldKeepLastGoodInsteadOf(localNow, statePick, lastGoodRef.current)) return;
      applySyncedState(localNow, statePick, {
        lastVisualSigRef,
        lastSyncedUpdatedAtRef,
        lastSyncedDonorRevRef,
        lastGoodRef,
        persistLastGood,
        userId,
        setState,
      });
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;

      if (shouldSuppressOverlaySseConnection()) {
        try {
          applyLocalBroadcastState();
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

    const unsubscribeLocal = subscribeBroadcastStateLocalUpdated((detail) => {
      if (!overlayUserIdsMatch(userId, detail.userId)) return;
      applyLocalBroadcastState();
    });

    const onPageShow = (ev: PageTransitionEvent) => {
      if (!ev.persisted) return;
      void syncFromApiRef.current({ forceFull: true });
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancel();

      scheduleSseSyncRef.current = null;

      stopPoll?.();

      if (storageDebounce) clearTimeout(storageDebounce);

      window.removeEventListener("storage", onStorage);
      unsubscribeLocal();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [
    enabled,

    frozen,

    userId,

    syncFromApi,

    persistLastGood,

    options.noLocalBaseline,

    options.storageDebounceMs,

    options.skipLocalSnapshot,

    options.forceInitialFull,

    options.overlayPollMs,

    statePick,

    sigSalesPick,
  ]);

  /** SSE 끊김 시 폴링 — 메인 effect deps 와 분리(SSE 재연결마다 전체 재초기화 방지) */
  useEffect(() => {
    if (!enabled || frozen) return;
    const pollMs = resolveOverlayRemotePollMs(options.overlayPollMs);
    const sseFallbackMs = pollMs > 0 ? 0 : readOverlaySseFallbackPollMs();
    if (sseFallbackMs <= 0 || sseConnected) return;
    const id = window.setInterval(() => void syncFromApiRef.current(), sseFallbackMs);
    return () => window.clearInterval(id);
  }, [enabled, frozen, sseConnected, options.overlayPollMs]);

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
