"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  defaultState,
  loadState,
  loadStateFromApi,
  normalizeDonorsArray,
  storageKey,
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

function donorRankingsPollSourceKey(userId?: string): string {
  if (typeof window === "undefined") return `donor-rankings:${userId || "default"}`;
  return `${window.location.pathname || "/overlay/donor-rankings"}:${userId || "default"}`;
}

function mergeDonorRankingsApiState(prev: AppState | null, remote: Partial<AppState>): AppState {
  const next = { ...defaultState(), ...prev, ...remote } as AppState;
  if (Array.isArray(remote.donors)) {
    next.donors = normalizeDonorsArray(remote.donors);
  }
  return next;
}

function readDonorRankingsThemeFromLocal(userId?: string): Partial<AppState> | null {
  const local = readLocalStateIfExists(userId);
  if (!local) return null;
  const {
    donors: _donors,
    members: _members,
    mealBattle: _mealBattle,
    sigInventory: _sigInventory,
    rouletteState: _rouletteState,
    ...themeAndMeta
  } = local;
  return themeAndMeta;
}

/**
 * 후원 순위 오버레이: donors·순위 UI 가 바뀔 때만 GET (`pick=donor-rankings` + SSE `donorRankingsUpdatedAt`).
 */
export function useDonorRankingsRemoteState(
  userId?: string
): { state: AppState | null; ready: boolean; resync: (opts?: { forceFull?: boolean }) => Promise<void> } {
  const [state, setState] = useState<AppState | null>(null);
  const [syncedOnce, setSyncedOnce] = useState(false);
  const lastSyncedRevRef = useRef(0);
  const syncingRef = useRef(false);
  const syncFromApiRef = useRef<(opts?: { forceFull?: boolean }) => Promise<void>>(async () => {});
  const scheduleSseSyncRef = useRef<(() => void) | null>(null);

  const syncFromApi = useCallback(async (opts?: { forceFull?: boolean }) => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const forceFull = Boolean(opts?.forceFull);
      const remote = await loadStateFromApi(userId, {
        pick: STATE_PICK_DONOR_RANKINGS,
        ifUpdatedSince: forceFull ? 0 : lastSyncedRevRef.current,
        forceFull,
      });
      if (!remote) return;
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
    void syncFromApiRef.current();
  });

  useEffect(() => {
    const localTheme = readDonorRankingsThemeFromLocal(userId);
    if (localTheme) {
      setState((prev) => mergeDonorRankingsApiState(prev, { ...localTheme, donors: [] }));
      lastSyncedRevRef.current = readDonorRankingsRevision(localTheme as AppState);
    } else {
      setState(defaultState());
      lastSyncedRevRef.current = 0;
    }

    syncFromApiRef.current = syncFromApi;
    const { schedule, cancel } = createStateUpdatedScheduler(
      () => {
        void syncFromApiRef.current();
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
      void syncFromApiRef.current({ forceFull: true });
    };

    window.addEventListener("storage", onStorage);
    return () => {
      cancel();
      scheduleSseSyncRef.current = null;
      stopPoll?.();
      if (sseFallbackId) window.clearInterval(sseFallbackId);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId, syncFromApi]);

  const resync = useCallback(
    (opts?: { forceFull?: boolean }) => syncFromApi(opts),
    [syncFromApi]
  );

  return { state, ready: syncedOnce || state !== null, resync };
}
