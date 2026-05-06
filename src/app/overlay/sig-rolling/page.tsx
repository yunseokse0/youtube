"use client";

import type { CSSProperties } from "react";
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
import {
  SIG_ROLLING_MEDIA_HEIGHT_PX,
  SIG_ROLLING_MEDIA_WIDTH_PX,
} from "@/components/sig-sales/sig-overlay-card-size";

/** 202×300 프레임 안에 맞춤 — 원본 GIF/PNG 해상도와 무관, 잘림 없음(object-contain + flex/grid 최소크기 이슈 방지) */
const IMG_IN_FRAME =
  "pointer-events-none select-none block h-full w-full max-h-full max-w-full min-h-0 min-w-0 object-contain object-center";

const mediaFrameStyle: CSSProperties = {
  width: SIG_ROLLING_MEDIA_WIDTH_PX,
  height: SIG_ROLLING_MEDIA_HEIGHT_PX,
};

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
    /** 로컬 저장 없이 default만 쓸 때 updatedAt이 방금(ms)이라 서버 타임스탬프보다 항상 크게 나와 OBS 등에서 API 동기화가 영구히 건너뛰어짐 → goal 오버레이와 동일하게 ref=0 */
    const local = readLocalStateIfExists();
    if (local) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
    } else {
      const base = defaultState();
      setState(base);
      lastUpdatedRef.current = 0;
    }

    const syncFromApi = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const remote = await loadStateFromApi(userId);
        if (!remote) return;
        const remoteUpdatedAt = remote.updatedAt || 0;
        if (lastUpdatedRef.current <= 0 || remoteUpdatedAt >= lastUpdatedRef.current) {
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
  pairSide,
}: {
  current: SigRollingItem | null;
  nextItem: SigRollingItem | null;
  fading: boolean;
  transitionActive: string;
  replayKey: number;
  useCrossfade: boolean;
  /** 한 줄에 두 장일 때 맞닿는 쪽 패딩·모서리만 줄여 간격 최소화 */
  pairSide?: "left" | "right";
}) {
  if (!current) return null;

  const shellClass =
    pairSide === "left"
      ? "glass-pastel-card overflow-hidden rounded-l-3xl rounded-r-none shadow-lg pt-1.5 pb-1.5 pl-1.5 pr-0"
      : pairSide === "right"
        ? "glass-pastel-card overflow-hidden rounded-r-3xl rounded-l-none shadow-lg pt-1.5 pb-1.5 pr-1.5 pl-0"
        : "glass-pastel-card overflow-hidden rounded-3xl shadow-lg p-1.5";

  if (!useCrossfade) {
    return (
      <div className="shrink-0">
        <div className={shellClass}>
          <div
            className="flex items-center justify-center overflow-hidden rounded-2xl bg-black/25"
            style={mediaFrameStyle}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={replayKey}
              src={current.url}
              alt=""
              className={IMG_IN_FRAME}
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
    <div className="shrink-0">
      <div className={shellClass}>
        <div
          className="relative grid place-items-center overflow-hidden rounded-2xl bg-black/25 [&>img]:col-start-1 [&>img]:row-start-1"
          style={{
            ...mediaFrameStyle,
            gridTemplateColumns: "1fr",
            gridTemplateRows: "1fr",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`under-${under.id}`}
            src={under.url}
            alt=""
            className={IMG_IN_FRAME}
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
            className={IMG_IN_FRAME}
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
        <p className="max-w-[min(92vw,26rem)] text-xs leading-snug text-white/45">
          시그 롤링 · 등록된 이미지가 없거나 서버에 아직 반영되지 않았습니다. 관리자에서 업로드 후 저장(로그인·네트워크)이 되어야 OBS 등 다른 브라우저에서도 보입니다. URL에{" "}
          <code className="rounded bg-white/10 px-1">?u=본인아이디</code> 가 포함되는지 확인하세요.
        </p>
      </main>
    );
  }

  const transitionActive = `opacity ${fadeMs}ms ease-in-out`;

  return (
    <main className="overlay-root min-h-screen w-full bg-transparent p-4 text-pastel-ink">
      <div className="flex flex-row flex-wrap items-start gap-0">
        <RollingCardColumn
          current={leftCurrent}
          nextItem={useCrossfade ? leftNext : null}
          fading={fading}
          transitionActive={transitionActive}
          replayKey={replayKey}
          useCrossfade={useCrossfade}
          pairSide="left"
        />
        <RollingCardColumn
          current={rightCurrent}
          nextItem={useCrossfade ? rightNext : null}
          fading={fading}
          transitionActive={transitionActive}
          replayKey={replayKey}
          useCrossfade={useCrossfade}
          pairSide="right"
        />
      </div>
    </main>
  );
}
