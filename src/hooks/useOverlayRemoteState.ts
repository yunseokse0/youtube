"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";
import { shouldSuppressOverlaySseConnection } from "@/lib/overlay-params";
import {
  createStateUpdatedScheduler,
  readOverlayPollIntervalMs,
  readOverlaySseFallbackPollMs,
  shouldSyncOverlayFromStateUpdatedEvent,
} from "@/lib/overlay-pull-policy";
import { useSSEConnection } from "@/lib/sse-client";

import type { StateApiPick } from "@/lib/state-api-pick";
import { STATE_PICK_OVERLAY, STATE_PICK_OVERLAY_DONORS } from "@/lib/state-api-pick";

export type UseOverlayRemoteStateOptions = {
  /** false면 동기화 비활성 */
  enabled?: boolean;
  /** 기본 `overlay`. 후원 목록 필요 시 `overlay-donors` */
  statePick?: StateApiPick;
  /** 고정 스냅샷(시그 대전 미리보기 등) — 설정 시 폴링·SSE 생략 */
  frozenState?: AppState | null;
  /** 로컬 스냅샷 없을 때 lastUpdated 초기값 — `default`면 defaultState().updatedAt */
  noLocalBaseline?: "zero" | "default";
  /** storage 이벤트 후 API 동기화 지연(ms). 0이면 즉시 */
  storageDebounceMs?: number;
};

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
 * OBS·방송 오버레이 공통: SSE 변동 시만 GET, `since`+304, SSE 끊김 시 느린 폴백.
 */
export function useOverlayRemoteState(
  userId?: string,
  options: UseOverlayRemoteStateOptions = {}
): { state: AppState | null; ready: boolean } {
  const frozen = options.frozenState ?? null;
  const enabled = options.enabled !== false && frozen == null;
  const statePick = options.statePick ?? STATE_PICK_OVERLAY;
  const [state, setState] = useState<AppState | null>(frozen);
  const lastSyncedUpdatedAtRef = useRef(0);
  const syncingRef = useRef(false);
  const syncFromApiRef = useRef<() => Promise<void>>(async () => {});
  const scheduleSseSyncRef = useRef<(() => void) | null>(null);

  const syncFromApi = useCallback(async () => {
    if (!enabled || syncingRef.current) return;
    syncingRef.current = true;
    try {
      const remote = await loadStateFromApi(userId, {
        ifUpdatedSince: lastSyncedUpdatedAtRef.current,
        pick: statePick,
      });
      if (!remote) return;
      const ts = remote.updatedAt || 0;
      if (ts > 0) lastSyncedUpdatedAtRef.current = Math.max(lastSyncedUpdatedAtRef.current, ts);
      setState(remote);
    } finally {
      syncingRef.current = false;
    }
  }, [enabled, userId, statePick]);

  const { connected: sseConnected } = useSSEConnection((d: unknown) => {
    if (!enabled) return;
    const o = d as { type?: string; updatedAt?: number };
    if (o?.type !== "state_updated") return;
    if (!shouldSyncOverlayFromStateUpdatedEvent(o.updatedAt, lastSyncedUpdatedAtRef.current)) return;
    scheduleSseSyncRef.current?.();
  });

  useEffect(() => {
    if (frozen) {
      setState(frozen);
      return;
    }
    if (!enabled) return;

    const local = readLocalStateIfExists(userId);
    if (local) {
      setState(local);
      lastSyncedUpdatedAtRef.current = local.updatedAt || 0;
    } else {
      const base = defaultState();
      setState(base);
      lastSyncedUpdatedAtRef.current =
        options.noLocalBaseline === "default" ? base.updatedAt || 0 : 0;
    }

    syncFromApiRef.current = syncFromApi;

    const { schedule, cancel } = createStateUpdatedScheduler(() => {
      void syncFromApiRef.current();
    });
    scheduleSseSyncRef.current = schedule;

    const runInitialSync = () => {
      if (shouldSuppressOverlaySseConnection()) {
        if (!local) void syncFromApi();
        return;
      }
      void syncFromApi();
    };
    runInitialSync();

    const pollMs = readOverlayPollIntervalMs();
    let pollId: number | undefined;
    if (pollMs > 0) pollId = window.setInterval(() => void syncFromApi(), pollMs);

    const sseFallbackMs = pollMs > 0 ? 0 : readOverlaySseFallbackPollMs();
    let sseFallbackId: number | undefined;
    if (sseFallbackMs > 0 && !sseConnected) {
      sseFallbackId = window.setInterval(() => void syncFromApi(), sseFallbackMs);
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
          if (lastSyncedUpdatedAtRef.current <= 0 || u >= lastSyncedUpdatedAtRef.current) {
            lastSyncedUpdatedAtRef.current = u;
            setState(localNow);
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
    options.noLocalBaseline,
    options.storageDebounceMs,
  ]);

  return { state: frozen ?? state, ready: (frozen ?? state) !== null };
}
