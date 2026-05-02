"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { AppState } from "@/lib/state";
import {
  defaultState,
  ensureMembers,
  loadState,
  loadStateFromApi,
  normalizeSigMatchParticipantIds,
  normalizeSigMatchPools,
  storageKey,
} from "@/lib/state";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";
import { formatSigMatchStat, getSigMatchRankings } from "@/lib/settlement-utils";

type SigMatchSide = { ids: string[]; label: string; score: number };
type SigMatchDuelLayout =
  | { mode: "dual"; left: SigMatchSide; right: SigMatchSide }
  | { mode: "triple"; sides: [SigMatchSide, SigMatchSide, SigMatchSide] };

function tryReadSnapshotFromStorage(snapKey: string | null): Record<string, unknown> | null {
  if (!snapKey || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(snapKey);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function tryDecodeSnapshotB64(b64: string | null): Record<string, unknown> | null {
  if (!b64) return null;
  try {
    const json = decodeURIComponent(atob(b64));
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** URL snap / snapKey → 시그 대전 집계에 필요한 필드만 병합 */
function snapshotToSigMatchState(raw: Record<string, unknown> | null): AppState | null {
  if (!raw || !Array.isArray(raw.members)) return null;
  const base = defaultState();
  const members = ensureMembers(raw.members as AppState["members"]);
  if (members.length === 0) return null;
  const merged: AppState = {
    ...base,
    ...raw,
    members,
    donors: Array.isArray(raw.donors) ? (raw.donors as AppState["donors"]) : [],
    sigMatch: raw.sigMatch && typeof raw.sigMatch === "object" ? (raw.sigMatch as AppState["sigMatch"]) : {},
    sigMatchSettings: {
      ...base.sigMatchSettings,
      ...(typeof raw.sigMatchSettings === "object" && raw.sigMatchSettings
        ? (raw.sigMatchSettings as AppState["sigMatchSettings"])
        : {}),
    },
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
  };
  const valid = new Set(merged.members.map((m) => m.id));
  merged.sigMatchSettings = {
    ...merged.sigMatchSettings,
    sigMatchPools: normalizeSigMatchPools(merged.sigMatchSettings.sigMatchPools, valid),
    participantMemberIds: normalizeSigMatchParticipantIds(merged.sigMatchSettings.participantMemberIds, valid),
  };
  return merged;
}

function parseSigMatchSnapshot(sp: URLSearchParams): AppState | null {
  const key = (sp.get("snapKey") || "").trim();
  const fromKey = tryReadSnapshotFromStorage(key || null);
  const fromB64 = tryDecodeSnapshotB64(sp.get("snap"));
  return snapshotToSigMatchState(fromKey || fromB64);
}

function useSigMatchState(userId: string | undefined, lockedSnapshot: AppState | null): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(lockedSnapshot || defaultState());
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);

  const readLocalState = useCallback((): AppState | null => {
    if (typeof window === "undefined") return null;
    try {
      const key = storageKey(userId);
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return loadState(userId ?? undefined);
    } catch {
      return null;
    }
  }, [userId]);

  useEffect(() => {
    if (lockedSnapshot) {
      setState(lockedSnapshot);
      lastUpdatedRef.current = lockedSnapshot.updatedAt || Date.now();
      return;
    }

    const local = readLocalState();
    if (local) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
    } else {
      setState(defaultState());
      lastUpdatedRef.current = 0;
    }

    const syncFromApi = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const data = await loadStateFromApi(userId);
        if (data && (data.updatedAt || 0) >= lastUpdatedRef.current) {
          lastUpdatedRef.current = data.updatedAt || Date.now();
          setState(data);
        }
      } finally {
        syncingRef.current = false;
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const localNow = readLocalState();
      if (!localNow) return;
      const incomingUpdatedAt = localNow.updatedAt || 0;
      if (incomingUpdatedAt >= lastUpdatedRef.current) {
        lastUpdatedRef.current = incomingUpdatedAt;
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
  }, [readLocalState, userId, lockedSnapshot]);

  return { state, ready: state !== null };
}

function SigMatchOverlayInner() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const previewGuide = sp.get("previewGuide") === "true";
  const overlayScalePct = (() => {
    const raw = sp.get("scalePct") || sp.get("zoomPct") || "100";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(50, Math.min(300, n));
  })();
  const overlayScale = overlayScalePct / 100;
  const overlayScaleStyle = overlayScale === 1
    ? undefined
    : ({ transform: `scale(${overlayScale})`, transformOrigin: "top center" } as React.CSSProperties);
  const contentWidthPct = (() => {
    const raw = sp.get("contentWidthPct") || sp.get("maxWidthPct") || "";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(40, Math.min(100, n));
  })();
  const overlayContainerStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: `${contentWidthPct}%`,
    ...(overlayScaleStyle || {}),
  };

  const lockedSnapshot = useMemo(() => parseSigMatchSnapshot(sp), [sp]);

  const { state, ready } = useSigMatchState(userId, lockedSnapshot);

  const title = state?.sigMatchSettings?.title || "시그 대전";
  const active = Boolean(state?.sigMatchSettings?.isActive);
  const donationSyncMode = (state?.donationSyncMode || "mealBattle") as "none" | "mealBattle" | "sigMatch" | "sigSales";
  const sigMatchDonors = useMemo(
    () => (donationSyncMode === "sigMatch" ? (state?.donors || []) : []),
    [donationSyncMode, state?.donors]
  );

  const ranking = useMemo(
    () =>
      getSigMatchRankings(
        sigMatchDonors,
        state?.members || [],
        state?.sigMatchSettings || defaultState().sigMatchSettings,
        state?.sigMatch || {}
      ),
    [sigMatchDonors, state?.members, state?.sigMatchSettings, state?.sigMatch]
  );
  const memberMap = useMemo(() => new Map((state?.members || []).map((m) => [m.id, m.name])), [state?.members]);
  const duelData = useMemo((): SigMatchDuelLayout => {
    const pools = (state?.sigMatchSettings?.sigMatchPools || []).filter(
      (p) => Array.isArray(p.memberIds) && p.memberIds.length >= 1
    );
    const scoreMap = new Map(ranking.map((r) => [r.memberId, r.score]));
    const makeSide = (memberIds: string[], fallbackLabel: string): SigMatchSide => {
      const ids = [...new Set(memberIds.filter(Boolean))];
      const label = ids.map((id) => memberMap.get(id) || id).join(" · ") || fallbackLabel;
      const score = ids.reduce((sum, id) => sum + (scoreMap.get(id) || 0), 0);
      return { ids, label, score };
    };

    /** 풀 3개 이상: 상위 3개 풀 → 삼자 막대 (1:1:1·혼합 팀 등) */
    if (pools.length >= 3) {
      const sides: [SigMatchSide, SigMatchSide, SigMatchSide] = [
        makeSide(pools[0]!.memberIds, "1"),
        makeSide(pools[1]!.memberIds, "2"),
        makeSide(pools[2]!.memberIds, "3"),
      ];
      return { mode: "triple", sides };
    }
    /** 풀 2개 → 좌·우만 (1:2, 2:1, 2:2 …) */
    if (pools.length >= 2) {
      return {
        mode: "dual",
        left: makeSide(pools[0]!.memberIds, "LEFT"),
        right: makeSide(pools[1]!.memberIds, "RIGHT"),
      };
    }

    const list = ranking.filter(Boolean);
    if (list.length === 0) {
      return {
        mode: "dual",
        left: { ids: [], label: "LEFT", score: 0 },
        right: { ids: [], label: "RIGHT", score: 0 },
      };
    }
    if (list.length === 1) {
      const only = list[0]!;
      return {
        mode: "dual",
        left: { ids: [only.memberId], label: only.name, score: only.score },
        right: { ids: [], label: "—", score: 0 },
      };
    }
    if (list.length === 2) {
      const [a, b] = list;
      return {
        mode: "dual",
        left: { ids: [a!.memberId], label: a!.name, score: a!.score },
        right: { ids: [b!.memberId], label: b!.name, score: b!.score },
      };
    }
    /** 풀 없음·참가 3명: 개인전 1:1:1 */
    if (list.length === 3) {
      const triple: [SigMatchSide, SigMatchSide, SigMatchSide] = [
        { ids: [list[0]!.memberId], label: list[0]!.name, score: list[0]!.score },
        { ids: [list[1]!.memberId], label: list[1]!.name, score: list[1]!.score },
        { ids: [list[2]!.memberId], label: list[2]!.name, score: list[2]!.score },
      ];
      return { mode: "triple", sides: triple };
    }
    /** 4명 이상·풀 없음: 랭킹 순 절반 vs 절반 */
    const mid = Math.ceil(list.length / 2);
    const leftList = list.slice(0, mid);
    const rightList = list.slice(mid);
    const pack = (items: typeof list): SigMatchSide => ({
      ids: items.map((x) => x.memberId),
      label: items.map((x) => x.name).join(" · ") || "—",
      score: items.reduce((s, x) => s + x.score, 0),
    });
    return { mode: "dual", left: pack(leftList), right: pack(rightList) };
  }, [ranking, state?.sigMatchSettings?.sigMatchPools, memberMap]);
  /** 식사대전(/overlay/meal-match)과 동일하게 generalTimer + 서버 동기화(lastUpdated) 기준 */
  const timerState = state?.generalTimer || null;
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    if (!timerState) return;
    setTimerTick((v) => v + 1);
    const id = window.setInterval(() => setTimerTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [timerState]);
  const showSigMatchTimer = state?.matchTimerEnabled?.general !== false;
  const remainingSec = timerState ? getEffectiveRemainingTime(timerState) : 0;
  const timerPaused = Boolean(timerState && !timerState.isActive);
  const timerVisible = showSigMatchTimer;
  const timerText = `${String(Math.floor(Math.max(0, remainingSec) / 60)).padStart(2, "0")}:${String(Math.max(0, remainingSec) % 60).padStart(2, "0")}`;
  const timerStyleFromState = state?.timerDisplayStyles?.general;
  const timerOutlineColor = (sp.get("timerOutlineColor") || "").trim() || timerStyleFromState?.outlineColor || "rgba(6, 12, 24, 0.95)";
  const timerOutlineWidth = (() => {
    const raw = (sp.get("timerOutlineWidth") || "").trim();
    if (raw) {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return Math.max(0, Math.min(3, n));
    }
    const fromState = Number(timerStyleFromState?.outlineWidth ?? 0.8);
    return Number.isFinite(fromState) ? Math.max(0, Math.min(3, fromState)) : 0.8;
  })();
  const timerTextOutlineStyle: React.CSSProperties = {
    textShadow:
      timerOutlineWidth > 0
        ? `${-timerOutlineWidth}px 0 0 ${timerOutlineColor}, ${timerOutlineWidth}px 0 0 ${timerOutlineColor}, 0 ${-timerOutlineWidth}px 0 ${timerOutlineColor}, 0 ${timerOutlineWidth}px 0 ${timerOutlineColor}, 0 0 ${Math.max(1, timerOutlineWidth)}px ${timerOutlineColor}`
        : undefined,
    WebkitTextStroke: timerOutlineWidth > 0 ? `${timerOutlineWidth}px ${timerOutlineColor}` : undefined,
    paintOrder: "stroke fill",
  };
  const dualBar =
    duelData.mode === "dual"
      ? (() => {
          const t = duelData.left.score + duelData.right.score;
          const leftPct = t > 0 ? Math.max(0, Math.min(100, (duelData.left.score / t) * 100)) : 50;
          return {
            leftPct,
            rightPct: 100 - leftPct,
            leftLeading: duelData.left.score > duelData.right.score,
            rightLeading: duelData.right.score > duelData.left.score,
          };
        })()
      : null;

  const tripleBar =
    duelData.mode === "triple"
      ? (() => {
          const [a, b, c] = duelData.sides;
          const t = a.score + b.score + c.score;
          let p0: number;
          let p1: number;
          let p2: number;
          if (t > 0) {
            p0 = (a.score / t) * 100;
            p1 = (b.score / t) * 100;
            p2 = 100 - p0 - p1;
          } else {
            p0 = 100 / 3;
            p1 = 100 / 3;
            p2 = 100 / 3;
          }
          const maxS = Math.max(a.score, b.score, c.score);
          const lead = maxS > 0;
          return {
            pcts: [p0, p1, p2] as [number, number, number],
            crown: [lead && a.score === maxS, lead && b.score === maxS, lead && c.score === maxS] as [boolean, boolean, boolean],
          };
        })()
      : null;

  if (!ready || !state) {
    return (
      <main className="min-h-screen w-full bg-[#0b1020] p-6 text-white">
        <div className="mx-auto max-w-3xl rounded-2xl border border-white/20 bg-black/40 p-4 text-sm">
          시그 대전 오버레이 로딩 중...
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen w-full p-4 text-white ${previewGuide ? "bg-[#111827]" : "bg-transparent"}`}>
      <div className="mx-auto p-4" style={overlayContainerStyle}>
        <div className="relative mb-4 p-3">
          {timerVisible ? (
            <div
              className={`absolute left-1/2 top-1 -translate-x-1/2 rounded-md px-3 py-0.5 text-2xl font-black leading-none text-white shadow-[0_0_12px_rgba(239,68,68,0.45)] ${
                timerPaused ? "bg-neutral-600/90" : "bg-red-500/85"
              }`}
            >
              <span style={timerTextOutlineStyle}>{timerText}</span>
            </div>
          ) : null}
          {dualBar && duelData.mode === "dual" ? (
            <>
              <div className="mt-8 flex items-center justify-between gap-2 text-xs text-white/80">
                <span className="inline-flex max-w-[42%] truncate rounded-full bg-white/80 px-3 py-1 font-black text-pink-600">
                  {dualBar.leftLeading ? "👑 " : ""}
                  {duelData.left.label}
                </span>
                <span className="rounded-md bg-black/30 px-2 py-0.5 font-bold text-white/90">VS</span>
                <span className="inline-flex max-w-[42%] truncate justify-end rounded-full bg-white/80 px-3 py-1 font-black text-sky-600">
                  {dualBar.rightLeading ? "👑 " : ""}
                  {duelData.right.label}
                </span>
              </div>
              <div className="mt-2 h-4 w-full overflow-hidden rounded-full">
                <div className="flex h-full w-full">
                  <div
                    className="h-full bg-pink-300 transition-[width] duration-700 ease-out"
                    style={{ width: `${dualBar.leftPct}%` }}
                  />
                  <div
                    className="h-full bg-sky-300 transition-[width] duration-700 ease-out"
                    style={{ width: `${dualBar.rightPct}%` }}
                  />
                </div>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-white/75">
                <span>{formatSigMatchStat(duelData.left.score)}</span>
                <span>{formatSigMatchStat(duelData.right.score)}</span>
              </div>
            </>
          ) : null}
          {tripleBar && duelData.mode === "triple" ? (
            <>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[11px] text-white/80 sm:text-xs">
                {duelData.sides.map((side, i) => (
                  <span key={`sig-triple-${i}-${side.ids.join("-") || "x"}`} className="contents">
                    {i > 0 ? (
                      <span className="rounded-md bg-black/30 px-1.5 py-0.5 font-bold text-white/90">VS</span>
                    ) : null}
                    <span
                      className={`inline-flex max-w-[30%] min-w-0 truncate rounded-full bg-white/80 px-2 py-1 font-black sm:px-3 ${
                        i === 0 ? "text-pink-600" : i === 1 ? "text-amber-600" : "text-sky-600"
                      }`}
                    >
                      {tripleBar.crown[i] ? "👑 " : ""}
                      {side.label}
                    </span>
                  </span>
                ))}
              </div>
              <div className="mt-2 h-4 w-full overflow-hidden rounded-full">
                <div className="flex h-full w-full">
                  <div
                    className="h-full bg-pink-300 transition-[width] duration-700 ease-out"
                    style={{ width: `${tripleBar.pcts[0]}%` }}
                  />
                  <div
                    className="h-full bg-amber-300 transition-[width] duration-700 ease-out"
                    style={{ width: `${tripleBar.pcts[1]}%` }}
                  />
                  <div
                    className="h-full bg-sky-300 transition-[width] duration-700 ease-out"
                    style={{ width: `${tripleBar.pcts[2]}%` }}
                  />
                </div>
              </div>
              <div className="mt-1 grid grid-cols-3 gap-1 text-center text-[11px] text-white/75">
                {duelData.sides.map((side, i) => (
                  <span key={`sig-triple-score-${i}-${side.ids.join("-")}`}>{formatSigMatchStat(side.score)}</span>
                ))}
              </div>
            </>
          ) : null}
        </div>

        {ranking.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-4 text-center text-xs text-white/70">
            표시할 멤버 데이터가 없습니다.
          </div>
        ) : null}
      </div>
    </main>
  );
}

const SigMatchOverlayInnerNoSSR = dynamic(async () => SigMatchOverlayInner, {
  ssr: false,
});

export default function SigMatchOverlayPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-full bg-transparent p-8 text-white/60">
          <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-black/20 p-6 text-center text-sm">시그 대전 오버레이 로딩…</div>
        </main>
      }
    >
      <SigMatchOverlayInnerNoSSR />
    </Suspense>
  );
}
