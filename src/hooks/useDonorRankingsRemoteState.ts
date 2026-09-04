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
import { donorRankingsPickRevision, STATE_PICK_DONOR_RANKINGS } from "@/lib/state-api-pick";
import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";
import {
  createStateUpdatedScheduler,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  DEFAULT_ADMIN_PREVIEW_POLL_MS,
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
import {
  isAdminDashboardPreviewEmbed,
  isEmbeddedInSameOriginAdminFrame,
} from "@/lib/overlay-params";
import {
  isServerAuthoritativeBroadcastState,
  readSessionBroadcastState,
} from "@/lib/server-authoritative-broadcast-state";
import {
  donorRankingsObsCacheHasRankings,
  readDonorRankingsObsCache,
  writeDonorRankingsObsCache,
} from "@/lib/donor-rankings-obs-cache";

const DONOR_RANKINGS_API_RETRY_DELAYS_MS = [0, 400, 1200] as const;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLocalStateIfExists(userId?: string): AppState | null {
  if (typeof window === "undefined") return null;
  /** u= 없이 legacy LS(타계정 잔여)를 읽지 않음 */
  if (!String(userId || "").trim()) return null;
  if (isServerAuthoritativeBroadcastState()) {
    return readSessionBroadcastState(userId) ?? loadState(userId ?? undefined);
  }
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return loadState(userId ?? undefined);
  } catch {
    return null;
  }
}

/**
 * OBS·관리자 미리보기는 CEF/iframe LS 옛 후원으로 서버 순위를 덮지 않음.
 * (미리보기 15만 vs OBS 25.1만 불일치 방지)
 */
function shouldSkipLocalDonorBootstrap(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const sp = new URLSearchParams(window.location.search);
    const host = (sp.get("host") || "").toLowerCase();
    return (
      host === "obs" ||
      sp.get("adminPreviewEmbed") === "1" ||
      sp.get("hubPreview") === "1"
    );
  } catch {
    return false;
  }
}

/**
 * 빈 원격만 로컬 보호. 원격에 후원이 있으면(축소본 포함) 서버·미리보기·OBS 정본으로 수용.
 * — poorer 고착으로 OBS만 옛 순위(25.1만…)를 붙잡는 회귀 방지
 */
export function shouldKeepLocalDonorsOverRemote(local: AppState, remote: AppState): boolean {
  if (!shouldRejectPoorerDonationRemote(local, remote)) return false;
  const remoteDonors = normalizeDonorsArray(remote.donors);
  if (remoteDonors.length > 0) return false;
  const remoteReset = Number(remote.settlementResetAt || 0);
  const localReset = Number(local.settlementResetAt || 0);
  /** 정산 리셋 stamp 상승 없이 빈 원격이 revision만 높아져 후원순위·기록을 지우지 않음(영토 PATCH 경합) */
  if (remoteReset > localReset) return false;
  return true;
}

function donorRankingsPollSourceKey(userId?: string): string {
  if (typeof window === "undefined") return `donor-rankings:${userId || "default"}`;
  return `${window.location.pathname || "/overlay/donor-rankings"}:${userId || "default"}`;
}

