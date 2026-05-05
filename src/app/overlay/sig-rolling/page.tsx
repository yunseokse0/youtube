"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  defaultState,
  loadState,
  loadStateFromApi,
  normalizeSigRolling,
  storageKey,
  type AppState,
  type SigRollingItem,
} from "@/lib/state";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { getSigRollingHoldMs } from "@/lib/sig-rolling-duration";

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);

  const readLocalStateIfExists = useCallback((): AppState | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey(userId));
      if (!raw) return null;
      return loadState(userId ?? undefined);
    } catch {
      return null;
    }
  }, [userId]);

  useEffect(() => {
    const local = readLocalStateIfExists();
    if (local) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
    } else {
      const base = defaultState();
      setState(base);
      lastUpdatedRef.current = base.updatedAt || 0;
    }

    const syncFromApi = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const remote = await loadStateFromApi(userId);
        if (!remote) return;
        const remoteUpdatedAt = remote.updatedAt || 0;
        if (remoteUpdatedAt >= lastUpdatedRef.current) {
          lastUpdatedRef.current = remoteUpdatedAt;
          setState(remote);
        }
      } finally {
        syncingRef.current = false;
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const localNow = readLocalStateIfExists();
      if (!localNow) return;
      const localUpdatedAt = localNow.updatedAt || 0;
      if (localUpdatedAt >= lastUpdatedRef.current) {
        lastUpdatedRef.current = localUpdatedAt;
        setState(localNow);
      }
    };

    const timer = window.setInterval(() => {
      void syncFromApi();
    }, 3000);
    window.addEventListener("storage", onStorage);
    void syncFromApi();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [readLocalStateIfExists, userId]);

  return { state, ready: state !== null };
}

function RollingCardColumn({
  current,
  nextItem,
  fading,
  transitionActive,
  replayKey,
  useCrossfade,
  onFadeEnd,
}: {
  current: SigRollingItem | null;
  nextItem: SigRollingItem | null;
  fading: boolean;
  transitionActive: string;
  replayKey: number;
  useCrossfade: boolean;
  onFadeEnd?: (e: React.TransitionEvent<HTMLImageElement>) => void;
}) {
  if (!current) return null;

  if (!useCrossfade) {
    return (
      <div className="w-[min(44vw,220px)] shrink-0">
        <div className="glass-pastel-card overflow-hidden rounded-3xl shadow-lg">
          <div className="relative aspect-[4/5] w-full bg-black/20">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={replayKey}
              src={current.url}
              alt=""
              className="absolute inset-0 h-full w-full object-cover"
              draggable={false}
            />
          </div>
          <div className="px-2 py-2 text-center">
            <div className="truncate text-sm font-bold pastel-text-outline">{current.label?.trim() || "\u00a0"}</div>
          </div>
        </div>
      </div>
    );
  }

  const under = nextItem || current;
  return (
    <div className="w-[min(44vw,220px)] shrink-0">
      <div className="glass-pastel-card overflow-hidden rounded-3xl shadow-lg">
        <div className="relative aspect-[4/5] w-full bg-black/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`under-${under.id}`}
            src={under.url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: fading ? 1 : 0,
              transition: fading ? transitionActive : "none",
              zIndex: 1,
            }}
            draggable={false}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`over-${current.id}`}
            src={current.url}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: fading ? 0 : 1,
              transition: fading ? transitionActive : "none",
              zIndex: 2,
            }}
            draggable={false}
            onTransitionEnd={onFadeEnd || undefined}
          />
        </div>
        <div className="px-2 py-2 text-center">
          <div className="truncate text-sm font-bold pastel-text-outline">{current.label?.trim() || "\u00a0"}</div>
        </div>
      </div>
    </div>
  );
}

export default function SigRollingOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useRemoteState(userId);

  const rolling = useMemo(() => normalizeSigRolling(state?.sigRolling), [state?.sigRolling]);
  const items = rolling.items;
  const fadeMs = rolling.fadeMs;
  const staticHoldMs = rolling.staticHoldMs;

  /** 한 줄에 왼쪽·오른쪽 카드가 함께 넘어가도록 페어 시작 인덱스(짝 단위 +2) */
  const [pairStart, setPairStart] = useState(0);
  const [fading, setFading] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const n = items.length;
  const leftCurrent = n ? items[pairStart % n] : null;
  const rightCurrent = n ? items[(pairStart + 1) % n] : null;
  const leftNext = n ? items[(pairStart + 2) % n] : null;
  const rightNext = n ? items[(pairStart + 3) % n] : null;

  const itemsSig = useMemo(() => items.map((x) => x.id).join("|"), [items]);

  const useCrossfade = n >= 3;

  useEffect(() => {
    setPairStart(0);
    setReplayKey(0);
    setFading(false);
  }, [itemsSig]);

  useEffect(() => {
    if (!ready || n === 0 || fading) return;

    let cancelled = false;
    let timerId: number | undefined;

    void (async () => {
      let hold = staticHoldMs;
      if (n === 1) {
        const url = items[0]?.url;
        if (!url) return;
        hold = await getSigRollingHoldMs(url, staticHoldMs);
      } else if (n === 2) {
        const h0 = await getSigRollingHoldMs(items[0].url, staticHoldMs);
        const h1 = await getSigRollingHoldMs(items[1].url, staticHoldMs);
        hold = Math.max(h0, h1);
      } else {
        const uL = items[pairStart % n]?.url;
        const uR = items[(pairStart + 1) % n]?.url;
        if (!uL || !uR) return;
        hold = Math.max(await getSigRollingHoldMs(uL, staticHoldMs), await getSigRollingHoldMs(uR, staticHoldMs));
      }
      if (cancelled) return;
      timerId = window.setTimeout(() => {
        if (n <= 2) {
          setReplayKey((k) => k + 1);
        } else {
          setFading(true);
        }
      }, hold);
    })();

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [ready, n, pairStart, fading, items, staticHoldMs, replayKey]);

  const onFadeEnd = useCallback(
    (e: React.TransitionEvent<HTMLImageElement>) => {
      if (!fading || e.propertyName !== "opacity") return;
      if (n < 3) return;
      setPairStart((p) => (p + 2) % n);
      setFading(false);
    },
    [fading, n]
  );

  if (!ready) return null;

  if (n === 0) {
    return (
      <main className="overlay-root min-h-screen w-full bg-transparent p-4">
        <p className="text-xs text-white/40">시그 롤링 · 이미지 없음 (관리자에서 추가)</p>
      </main>
    );
  }

  const transitionActive = `opacity ${fadeMs}ms ease-in-out`;

  return (
    <main className="overlay-root min-h-screen w-full bg-transparent p-4 text-pastel-ink">
      <div className="flex flex-row flex-wrap items-start gap-3">
        <RollingCardColumn
          current={leftCurrent}
          nextItem={useCrossfade ? leftNext : null}
          fading={fading}
          transitionActive={transitionActive}
          replayKey={replayKey}
          useCrossfade={useCrossfade}
          onFadeEnd={useCrossfade ? onFadeEnd : undefined}
        />
        <RollingCardColumn
          current={rightCurrent ?? leftCurrent}
          nextItem={useCrossfade ? rightNext : null}
          fading={fading}
          transitionActive={transitionActive}
          replayKey={replayKey}
          useCrossfade={useCrossfade}
        />
      </div>
    </main>
  );
}
