"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { defaultState, loadState, loadStateFromApi, normalizeSigRolling, storageKey, type AppState } from "@/lib/state";
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

export default function SigRollingOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useRemoteState(userId);

  const rolling = useMemo(() => normalizeSigRolling(state?.sigRolling), [state?.sigRolling]);
  const items = rolling.items;
  const fadeMs = rolling.fadeMs;
  const staticHoldMs = rolling.staticHoldMs;

  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const n = items.length;
  const current = n ? items[idx % n] : null;
  const upcoming = n > 1 ? items[(idx + 1) % n] : null;

  const itemsSig = useMemo(() => items.map((x) => x.id).join("|"), [items]);

  useEffect(() => {
    setIdx(0);
    setReplayKey(0);
    setFading(false);
  }, [itemsSig]);

  useEffect(() => {
    if (!ready || n === 0 || fading) return;

    let cancelled = false;
    let timerId: number | undefined;

    void (async () => {
      const url = items[idx % n]?.url;
      if (!url) return;
      const hold = await getSigRollingHoldMs(url, staticHoldMs);
      if (cancelled) return;
      timerId = window.setTimeout(() => {
        if (n <= 1) {
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
  }, [ready, n, idx, fading, items, staticHoldMs, replayKey]);

  const onFadeEnd = useCallback(
    (e: React.TransitionEvent<HTMLImageElement>) => {
      if (!fading || e.propertyName !== "opacity") return;
      if (n <= 1) return;
      setIdx((i) => (i + 1) % n);
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
      <div className="inline-block w-[min(92vw,260px)]">
        <div className="glass-pastel-card overflow-hidden rounded-3xl shadow-lg">
          <div className="relative aspect-[4/5] w-full bg-black/20">
            {n === 1 && current ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={replayKey}
                src={current.url}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
                draggable={false}
              />
            ) : current && upcoming ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={`under-${idx}`}
                  src={upcoming.url}
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
                  key={`over-${current.id}-${idx}`}
                  src={current.url}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{
                    opacity: fading ? 0 : 1,
                    transition: fading ? transitionActive : "none",
                    zIndex: 2,
                  }}
                  draggable={false}
                  onTransitionEnd={onFadeEnd}
                />
              </>
            ) : null}
          </div>
          <div className="px-2 py-2 text-center">
            <div className="truncate text-sm font-bold pastel-text-outline">{current?.label?.trim() || "\u00a0"}</div>
          </div>
        </div>
      </div>
    </main>
  );
}