function mergeDonorRankingsApiState(prev: AppState | null, remote: Partial<AppState>): AppState {
  const next = { ...defaultState(), ...prev, ...remote } as AppState;
  if (Array.isArray(remote.donors)) {
    const remoteDonors = normalizeDonorsArray(remote.donors);
    const prevDonors = normalizeDonorsArray(prev?.donors);
    const remoteReset = Number(remote.settlementResetAt || 0);
    const prevReset = Number(prev?.settlementResetAt || 0);
    /** 정산 리셋 stamp 상승 없이 빈 원격으로 명단을 지우지 않음(새로고침·부분 GET 경합)
     *  — remoteReset > prevReset 이면(의도적 정산 리셋) 반드시 빈 donors 적용 */
    const intentionalResetWipe = remoteDonors.length === 0 && remoteReset > prevReset;
    if (!intentionalResetWipe && remoteDonors.length === 0 && prevDonors.length > 0 && remoteReset <= prevReset) {
      next.donors = prevDonors;
    } else {
      next.donors = remoteDonors;
    }
  }
  if ("donorRankingsWire" in remote) {
    next.donorRankingsWire = (remote as AppState).donorRankingsWire;
  }
  if (typeof remote.settlementResetAt === "number" && Number.isFinite(remote.settlementResetAt)) {
    next.settlementResetAt = Math.max(
      Number(prev?.settlementResetAt || 0),
      remote.settlementResetAt
    );
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

async function loadDonorRankingsFromApi(
  userId: string,
  options: { forceFull?: boolean; ifUpdatedSince: number }
): Promise<AppState | null> {
  const attempts = options.forceFull ? DONOR_RANKINGS_API_RETRY_DELAYS_MS.length : 1;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleepMs(DONOR_RANKINGS_API_RETRY_DELAYS_MS[i] ?? 0);
    const remote = await loadStateFromApi(userId, {
      pick: STATE_PICK_DONOR_RANKINGS,
      ifUpdatedSince: options.forceFull ? 0 : options.ifUpdatedSince,
      forceFull: options.forceFull,
    });
    if (remote) return remote;
  }
  return null;
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
  const pendingSyncRef = useRef<"full" | "since" | null>(null);
  const syncFromApiRef = useRef<(opts?: { forceFull?: boolean }) => Promise<void>>(async () => {});
  const scheduleSseSyncRef = useRef<(() => void) | null>(null);
  const skipLocalDonorsRef = useRef(shouldSkipLocalDonorBootstrap());

  stateRef.current = state;

  const applyLocalDonationSnapshot = useCallback((local: AppState) => {
    /** OBS·미리보기는 로컬 Broadcast로 서버 순위를 덮지 않음 */
    if (skipLocalDonorsRef.current) return;
    setState((prev) => mergeDonorRankingsApiState(prev, local));
    lastSyncedRevRef.current = Math.max(
      lastSyncedRevRef.current,
      donorRankingsPickRevision(local)
    );
  }, []);

  const syncFromApi = useCallback(async (opts?: { forceFull?: boolean }) => {
    if (!String(userId || "").trim()) {
      setSyncedOnce(true);
      return;
    }
    const scopedUserId = String(userId).trim();
    if (syncingRef.current) {
      pendingSyncRef.current = opts?.forceFull || pendingSyncRef.current === "full" ? "full" : "since";
      return;
    }
    syncingRef.current = true;
    try {
      const forceFull = Boolean(opts?.forceFull);
      const remote = await loadDonorRankingsFromApi(scopedUserId, {
        forceFull,
        ifUpdatedSince: lastSyncedRevRef.current,
      });
      if (!remote) return;
      const localNow = stateRef.current || readLocalStateIfExists(scopedUserId);
      if (localNow && shouldKeepLocalDonorsOverRemote(localNow, remote)) {
        /** 빈 Redis 로 수동 합산·순위를 지우지 않음 — 테마만 원격 수용 */
        setState((prev) => {
          const next = mergeDonorRankingsApiState(prev, {
            ...remote,
            donors: normalizeDonorsArray(localNow.donors),
            donorRankingsUpdatedAt: Math.max(
              readDonorRankingsRevision(localNow),
              readDonorRankingsRevision(remote)
            ),
          });
          if (skipLocalDonorsRef.current && donorRankingsObsCacheHasRankings(next)) {
            writeDonorRankingsObsCache(scopedUserId, next);
          }
          return next;
        });
        lastSyncedRevRef.current = Math.max(
          lastSyncedRevRef.current,
          donorRankingsPickRevision(remote),
          donorRankingsPickRevision(localNow)
        );
        return;
      }
      const rev = donorRankingsPickRevision(remote);
      if (rev > 0) lastSyncedRevRef.current = Math.max(lastSyncedRevRef.current, rev);
      setState((prev) => {
        const next = mergeDonorRankingsApiState(prev, remote);
        if (skipLocalDonorsRef.current && donorRankingsObsCacheHasRankings(next)) {
          writeDonorRankingsObsCache(scopedUserId, next);
        }
        return next;
      });
    } finally {
      syncingRef.current = false;
      setSyncedOnce(true);
      const pending = pendingSyncRef.current;
      pendingSyncRef.current = null;
      if (pending) {
        void syncFromApiRef.current({ forceFull: pending === "full" });
      }
    }
  }, [userId]);

  useSSEConnection((d: unknown) => {
    const o = d as {
      type?: string;
      updatedAt?: number;
      donorRankingsUpdatedAt?: number;
      donationApplied?: unknown;
    };
    if (o?.type !== "state_updated") return;
    if (!shouldSyncDonorRankingsFromStateUpdatedEvent(o, lastSyncedRevRef.current)) return;
    /** 수동 후원 직후 부분 GET(304) 레이스 방지 — 전체 수신 */
    void syncFromApiRef.current({ forceFull: true });
  });

  useEffect(() => {
    skipLocalDonorsRef.current = shouldSkipLocalDonorBootstrap();
    const skipLocalDonors = skipLocalDonorsRef.current;
    const obsCache = skipLocalDonors ? readDonorRankingsObsCache(userId) : null;
    const local = skipLocalDonors ? null : readLocalStateIfExists(userId);
    if (obsCache) {
      setState(mergeDonorRankingsApiState(null, obsCache));
    } else if (local) {
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

    const adminPreview =
      isAdminDashboardPreviewEmbed() || isEmbeddedInSameOriginAdminFrame();
    const pollMs = adminPreview
      ? DEFAULT_ADMIN_PREVIEW_POLL_MS
      : readDonationListsOverlayPollMs();
    let stopPoll: (() => void) | undefined;
    if (pollMs > 0) {
      stopPoll = startStaggeredOverlayPoll(
        () => void syncFromApiRef.current(),
        pollMs,
        donorRankingsPollSourceKey(userId)
      );
    }

    const sseFallbackMs = pollMs > 0 ? 0 : readOverlaySseFallbackPollMs();
    let sseFallbackId: number | undefined;
    if (sseFallbackMs > 0) {
      /** 주기 fallback 은 since/304 — forceFull 은 초기·visibility·donation SSE 만 */
      sseFallbackId = window.setInterval(() => void syncFromApiRef.current(), sseFallbackMs);
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      if (!skipLocalDonorsRef.current) {
        const localNow = readLocalStateIfExists(userId);
        if (localNow && normalizeDonorsArray(localNow.donors).length > 0) {
          applyLocalDonationSnapshot(localNow);
        }
      }
      void syncFromApiRef.current({ forceFull: true });
    };

    const unsubscribeLocal = subscribeBroadcastStateLocalUpdated((detail) => {
      if (!overlayUserIdsMatch(userId, detail.userId)) return;
      if (!skipLocalDonorsRef.current) {
        const localNow = readLocalBroadcastState(userId) || readLocalStateIfExists(userId);
        if (localNow && normalizeDonorsArray(localNow.donors).length > 0) {
          applyLocalDonationSnapshot(localNow);
        }
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
