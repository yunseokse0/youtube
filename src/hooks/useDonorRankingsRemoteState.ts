"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultState,
  loadState,
  loadStateFromApi,
  normalizeDonorsArray,
  storageKey,
  isDefaultLikeDonorRankingsTheme,
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  type AppState,
} from "@/lib/state";
import { STATE_PICK_DONOR_RANKINGS } from "@/lib/state-api-pick";
import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";
import {
  createStateUpdatedScheduler,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  readDonationListsOverlayPollMs,
  readOverlaySseFallbackPollMs,
  shouldSyncDonorRankingsFromStateUpdatedEvent,
} from "@/lib/overlay-pull-policy";
import { useSSEConnection } from "@/lib/sse-client";
import { shouldRejectPoorerDonationRemote } from "@/lib/overlay-sync-signature";
import {
  overlayUserIdsMatch,
  readLocalBroadcastState,
  subscribeBroadcastStateLocalUpdated,
} from "@/lib/broadcast-state-local-sync";

function readLocalStateIfExists(userId?: string): AppState | null {
  if (typeof window === "undefined") return null;
  /** u= 없이 legacy LS(타계정 잔여)를 읽지 않음 */
  if (!String(userId || "").trim()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return loadState(userId ?? undefined);
  } catch {
    return null;
  }
}

function donorRankingsPollSourceKey(userId?: string): string {
  if (typeof window === "undefined") return `donor-rankings:${userId || "default"}`;
  return `${window.location.pathname || "/overlay/donor-rankings"}:${userId || "default"}`;
}

