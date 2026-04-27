"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
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
import { formatSigMatchStat, getSigMatchRankings } from "@/lib/settlement-utils";

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
  const snapQs = sp.get("snap") || "";
  const snapKeyQs = sp.get("snapKey") || "";
  const previewGuide = sp.get("previewGuide") === "true";

  const lockedSnapshot = useMemo(() => parseSigMatchSnapshot(sp), [snapQs, snapKeyQs]);

  const { state, ready } = useSigMatchState(userId, lockedSnapshot);

  const title = state?.sigMatchSettings?.title || "시그 대전";
  const target = state?.sigMatchSettings?.targetCount || 100;
  const active = Boolean(state?.sigMatchSettings?.isActive);

  const ranking = useMemo(
    () =>
      getSigMatchRankings(
        state?.donors || [],
        state?.members || [],
        state?.sigMatchSettings || defaultState().sigMatchSettings,
        state?.sigMatch || {}
      ),
    [state?.donors, state?.members, state?.sigMatchSettings, state?.sigMatch]
  );

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
    <main className={`min-h-screen w-full p-8 text-pastel-ink ${previewGuide ? "bg-[#1d1020]" : "bg-transparent"}`}>
      <div className="mx-auto max-w-3xl rounded-3xl border border-pink-200/50 bg-gradient-to-b from-pink-100/60 via-rose-100/50 to-fuchsia-100/40 p-6 shadow-[0_12px_36px_rgba(236,72,153,0.22)] backdrop-blur-md">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h1 className="text-4xl font-extrabold tracking-tight pastel-text-outline">{title}</h1>
            <p className="mt-1 text-sm text-pastel-ink/80 pastel-text-outline">
              목표 {target.toLocaleString("ko-KR")} · 상태 {active ? "진행중" : "대기"}
            </p>
          </div>
          {active ? (
            <div className="rounded-full border border-pink-100/70 bg-pink-300/70 px-3 py-1 text-sm font-bold text-rose-950 backdrop-blur-sm pastel-text-outline">
              LIVE
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {ranking.map((row, idx) => (
              <motion.div
                key={row.memberId}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
                className={`rounded-2xl px-4 py-3 pastel-text-outline ${
                  idx === 0
                    ? "border border-pink-200/80 bg-gradient-to-r from-pink-200/85 to-rose-100/85 shadow-sm backdrop-blur-sm"
                    : idx % 2 === 0
                      ? "bg-pink-100/70"
                      : "bg-rose-100/70"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="w-8 text-center text-xl font-black text-pastel-ink/90">{idx + 1}</div>
                    <div className={`truncate font-bold ${idx === 0 ? "text-3xl" : "text-2xl"}`}>{row.name}</div>
                  </div>
                  <div className={`font-black text-pastel-ink ${idx === 0 ? "text-4xl" : "text-3xl"}`}>
                    {formatSigMatchStat(row.score)}
                  </div>
                </div>
                <div className="mt-2">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-rose-100/80">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-fuchsia-400 via-pink-400 to-rose-300 transition-all duration-500"
                      style={{ width: `${Math.min(100, (row.score / Math.max(1, target)) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-xs text-pastel-ink/80">
                    {state.sigMatchSettings?.scoringMode === "amount"
                      ? `매칭 ${formatSigMatchStat(row.matchedCount)}건 · 합계 ${formatSigMatchStat(row.matchedAmount)} · 목표 ${target.toLocaleString("ko-KR")}`
                      : `매칭 ${formatSigMatchStat(row.matchedCount)}건${row.manualAdjust !== 0 ? ` · 보정 ${row.manualAdjust >= 0 ? "+" : ""}${row.manualAdjust}` : ""} · 목표 ${target.toLocaleString("ko-KR")}`}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {ranking.length === 0 && (
            <div className="rounded-2xl bg-pink-100/70 px-4 py-6 text-center text-rose-900/80 pastel-text-outline">
              표시할 멤버 데이터가 없습니다.
            </div>
          )}
        </div>
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
