"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";
import { STATE_PICK_DONOR_RANKINGS } from "@/lib/state-api-pick";
import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";
import { shouldSuppressOverlaySseConnection } from "@/lib/overlay-params";
import {
  createStateUpdatedScheduler,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  readOverlayPollIntervalMs,
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

/**
 * 후원 순위 오버레이: donors·순위 UI 가 바뀔 때만 GET (`pick=donor-rankings` + SSE `donorRankingsUpdatedAt`).
 */
export function useDonorRankingsRemoteState(
  userId?: string
): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastSyncedRevRef = useRef(0);
  const syncingRef = useRef(false);
  const syncFromApiRef = useRef<() => Promise<void>>(async () => {});
  const scheduleSseSyncRef = useRef<(() => void) | null>(null);

  const syncFromApi = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const remote = await loadStateFromApi(userId, {
        pick: STATE_PICK_DONOR_RANKINGS,
        ifUpdatedSince: lastSyncedRevRef.current,
      });
      if (!remote) return;
      const rev = readDonorRankingsRevision(remote);
      if (rev > 0) lastSyncedRevRef.current = Math.max(lastSyncedRevRef.current, rev);
      setState((prev) => ({ ...defaultState(), ...prev, ...remote }));
    } finally {
      syncingRef.current = false;
    }
  }, [userId]);

  useSSEConnection((d: unknown) => {
    const o = d as { type?: string; updatedAt?: number; donorRankingsUpdatedAt?: number };
    if (o?.type !== "state_updated") return;
    if (!shouldSyncDonorRankingsFromStateUpdatedEvent(o, lastSyncedRevRef.current)) return;
    void syncFromApiRef.current();
  });

  useEffect(() => {
    const local = readLocalStateIfExists(userId);
    if (local) {
      setState((prev) => ({ ...defaultState(), ...prev, ...local }));
      lastSyncedRevRef.current = readDonorRankingsRevision(local);
    } else {
      const base = defaultState();
      setState(base);
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

    if (shouldSuppressOverlaySseConnection()) {
      if (!local) void syncFromApi();
    } else {
      void syncFromApi();
    }

    const pollMs = readOverlayPollIntervalMs();
    let pollId: number | undefined;
    if (pollMs > 0) pollId = window.setInterval(() => void syncFromApi(), pollMs);

    const sseFallbackMs = pollMs > 0 ? 0 : readOverlaySseFallbackPollMs();
    let sseFallbackId: number | undefined;
    if (sseFallbackMs > 0) {
      sseFallbackId = window.setInterval(() => void syncFromApi(), sseFallbackMs);
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      try {
        const localNow = readLocalStateIfExists(userId);
        if (!localNow) return;
        const rev = readDonorRankingsRevision(localNow);
        if (rev <= lastSyncedRevRef.current) return;
        lastSyncedRevRef.current = rev;
        setState((prev) => ({ ...defaultState(), ...prev, ...localNow }));
      } catch {
        /* noop */
      }
    };

    window.addEventListener("storage", onStorage);
    return () => {
      cancel();
      scheduleSseSyncRef.current = null;
      if (pollId) window.clearInterval(pollId);
      if (sseFallbackId) window.clearInterval(sseFallbackId);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId, syncFromApi]);

  return { state, ready: state !== null };
}