function mergeDonorRankingsApiState(prev: AppState | null, remote: Partial<AppState>): AppState {
  const next = { ...defaultState(), ...prev, ...remote } as AppState;
  if (Array.isArray(remote.donors)) {
    next.donors = normalizeDonorsArray(remote.donors);
  }
  /** 원격이 기본 테마인데 로컬이 커스텀이면 유지 — 제목「후원 순위」가 기본「👑 웹후원 순위 👑」로 덮이는 것 방지 */
  if (
    prev?.donorRankingsTheme &&
    !isDefaultLikeDonorRankingsTheme(prev.donorRankingsTheme) &&
    isDefaultLikeDonorRankingsTheme(next.donorRankingsTheme)
  ) {
    next.donorRankingsTheme = prev.donorRankingsTheme;
  }
  if (
    prev?.donorRankingsFullTheme &&
    !isDefaultLikeDonorRankingsTheme(prev.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME) &&
    isDefaultLikeDonorRankingsTheme(next.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
  ) {
    next.donorRankingsFullTheme = prev.donorRankingsFullTheme;
  }
  return next;
}

/**
 * 후원 순위 오버레이: donors·순위 UI 가 바뀔 때만 GET (`pick=donor-rankings` + SSE `donorRankingsUpdatedAt`).
 * 수동 합산 추가 시 같은 탭 Broadcast·LS 후원을 즉시 반영하고, 빈 Redis 로 덮지 않는다.
 */
export function useDonorRankingsRemoteState(
  userId?: string
): { state: AppState | null; ready: boolean; resync: (opts?: { forceFull?: boolean }) => Promise<void> } {
  const [state, setState] = useState<AppState | null>(null);
  const [syncedOnce, setSyncedOnce] = useState(false);
  const lastSyncedRevRef = useRef(0);
  const stateRef = useRef<AppState | null>(null);
  const syncingRef = useRef(false);
  const syncFromApiRef = useRef<(opts?: { forceFull?: boolean }) => Promise<void>>(async () => {});
  const scheduleSseSyncRef = useRef<(() => void) | null>(null);

  stateRef.current = state;

  const applyLocalDonationSnapshot = useCallback((local: AppState) => {
    setState((prev) => mergeDonorRankingsApiState(prev, local));
    lastSyncedRevRef.current = Math.max(
      lastSyncedRevRef.current,
      readDonorRankingsRevision(local)
    );
  }, []);

  const syncFromApi = useCallback(async (opts?: { forceFull?: boolean }) => {
    if (!String(userId || "").trim()) {
      setSyncedOnce(true);
      return;
    }
    if (syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    try {
      const forceFull = Boolean(opts?.forceFull);
      const remote = await loadStateFromApi(userId, {
        pick: STATE_PICK_DONOR_RANKINGS,
        ifUpdatedSince: forceFull ? 0 : lastSyncedRevRef.current,
        forceFull,
      });
      if (!remote) return;
      const localNow = stateRef.current || readLocalStateIfExists(userId);
      if (localNow && shouldRejectPoorerDonationRemote(localNow, remote)) {
        /** 빈/축소 Redis 로 수동 합산·순위를 지우지 않음 — 테마만 원격 수용 */
        setState((prev) =>
          mergeDonorRankingsApiState(prev, {
            ...remote,
            donors: normalizeDonorsArray(localNow.donors),
            donorRankingsUpdatedAt: Math.max(
              readDonorRankingsRevision(localNow),
              readDonorRankingsRevision(remote)
            ),
          })
        );
        return;
      }
      const rev = readDonorRankingsRevision(remote);
      if (rev > 0) lastSyncedRevRef.current = Math.max(lastSyncedRevRef.current, rev);
      setState((prev) => mergeDonorRankingsApiState(prev, remote));
    } finally {
      syncingRef.current = false;
      setSyncedOnce(true);
    }
  }, [userId]);

  useSSEConnection((d: unknown) => {
    const o = d as { type?: string; updatedAt?: number; donorRankingsUpdatedAt?: number };
    if (o?.type !== "state_updated") return;
    if (!shouldSyncDonorRankingsFromStateUpdatedEvent(o, lastSyncedRevRef.current)) return;
    /** 수동 후원 직후 부분 GET(304) 레이스 방지 — 전체 수신 */
    void syncFromApiRef.current({ forceFull: true });
  });

  useEffect(() => {
    const local = readLocalStateIfExists(userId);
    if (local) {
      /** 테마만 시드하고 donors=[] 로 비우면 합산 직후 순위가 한동안 0으로 보임 */
      setState(mergeDonorRankingsApiState(null, local));
    } else {
      setState(defaultState());
    }
    /** 로컬 rev 를 since 로 쓰면 서버 신규 후원 GET 이 304 로 스킵될 수 있음 */
    lastSyncedRevRef.current = 0;

    syncFromApiRef.current = syncFromApi;
    const { schedule, cancel } = createStateUpdatedScheduler(
      () => {
        void syncFromApiRef.current({ forceFull: true });
      },
      { debounceMs: DONOR_STATE_UPDATED_DEBOUNCE_MS, maxWaitMs: DONOR_STATE_UPDATED_MAX_WAIT_MS }
    );
    scheduleSseSyncRef.current = schedule;

    void syncFromApi({ forceFull: true });

    const pollMs = readDonationListsOverlayPollMs();
    let stopPoll: (() => void) | undefined;
    if (pollMs > 0) {
      stopPoll = startStaggeredOverlayPoll(
        () => void syncFromApiRef.current({ forceFull: true }),
        pollMs,
        donorRankingsPollSourceKey(userId)
      );
    }

    const sseFallbackMs = pollMs > 0 ? 0 : readOverlaySseFallbackPollMs();
    let sseFallbackId: number | undefined;
    if (sseFallbackMs > 0) {
      sseFallbackId = window.setInterval(() => void syncFromApiRef.current({ forceFull: true }), sseFallbackMs);
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const localNow = readLocalStateIfExists(userId);
      if (localNow && normalizeDonorsArray(localNow.donors).length > 0) {
        applyLocalDonationSnapshot(localNow);
      }
      void syncFromApiRef.current({ forceFull: true });
    };

    const unsubscribeLocal = subscribeBroadcastStateLocalUpdated((detail) => {
      if (!overlayUserIdsMatch(userId, detail.userId)) return;
      const localNow = readLocalBroadcastState(userId) || readLocalStateIfExists(userId);
      if (localNow && normalizeDonorsArray(localNow.donors).length > 0) {
        applyLocalDonationSnapshot(localNow);
      }
      void syncFromApiRef.current({ forceFull: true });
    });

    window.addEventListener("storage", onStorage);
    return () => {
      cancel();
      scheduleSseSyncRef.current = null;
      stopPoll?.();
      if (sseFallbackId) window.clearInterval(sseFallbackId);
      window.removeEventListener("storage", onStorage);
      unsubscribeLocal();
    };
  }, [userId, syncFromApi, applyLocalDonationSnapshot]);

  const resync = useCallback(
    (opts?: { forceFull?: boolean }) => syncFromApi(opts),
    [syncFromApi]
  );

  return { state, ready: syncedOnce || state !== null, resync };
}
