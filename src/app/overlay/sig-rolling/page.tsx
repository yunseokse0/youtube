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

/** 세로·가로 GIF 모두 잘리지 않게 — 높이 상한만 두고 object-contain (`block`으로 인라인 베이스라인 여백 제거) */
const IMG_BOX =
  "pointer-events-none select-none block max-h-[min(85vh,720px)] w-auto max-w-full object-contain object-center";

/** 폴링으로 `state` 객체만 바뀌고 내용은 같을 때도 참조가 매번 바뀌지 않도록 문자열 키로 구분 (타이머 effect 무한 리셋 방지) */
function sigRollingScheduleKey(raw: unknown): string {
  const r = normalizeSigRolling(raw);
  return `${r.fadeMs}|${r.staticHoldMs}|${r.items.map((x) => `${x.id}\u001f${x.url}`).join("\u001e")}`;
}

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
}: {
  current: SigRollingItem | null;
  nextItem: SigRollingItem | null;
  fading: boolean;
  transitionActive: string;
  replayKey: number;
  useCrossfade: boolean;
}) {
  if (!current) return null;

  if (!useCrossfade) {
    return (
      <div className="flex w-[min(46vw,280px)] shrink-0 justify-center">
        <div className="glass-pastel-card overflow-hidden rounded-3xl shadow-lg p-1.5">
          <div className="flex min-h-[100px] items-center justify-center rounded-2xl bg-black/25 px-0.5 py-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={replayKey}
              src={current.url}
              alt=""
              className={IMG_BOX}
              draggable={false}
              decoding="async"
            />
          </div>
        </div>
      </div>
    );
  }

  const under = nextItem || current;
  return (
    <div className="flex w-[min(46vw,280px)] shrink-0 justify-center">
      <div className="glass-pastel-card overflow-hidden rounded-3xl shadow-lg p-1.5">
        <div
          className="relative grid min-h-[100px] place-items-center rounded-2xl bg-black/25 px-0.5 py-2 [&>img]:col-start-1 [&>img]:row-start-1"
          style={{ gridTemplateColumns: "1fr", gridTemplateRows: "1fr" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`under-${under.id}`}
            src={under.url}
            alt=""
            className={IMG_BOX}
            style={{
              opacity: fading ? 1 : 0,
              transition: fading ? transitionActive : "none",
              zIndex: 1,
            }}
            draggable={false}
            decoding="async"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`over-${current.id}`}
            src={current.url}
            alt=""
            className={IMG_BOX}
            style={{
              opacity: fading ? 0 : 1,
              transition: fading ? transitionActive : "none",
              zIndex: 2,
            }}
            draggable={false}
            decoding="async"
          />
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

  /** 한 줄에 왼쪽·오른쪽 카드가 함께 넘어가도록 페어 시작 인덱스(짝 단위 +2) */
  const [pairStart, setPairStart] = useState(0);
  const [fading, setFading] = useState(false);
  const [replayKey, setReplayKey] = useState(0);

  const n = items.length;
  const leftCurrent = n ? items[pairStart % n] : null;
  const rightCurrent = n ? items[(pairStart + 1) % n] : null;
  const leftNext = n ? items[(pairStart + 2) % n] : null;
  const rightNext = n ? items[(pairStart + 3) % n] : null;

  const scheduleKey = sigRollingScheduleKey(state?.sigRolling);
  const rollingRef = useRef(rolling);
  rollingRef.current = rolling;

  const useCrossfade = n >= 3;

  useEffect(() => {
    setPairStart(0);
    setReplayKey(0);
    setFading(false);
  }, [scheduleKey]);

  /** 크로스페이드 종료: CSS transitionEnd는 누락될 수 있어 fadeMs 타이머로만 진행 */
  useEffect(() => {
    if (!fading || n < 3) return;
    const ms = Math.max(120, fadeMs);
    const id = window.setTimeout(() => {
      setPairStart((p) => {
        const len = rollingRef.current.items.length;
        return len < 3 ? p : (p + 2) % len;
      });
      setFading(false);
    }, ms);
    return () => window.clearTimeout(id);
  }, [fading, n, fadeMs]);

  useEffect(() => {
    if (!ready || n === 0 || fading) return;

    let cancelled = false;
    let timerId: number | undefined;

    void (async () => {
      const r = rollingRef.current;
      const list = r.items;
      const nn = list.length;
      const holdMs = r.staticHoldMs;
      if (nn === 0) return;

      let hold = holdMs;
      if (nn === 1) {
        const url = list[0]?.url;
        if (!url) return;
        hold = await getSigRollingHoldMs(url, holdMs);
      } else if (nn === 2) {
        const h0 = await getSigRollingHoldMs(list[0].url, holdMs);
        const h1 = await getSigRollingHoldMs(list[1].url, holdMs);
        hold = Math.max(h0, h1);
      } else {
        const uL = list[pairStart % nn]?.url;
        const uR = list[(pairStart + 1) % nn]?.url;
        if (!uL || !uR) return;
        hold = Math.max(await getSigRollingHoldMs(uL, holdMs), await getSigRollingHoldMs(uR, holdMs));
      }
      if (cancelled) return;
      timerId = window.setTimeout(() => {
        if (nn <= 2) {
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
  }, [ready, n, pairStart, fading, scheduleKey, replayKey]);

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
        />
        <RollingCardColumn
          current={rightCurrent}
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
