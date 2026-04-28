"use client";
import { Suspense, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AppState, totalAccount, Member, Donor, MissionItem, roundToThousand, formatManThousand, loadStateFromApi, loadState, totalToon, totalCombined, storageKey, defaultState, ensureMissionItems, ensureMembers, defaultMembers } from "@/lib/state";
import { presetToParams, type OverlayPresetLike } from "@/lib/overlay-params";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";
import { useFlip } from "@/lib/flip";
import MissionBoard from "@/components/MissionBoard";
import MissionBoardSlot from "@/components/MissionBoardSlot";
import { GoalBar } from "@/components/GoalBar";
import { useSSEConnection } from "@/lib/sse-client";

function tryDecodeSnapshot(str: string | null): AppState | null {
  if (!str) return null;
  try {
    const json = decodeURIComponent(atob(str));
    const obj = JSON.parse(json);
    if (obj && typeof obj === "object" && Array.isArray(obj.members)) {
      const now = Date.now();
      const merged = { ...defaultState(), ...obj, updatedAt: obj.updatedAt || now };
      const v = ensureMembers(merged.members);
      merged.members = v.length > 0 ? v : defaultMembers();
      merged.missions = ensureMissionItems(merged.missions);
      return merged;
    }
  } catch {}
  return null;
}

function tryReadSnapshotFromStorage(snapKey: string | null): AppState | null {
  if (!snapKey || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(snapKey);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && Array.isArray(obj.members)) {
      const now = Date.now();
      const merged = { ...defaultState(), ...obj, updatedAt: obj.updatedAt || now };
      const v = ensureMembers(merged.members);
      merged.members = v.length > 0 ? v : defaultMembers();
      merged.missions = ensureMissionItems(merged.missions);
      return merged;
    }
  } catch {}
  return null;
}

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const loadRef = useRef(() => loadStateFromApi(userId));
  loadRef.current = () => loadStateFromApi(userId);
  const syncingRef = useRef(false);
  const lastGoodRef = useRef<AppState | null>(null);
  const LAST_GOOD_KEY = typeof window !== "undefined" ? `overlay-last-good-${userId || "default"}` : "overlay-last-good";
  const KEEP_EMPTY_GRACE_MS = 60000;
  const isViable = (s: AppState | null) => !!(s && Array.isArray(s.members) && s.members.length > 0);
  const loadLastGood = useCallback((): AppState | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(LAST_GOOD_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && Array.isArray(obj.members)) return obj as AppState;
    } catch {}
    return null;
  }, [LAST_GOOD_KEY]);
  const saveLastGood = useCallback((s: AppState) => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(s)); } catch {}
  }, [LAST_GOOD_KEY]);
  const shouldDiscardEmpty = (incoming: AppState | null) => {
    if (!incoming) return false;
    const emptyMembers = !Array.isArray(incoming.members) || incoming.members.length === 0;
    if (!emptyMembers) return false;
    if (!lastGoodRef.current) return false;
    const ts = incoming.updatedAt || Date.now();
    const age = Date.now() - ts;
    return age <= KEEP_EMPTY_GRACE_MS;
  };
  const onSSE = useCallback((incoming: any) => {
    if (!incoming) return;
    if (shouldDiscardEmpty(incoming as AppState)) return;
    const ts = (incoming as any).updatedAt || Date.now();
    lastUpdatedRef.current = ts;
    const next = incoming as AppState;
    setState(next);
    if (isViable(next)) { lastGoodRef.current = next; saveLastGood(next); }
  }, [saveLastGood]);
  const _sse = useSSEConnection(onSSE);
  const readLocalStateIfExists = useCallback((): AppState | null => {
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
    const local = readLocalStateIfExists();
    const lastGood = loadLastGood();
    if (local && isViable(local)) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
      lastGoodRef.current = local;
      saveLastGood(local);
    } else if (lastGood && isViable(lastGood)) {
      setState(lastGood);
      lastUpdatedRef.current = lastGood.updatedAt || 0;
      lastGoodRef.current = lastGood;
    } else {
      // No persisted local snapshot: allow API state to win immediately.
      lastUpdatedRef.current = 0;
    }
    const syncOnce = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      // Same-tab preview/overlay should react to local changes immediately
      // even when API sync is delayed or failing.
      try {
        const localNow = readLocalStateIfExists();
        if (localNow && localNow.updatedAt && localNow.updatedAt > lastUpdatedRef.current && !shouldDiscardEmpty(localNow)) {
          lastUpdatedRef.current = localNow.updatedAt;
          setState(localNow);
          if (isViable(localNow)) { lastGoodRef.current = localNow; saveLastGood(localNow); }
        }
        const data = await loadRef.current();
        // Keep local state when API is stale (e.g. API save failed),
        // and only accept strictly newer snapshots from server.
        if (data && data.updatedAt && data.updatedAt > lastUpdatedRef.current && !shouldDiscardEmpty(data)) {
          lastUpdatedRef.current = data.updatedAt;
          setState(data);
          if (isViable(data)) { lastGoodRef.current = data; saveLastGood(data); }
        } else if (!localNow && !data) {
          // API 실패 + localStorage 비어있음 → 기본 상태로라도 프리뷰 표시
          const fallback = lastGoodRef.current || loadLastGood() || defaultState();
          setState(fallback);
        }
      } catch {
        const localNow = readLocalStateIfExists();
        if (!localNow) setState(lastGoodRef.current || loadLastGood() || defaultState());
      }
      syncingRef.current = false;
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const localNow = readLocalStateIfExists();
      if (localNow && localNow.updatedAt && localNow.updatedAt > lastUpdatedRef.current && !shouldDiscardEmpty(localNow)) {
        lastUpdatedRef.current = localNow.updatedAt;
        setState(localNow);
        if (isViable(localNow)) { lastGoodRef.current = localNow; saveLastGood(localNow); }
      }
    };
    // Faster cadence for donor/member sync in overlay runtime.
    const POLL_MS = 700;
    const timer = window.setInterval(() => {
      void syncOnce();
    }, POLL_MS);
    window.addEventListener("storage", onStorage);
    void syncOnce();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [userId, loadLastGood, readLocalStateIfExists, saveLastGood]);

  return { state, ready: state !== null };
}

function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    prevValueRef.current = to;
    startRef.current = performance.now();
    const loop = (t: number) => {
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(loop);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value, durationMs]);

  return display;
}

function useElapsed(startTs: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startTs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTs]);
  if (!startTs) return null;
  const diff = Math.max(0, Math.floor((now - startTs) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const sec = diff % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function useServerTimer(timer: AppState["generalTimer"] | null): { text: string | null; paused: boolean; remainingSeconds: number | null } {
  const [remaining, setRemaining] = useState<number>(timer ? getEffectiveRemainingTime(timer) : 0);
  useEffect(() => {
    if (!timer) {
      setRemaining(0);
      return;
    }
    setRemaining(getEffectiveRemainingTime(timer));
    if (!timer.isActive) return;
    const id = window.setInterval(() => {
      setRemaining(getEffectiveRemainingTime(timer));
    }, 1000);
    return () => clearInterval(id);
  }, [timer]);
  if (!timer) return { text: null, paused: false, remainingSeconds: null };
  const safe = Math.max(0, remaining);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const sec = safe % 60;
  return {
    text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`,
    paused: !timer.isActive,
    remainingSeconds: safe,
  };
}

function formatTimerText(elapsed: string | null, remainingSeconds?: number | null, showHours = false): string | null {
  if (remainingSeconds != null && Number.isFinite(remainingSeconds)) {
    const safe = Math.max(0, Math.floor(remainingSeconds));
    if (showHours) {
      const h = Math.floor(safe / 3600);
      const m = Math.floor((safe % 3600) / 60);
      const sec = safe % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    }
    const mm = Math.floor(safe / 60);
    const sec = safe % 60;
    return `${String(mm).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  if (!elapsed) return null;
  const parts = elapsed.split(":").map((x) => parseInt(x, 10));
  if (parts.some((x) => Number.isNaN(x))) return elapsed;
  const h = parts.length === 3 ? parts[0] : 0;
  const m = parts.length >= 2 ? parts[parts.length - 2] : 0;
  const sec = parts[parts.length - 1] ?? 0;
  if (showHours) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  const totalMin = h * 60 + m;
  return `${String(totalMin).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

type ThemeId = "default" | "excel" | "excelBlue" | "excelSlate" | "excelAmber" | "excelRose" | "excelNavy" | "excelTeal" | "excelPurple" | "excelEmerald" | "excelOrange" | "excelIndigo" | "neon" | "retro" | "minimal" | "rpg" | "pastel" | "neonExcel" | "rainbow" | "sunset" | "ocean" | "forest" | "aurora" | "violet" | "coral" | "mint" | "lava" | "ice";

const TABLE_BG_RGB: Record<string, [number, number, number]> = {
  excel: [255, 255, 255], excelBlue: [255, 255, 255], excelAmber: [255, 251, 235], excelRose: [255, 241, 242],
  excelTeal: [240, 253, 250], excelPurple: [250, 245, 255], excelEmerald: [236, 253, 245], excelOrange: [255, 247, 237], excelIndigo: [238, 242, 255],
  excelSlate: [30, 41, 59], excelNavy: [15, 23, 42],
  pastel: [253, 252, 240],
};
const defaultTableBgRgb: [number, number, number] = [23, 23, 23];

const THEMES: Record<ThemeId, {
  label: string;
  memberCls: string;
  nameCls: string;
  accountCls: string;
  toonCls: string;
  totalCls: string;
  totalWrapCls: string;
  rowCls: string;
  tableCls: string;
  headerCls: string;
  goalBarBg: string;
  goalBarFill: string;
  goalText: string;
  goalWrap: string;
  tickerCls: string;
  timerCls: string;
}> = {
  default: {
    label: "핑크 그라데이션",
    memberCls: "font-bold tracking-tight",
    nameCls: "text-pink-700",
    accountCls: "text-pink-700",
    toonCls: "text-pink-600",
    totalCls: "font-extrabold text-pink-700 drop-shadow-[0_0_6px_rgba(255,255,255,0.45)]",
    totalWrapCls: "bg-[linear-gradient(135deg,#FFDEE9_0%,#FCE4EC_50%,#FFD1FF_100%)] border border-white/40 px-2 py-1 rounded backdrop-blur-xl shadow-[0_8px_32px_0_rgba(255,182,193,0.3)]",
    rowCls: "px-2 py-1 bg-white/30 hover:bg-pink-50/50 transition-colors",
    tableCls: "bg-white/30 border border-white/40 rounded-lg overflow-hidden border-collapse backdrop-blur-xl shadow-[0_8px_32px_0_rgba(255,182,193,0.3)]",
    headerCls: "bg-pink-100/80 text-pink-700 font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-white/35",
    goalBarFill: "bg-gradient-to-r from-[#FFDEE9] via-[#FCE4EC] to-[#FFD1FF]",
    goalText: "text-white font-bold drop-shadow-[0_0_4px_rgba(0,0,0,1)]",
    goalWrap: "border border-white/40 bg-white/30 rounded p-1 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(255,182,193,0.25)]",
    tickerCls: "text-pink-700 font-semibold",
    timerCls: "font-mono text-pink-700/90",
  },
  excel: {
    label: "엑셀(녹색)",
    memberCls: "font-mono",
    nameCls: "text-slate-900 font-semibold",
    accountCls: "text-blue-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#217346] px-2 py-1",
    rowCls: "border border-[#d4d4d4] px-2 py-1 align-middle bg-white",
    tableCls: "bg-white border-collapse shadow-lg",
    headerCls: "bg-[#217346] text-white font-bold px-2 py-1 border border-[#1a5c37] text-sm",
    goalBarBg: "bg-[#d4d4d4]",
    goalBarFill: "bg-[#217346]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-[#d4d4d4] bg-white p-1",
    tickerCls: "text-[#217346] font-mono font-bold",
    timerCls: "font-mono text-black/60 bg-white/80 px-2",
  },
  excelBlue: {
    label: "엑셀(파랑)",
    memberCls: "font-mono",
    nameCls: "text-slate-900 font-semibold",
    accountCls: "text-blue-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#2563eb] px-2 py-1",
    rowCls: "border border-[#cbd5e1] px-2 py-1 align-middle bg-white",
    tableCls: "bg-white border-collapse shadow-lg",
    headerCls: "bg-[#2563eb] text-white font-bold px-2 py-1 border border-[#1d4ed8] text-sm",
    goalBarBg: "bg-[#e2e8f0]",
    goalBarFill: "bg-[#2563eb]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-[#cbd5e1] bg-white p-1",
    tickerCls: "text-[#2563eb] font-mono font-bold",
    timerCls: "font-mono text-slate-600 bg-white/80 px-2",
  },
  excelSlate: {
    label: "엑셀(슬레이트)",
    memberCls: "font-mono",
    nameCls: "text-slate-100 font-semibold",
    accountCls: "text-sky-300 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-400 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#334155] px-2 py-1",
    rowCls: "border border-slate-600 px-2 py-1 align-middle",
    tableCls: "bg-slate-800/95 border-collapse shadow-lg",
    headerCls: "bg-[#334155] text-white font-bold px-2 py-1 border border-slate-600 text-sm",
    goalBarBg: "bg-slate-700",
    goalBarFill: "bg-slate-500",
    goalText: "text-slate-200 font-mono font-bold",
    goalWrap: "border border-slate-600 bg-slate-800/95 p-1",
    tickerCls: "text-slate-300 font-mono font-bold",
    timerCls: "font-mono text-slate-400 bg-slate-700/80 px-2",
  },
  excelAmber: {
    label: "엑셀(앰버)",
    memberCls: "font-mono",
    nameCls: "text-amber-950 font-semibold",
    accountCls: "text-amber-900 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-amber-700 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#d97706] px-2 py-1",
    rowCls: "border border-amber-200 px-2 py-1 align-middle bg-amber-50",
    tableCls: "bg-amber-50 border-collapse shadow-lg",
    headerCls: "bg-[#d97706] text-white font-bold px-2 py-1 border border-[#b45309] text-sm",
    goalBarBg: "bg-amber-200",
    goalBarFill: "bg-[#d97706]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-amber-200 bg-amber-50/95 p-1",
    tickerCls: "text-[#d97706] font-mono font-bold",
    timerCls: "font-mono text-amber-700 bg-amber-100/80 px-2",
  },
  excelRose: {
    label: "엑셀(로즈)",
    memberCls: "font-mono",
    nameCls: "text-rose-950 font-semibold",
    accountCls: "text-rose-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-rose-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#e11d48] px-2 py-1",
    rowCls: "border border-rose-200 px-2 py-1 align-middle bg-rose-50",
    tableCls: "bg-rose-50 border-collapse shadow-lg",
    headerCls: "bg-[#e11d48] text-white font-bold px-2 py-1 border border-[#be123c] text-sm",
    goalBarBg: "bg-rose-200",
    goalBarFill: "bg-[#e11d48]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-rose-200 bg-rose-50/95 p-1",
    tickerCls: "text-[#e11d48] font-mono font-bold",
    timerCls: "font-mono text-rose-700 bg-rose-100/80 px-2",
  },
  excelNavy: {
    label: "엑셀(네이비)",
    memberCls: "font-mono",
    nameCls: "text-slate-100 font-semibold",
    accountCls: "text-sky-200 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-400 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#1e3a8a] px-2 py-1",
    rowCls: "border border-slate-500 px-2 py-1 align-middle",
    tableCls: "bg-slate-900/95 border-collapse shadow-lg",
    headerCls: "bg-[#1e3a8a] text-white font-bold px-2 py-1 border border-[#1e40af] text-sm",
    goalBarBg: "bg-slate-600",
    goalBarFill: "bg-[#1e40af]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-slate-500 bg-slate-900/95 p-1",
    tickerCls: "text-sky-300 font-mono font-bold",
    timerCls: "font-mono text-slate-300 bg-slate-800/80 px-2",
  },
  excelTeal: {
    label: "엑셀(틸)",
    memberCls: "font-mono",
    nameCls: "text-slate-900 font-semibold",
    accountCls: "text-teal-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#0d9488] px-2 py-1",
    rowCls: "border border-teal-200 px-2 py-1 align-middle bg-teal-50",
    tableCls: "bg-teal-50 border-collapse shadow-lg",
    headerCls: "bg-[#0d9488] text-white font-bold px-2 py-1 border border-[#0f766e] text-sm",
    goalBarBg: "bg-teal-200",
    goalBarFill: "bg-[#0d9488]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-teal-200 bg-teal-50 p-1",
    tickerCls: "text-[#0d9488] font-mono font-bold",
    timerCls: "font-mono text-teal-700 bg-teal-100/80 px-2",
  },
  excelPurple: {
    label: "엑셀(퍼플)",
    memberCls: "font-mono",
    nameCls: "text-slate-900 font-semibold",
    accountCls: "text-purple-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#7c3aed] px-2 py-1",
    rowCls: "border border-purple-200 px-2 py-1 align-middle bg-purple-50",
    tableCls: "bg-purple-50 border-collapse shadow-lg",
    headerCls: "bg-[#7c3aed] text-white font-bold px-2 py-1 border border-[#6d28d9] text-sm",
    goalBarBg: "bg-purple-200",
    goalBarFill: "bg-[#7c3aed]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-purple-200 bg-purple-50 p-1",
    tickerCls: "text-[#7c3aed] font-mono font-bold",
    timerCls: "font-mono text-purple-700 bg-purple-100/80 px-2",
  },
  excelEmerald: {
    label: "엑셀(에메랄드)",
    memberCls: "font-mono",
    nameCls: "text-slate-900 font-semibold",
    accountCls: "text-emerald-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#059669] px-2 py-1",
    rowCls: "border border-emerald-200 px-2 py-1 align-middle bg-emerald-50",
    tableCls: "bg-emerald-50 border-collapse shadow-lg",
    headerCls: "bg-[#059669] text-white font-bold px-2 py-1 border border-[#047857] text-sm",
    goalBarBg: "bg-emerald-200",
    goalBarFill: "bg-[#059669]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-emerald-200 bg-emerald-50 p-1",
    tickerCls: "text-[#059669] font-mono font-bold",
    timerCls: "font-mono text-emerald-700 bg-emerald-100/80 px-2",
  },
  excelOrange: {
    label: "엑셀(오렌지)",
    memberCls: "font-mono",
    nameCls: "text-slate-900 font-semibold",
    accountCls: "text-orange-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#ea580c] px-2 py-1",
    rowCls: "border border-orange-200 px-2 py-1 align-middle bg-orange-50",
    tableCls: "bg-orange-50 border-collapse shadow-lg",
    headerCls: "bg-[#ea580c] text-white font-bold px-2 py-1 border border-[#c2410c] text-sm",
    goalBarBg: "bg-orange-200",
    goalBarFill: "bg-[#ea580c]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-orange-200 bg-orange-50 p-1",
    tickerCls: "text-[#ea580c] font-mono font-bold",
    timerCls: "font-mono text-orange-700 bg-orange-100/80 px-2",
  },
  excelIndigo: {
    label: "엑셀(인디고)",
    memberCls: "font-mono",
    nameCls: "text-slate-900 font-semibold",
    accountCls: "text-indigo-800 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-slate-600 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#4f46e5] px-2 py-1",
    rowCls: "border border-indigo-200 px-2 py-1 align-middle bg-indigo-50",
    tableCls: "bg-indigo-50 border-collapse shadow-lg",
    headerCls: "bg-[#4f46e5] text-white font-bold px-2 py-1 border border-[#4338ca] text-sm",
    goalBarBg: "bg-indigo-200",
    goalBarFill: "bg-[#4f46e5]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-indigo-200 bg-indigo-50 p-1",
    tickerCls: "text-[#4f46e5] font-mono font-bold",
    timerCls: "font-mono text-indigo-700 bg-indigo-100/80 px-2",
  },
  neon: {
    label: "네온",
    memberCls: "font-black tracking-wide",
    nameCls: "text-cyan-300 drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]",
    accountCls: "text-fuchsia-400 drop-shadow-[0_0_8px_rgba(255,0,255,0.7)] tabular-nums overflow-hidden",
    toonCls: "text-yellow-300 drop-shadow-[0_0_6px_rgba(255,255,0,0.5)] tabular-nums overflow-hidden",
    totalCls: "font-black text-lime-300 drop-shadow-[0_0_12px_rgba(0,255,0,0.8)]",
    totalWrapCls: "bg-neutral-900/90 border border-cyan-500/50 px-2 py-1 rounded",
    rowCls: "border-b border-cyan-500/30 px-2 py-1 bg-black/40",
    tableCls: "bg-black/60 border border-cyan-500/50 rounded-lg overflow-hidden border-collapse shadow-lg",
    headerCls: "bg-gradient-to-r from-cyan-600/80 to-fuchsia-600/80 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-neutral-900/80 border border-cyan-500/40",
    goalBarFill: "bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-lime-400 shadow-[0_0_15px_rgba(0,255,255,0.5)]",
    goalText: "text-white font-black drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]",
    goalWrap: "border border-cyan-500/40 bg-black/60 rounded p-1",
    tickerCls: "text-cyan-300 font-bold drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]",
    timerCls: "font-mono text-fuchsia-300 drop-shadow-[0_0_6px_rgba(255,0,255,0.5)]",
  },
  retro: {
    label: "레트로",
    memberCls: "font-mono font-bold",
    nameCls: "text-amber-100",
    accountCls: "text-green-400",
    toonCls: "text-green-600",
    totalCls: "font-mono font-bold text-green-300",
    totalWrapCls: "border-2 border-green-500/60 bg-black/70 px-4 py-2 rounded",
    rowCls: "border-b border-green-500/40 px-2 py-1 bg-black/50",
    tableCls: "bg-black/70 border-2 border-green-500/60 rounded overflow-hidden border-collapse shadow-lg",
    headerCls: "bg-green-800/90 text-amber-100 font-bold px-2 py-1 border-b border-green-500 text-sm",
    goalBarBg: "bg-black/80 border border-green-500/50",
    goalBarFill: "bg-green-500",
    goalText: "text-green-300 font-mono font-bold",
    goalWrap: "border border-green-500/50 bg-black/70",
    tickerCls: "text-green-400 font-mono",
    timerCls: "font-mono text-green-300/80",
  },
  minimal: {
    label: "미니멀",
    memberCls: "font-light tracking-widest",
    nameCls: "text-white/90",
    accountCls: "text-white/70",
    toonCls: "text-white/40",
    totalCls: "font-thin text-white/80 tracking-[0.2em]",
    totalWrapCls: "bg-white/5 border border-white/10 px-2 py-1",
    rowCls: "border-b border-white/5 px-2 py-1",
    tableCls: "bg-black/30 border border-white/10 rounded overflow-hidden border-collapse",
    headerCls: "bg-white/10 text-white/80 font-light px-2 py-1 text-sm tracking-wider",
    goalBarBg: "bg-white/10",
    goalBarFill: "bg-white/50",
    goalText: "text-white/70 font-light tracking-wider",
    goalWrap: "border border-white/10 bg-black/30 rounded p-1",
    tickerCls: "text-white/60 font-light",
    timerCls: "font-mono text-white/40 font-light",
  },
  rpg: {
    label: "RPG",
    memberCls: "font-bold",
    nameCls: "text-yellow-200 drop-shadow-[0_0_4px_rgba(0,0,0,1)]",
    accountCls: "text-red-400",
    toonCls: "text-sky-400",
    totalCls: "font-extrabold text-yellow-300",
    totalWrapCls: "bg-gradient-to-r from-amber-900/80 via-amber-800/80 to-amber-900/80 border-2 border-yellow-600/70 px-4 py-2 rounded-lg shadow-[0_0_15px_rgba(255,200,0,0.3)]",
    rowCls: "bg-slate-900/70 border-b border-slate-600/50 px-3 py-1",
    tableCls: "bg-slate-900/90 border-2 border-yellow-600/60 rounded-lg overflow-hidden border-collapse shadow-lg",
    headerCls: "bg-gradient-to-r from-amber-800 to-yellow-700 text-yellow-200 font-bold px-3 py-1 border-b border-yellow-600/70 text-sm",
    goalBarBg: "bg-slate-900/80 border-2 border-yellow-700/60 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-red-600 via-orange-500 to-yellow-400 rounded-lg shadow-[0_0_10px_rgba(255,150,0,0.4)]",
    goalText: "text-yellow-200 font-extrabold drop-shadow-[0_0_4px_rgba(0,0,0,1)]",
    goalWrap: "bg-slate-900/70 border border-yellow-700/50 rounded-lg p-1",
    tickerCls: "text-yellow-300 font-bold",
    timerCls: "font-mono text-sky-300",
  },
  pastel: {
    label: "파스텔",
    memberCls: "font-semibold pastel-text-outline",
    nameCls: "text-pastel-ink",
    accountCls: "text-pastel-ink font-medium tabular-nums pastel-text-outline",
    toonCls: "text-pastel-ink/85 tabular-nums pastel-text-outline",
    totalCls: "font-bold text-pastel-ink pastel-text-outline",
    totalWrapCls: "rounded-2xl border border-white/20 bg-pastel-orange/50 px-3 py-1 backdrop-blur-md",
    rowCls: "px-2 py-1 align-middle",
    tableCls: "overflow-hidden rounded-2xl border border-white/20 border-collapse bg-white/40 shadow-sm backdrop-blur-md",
    headerCls: "bg-pastel-green/70 px-2 py-1 text-sm font-bold text-pastel-ink pastel-text-outline",
    goalBarBg: "rounded-full border border-white/20 bg-white/30 backdrop-blur-md",
    goalBarFill: "rounded-full bg-gradient-to-r from-pastel-red via-pastel-orange to-pastel-blue",
    goalText: "font-semibold text-pastel-ink pastel-text-outline",
    goalWrap: "rounded-2xl border border-white/20 bg-white/35 p-1 backdrop-blur-md",
    tickerCls: "font-semibold text-pastel-ink pastel-text-outline",
    timerCls: "font-mono text-pastel-ink",
  },
  neonExcel: {
    label: "네온 엑셀",
    memberCls: "font-mono font-bold",
    nameCls: "text-white",
    accountCls: "text-right text-slate-400 font-mono whitespace-nowrap",
    toonCls: "text-right text-slate-400 font-mono whitespace-nowrap",
    totalCls: "font-mono font-black text-cyan-300 tabular-nums whitespace-nowrap",
    totalWrapCls: "bg-cyan-900/30 px-1 py-1 border-t-2 border-cyan-500/50",
    rowCls: "bg-slate-900/40 py-1.5 px-1 border-b border-slate-800 last:border-none",
    tableCls: "border-2 border-cyan-500/50 bg-black/40 rounded-lg overflow-hidden animate-neonPulse",
    headerCls: "bg-cyan-900/30 text-cyan-300 font-mono py-1 px-1 border-b border-cyan-500/50 uppercase",
    goalBarBg: "bg-black/60 border border-cyan-500/30 rounded",
    goalBarFill: "bg-gradient-to-r from-cyan-500 to-fuchsia-500 shadow-[0_0_10px_rgba(0,255,255,0.4)]",
    goalText: "text-cyan-300 font-mono font-bold",
    goalWrap: "border border-cyan-500/30 bg-black/40 rounded p-1",
    tickerCls: "text-cyan-300 font-mono font-bold",
    timerCls: "font-mono text-cyan-400 drop-shadow-[0_0_6px_rgba(0,255,255,0.5)]",
  },
  rainbow: {
    label: "무지개",
    memberCls: "font-bold",
    nameCls: "text-white drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]",
    accountCls: "text-amber-200 tabular-nums",
    toonCls: "text-cyan-200 tabular-nums",
    totalCls: "font-black text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]",
    totalWrapCls: "bg-gradient-to-r from-red-500 via-orange-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-white/20 px-2 py-1 bg-black/50",
    tableCls: "bg-black/70 border-2 border-white/30 rounded-xl overflow-hidden border-collapse shadow-[0_0_20px_rgba(255,100,255,0.3)]",
    headerCls: "bg-gradient-to-r from-red-600 via-orange-500 via-yellow-500 via-green-500 via-blue-600 to-purple-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-black/60 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-red-500 via-orange-400 via-yellow-400 via-green-400 via-blue-500 to-purple-500 rounded-lg shadow-[0_0_12px_rgba(255,200,255,0.4)]",
    goalText: "text-white font-bold drop-shadow-[0_0_4px_rgba(0,0,0,0.8)]",
    goalWrap: "border border-white/20 bg-black/60 rounded-lg p-1",
    tickerCls: "text-amber-200 font-bold",
    timerCls: "font-mono text-cyan-300",
  },
  sunset: {
    label: "일몰",
    memberCls: "font-semibold",
    nameCls: "text-orange-100",
    accountCls: "text-amber-200 tabular-nums",
    toonCls: "text-rose-300 tabular-nums",
    totalCls: "font-bold text-yellow-100",
    totalWrapCls: "bg-gradient-to-r from-orange-600 via-rose-500 to-purple-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-orange-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-orange-950/80 border border-orange-500/40 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(251,146,60,0.25)]",
    headerCls: "bg-gradient-to-r from-orange-600 to-rose-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-orange-500 via-rose-500 to-purple-500 rounded-lg shadow-[0_0_10px_rgba(251,146,60,0.4)]",
    goalText: "text-orange-100 font-bold",
    goalWrap: "border border-orange-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-amber-200 font-semibold",
    timerCls: "font-mono text-rose-300",
  },
  ocean: {
    label: "오션",
    memberCls: "font-semibold",
    nameCls: "text-cyan-100",
    accountCls: "text-sky-300 tabular-nums",
    toonCls: "text-teal-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-cyan-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-cyan-950/60 border border-cyan-500/50 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(6,182,212,0.25)]",
    headerCls: "bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-500 rounded-lg shadow-[0_0_10px_rgba(6,182,212,0.4)]",
    goalText: "text-cyan-100 font-bold",
    goalWrap: "border border-cyan-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-cyan-300 font-semibold",
    timerCls: "font-mono text-sky-300",
  },
  forest: {
    label: "포레스트",
    memberCls: "font-semibold",
    nameCls: "text-emerald-100",
    accountCls: "text-lime-300 tabular-nums",
    toonCls: "text-green-400 tabular-nums",
    totalCls: "font-bold text-lime-100",
    totalWrapCls: "bg-gradient-to-r from-emerald-600 via-green-500 to-teal-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-emerald-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-emerald-950/60 border border-emerald-500/50 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(16,185,129,0.25)]",
    headerCls: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-emerald-500 via-green-400 to-teal-500 rounded-lg shadow-[0_0_10px_rgba(16,185,129,0.4)]",
    goalText: "text-emerald-100 font-bold",
    goalWrap: "border border-emerald-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-lime-300 font-semibold",
    timerCls: "font-mono text-emerald-300",
  },
  aurora: {
    label: "오로라",
    memberCls: "font-semibold",
    nameCls: "text-purple-100",
    accountCls: "text-fuchsia-300 tabular-nums",
    toonCls: "text-cyan-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-purple-500 via-fuchsia-500 via-cyan-500 to-emerald-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-purple-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 via-purple-950/50 to-cyan-950/40 border border-purple-500/50 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(168,85,247,0.25)]",
    headerCls: "bg-gradient-to-r from-purple-600 via-fuchsia-500 to-cyan-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-purple-400 via-fuchsia-400 via-cyan-400 to-emerald-400 rounded-lg shadow-[0_0_12px_rgba(168,85,247,0.4)]",
    goalText: "text-purple-100 font-bold",
    goalWrap: "border border-purple-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-fuchsia-300 font-semibold",
    timerCls: "font-mono text-cyan-300",
  },
  violet: {
    label: "바이올렛",
    memberCls: "font-semibold",
    nameCls: "text-violet-100",
    accountCls: "text-purple-300 tabular-nums",
    toonCls: "text-fuchsia-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-violet-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-violet-950/70 border border-violet-500/50 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(139,92,246,0.25)]",
    headerCls: "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-violet-500 via-purple-400 to-fuchsia-500 rounded-lg shadow-[0_0_10px_rgba(139,92,246,0.4)]",
    goalText: "text-violet-100 font-bold",
    goalWrap: "border border-violet-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-purple-300 font-semibold",
    timerCls: "font-mono text-fuchsia-300",
  },
  coral: {
    label: "코랄",
    memberCls: "font-semibold",
    nameCls: "text-rose-100",
    accountCls: "text-orange-300 tabular-nums",
    toonCls: "text-pink-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-rose-500 via-orange-400 to-amber-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-rose-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-rose-950/60 border border-rose-500/50 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(244,63,94,0.25)]",
    headerCls: "bg-gradient-to-r from-rose-600 to-amber-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-rose-500 via-orange-400 to-amber-400 rounded-lg shadow-[0_0_10px_rgba(244,63,94,0.4)]",
    goalText: "text-rose-100 font-bold",
    goalWrap: "border border-rose-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-orange-300 font-semibold",
    timerCls: "font-mono text-pink-300",
  },
  mint: {
    label: "민트",
    memberCls: "font-semibold",
    nameCls: "text-teal-100",
    accountCls: "text-emerald-300 tabular-nums",
    toonCls: "text-cyan-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-teal-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-teal-950/60 border border-teal-500/50 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(20,184,166,0.25)]",
    headerCls: "bg-gradient-to-r from-teal-600 to-cyan-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 rounded-lg shadow-[0_0_10px_rgba(20,184,166,0.4)]",
    goalText: "text-teal-100 font-bold",
    goalWrap: "border border-teal-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-emerald-300 font-semibold",
    timerCls: "font-mono text-cyan-300",
  },
  lava: {
    label: "라바",
    memberCls: "font-bold",
    nameCls: "text-red-100",
    accountCls: "text-orange-300 tabular-nums",
    toonCls: "text-yellow-300 tabular-nums",
    totalCls: "font-black text-yellow-100",
    totalWrapCls: "bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 px-4 py-2 rounded-lg shadow-[0_0_15px_rgba(239,68,68,0.4)]",
    rowCls: "border-b border-red-500/40 px-2 py-1 bg-slate-900/80",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-red-950/70 border-2 border-red-500/60 rounded-xl overflow-hidden border-collapse shadow-[0_0_30px_rgba(239,68,68,0.3)]",
    headerCls: "bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-red-500 via-orange-400 to-yellow-400 rounded-lg shadow-[0_0_12px_rgba(239,68,68,0.5)]",
    goalText: "text-red-100 font-bold",
    goalWrap: "border border-red-500/50 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-orange-300 font-bold",
    timerCls: "font-mono text-yellow-300",
  },
  ice: {
    label: "아이스",
    memberCls: "font-semibold",
    nameCls: "text-sky-100",
    accountCls: "text-cyan-200 tabular-nums",
    toonCls: "text-blue-200 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-400 px-4 py-2 rounded-lg shadow-[0_0_15px_rgba(125,211,252,0.4)]",
    rowCls: "border-b border-cyan-400/30 px-2 py-1 bg-slate-900/80",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-cyan-950/50 border border-cyan-400/50 rounded-xl overflow-hidden border-collapse shadow-[0_0_25px_rgba(34,211,238,0.2)]",
    headerCls: "bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 text-slate-900 font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-400 rounded-lg shadow-[0_0_10px_rgba(34,211,238,0.4)]",
    goalText: "text-sky-100 font-bold",
    goalWrap: "border border-cyan-400/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-cyan-200 font-semibold",
    timerCls: "font-mono text-sky-300",
  },
};

function PersonalGoalBoard({
  items,
  themeId,
  fontSize,
}: {
  items: Array<{ id: string; name: string; current: number; goal: number; pct: number }>;
  themeId: "goalClassic" | "goalNeon";
  fontSize: number;
}) {
  const palette = themeId === "goalNeon"
    ? ["#7C4DFF", "#FFD54F", "#FF4D8D", "#63E6BE", "#4FC3F7", "#FFB74D"]
    : ["#8C7DFF", "#F7D44A", "#E45C8B", "#6FC1FF", "#7ED39E", "#FDBA74"];
  const cardClass = themeId === "goalNeon"
    ? "bg-slate-900/85 border border-cyan-300/40 shadow-[0_0_12px_rgba(0,255,255,0.15)]"
    : "bg-slate-800/90 border border-white/20";
  const dimTextClass = themeId === "goalNeon" ? "text-cyan-100/80" : "text-white/75";
  const currentTextClass = themeId === "goalNeon" ? "text-white" : "text-white";
  const barBgClass = themeId === "goalNeon" ? "bg-slate-700/80" : "bg-slate-600/60";
  const num = (n: number) => Math.max(0, Math.round(n)).toLocaleString("ko-KR");

  return (
    <div className="min-w-[300px] max-w-[440px]">
      {items.length === 0 && (
        <div className={`rounded ${cardClass} p-2 ${dimTextClass}`} style={{ fontSize: Math.max(10, Math.round(fontSize * 0.72)) }}>
          목표(원) 입력된 멤버가 없습니다.
        </div>
      )}
      <div className="space-y-3">
        {items.map((it, idx) => {
          const accent = palette[idx % palette.length];
          const remain = Math.max(0, it.goal - it.current);
          const barH = Math.max(16, Math.round(fontSize * 0.55));
          return (
          <div key={it.id} className={`overlay-goal-card rounded-xl ${cardClass}`} style={{ padding: "0.75rem 1rem" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap" style={{ paddingBottom: "0.5rem" }}>
              <span
                className="px-3 py-1 rounded-md border font-bold tracking-wide text-white shrink-0"
                style={{ borderColor: accent, fontSize: Math.max(14, Math.round(fontSize * 0.72)), minWidth: 90 }}
              >
                {it.name}
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(12, Math.round(fontSize * 0.66)) }}>
                남은 금액: {num(remain)}
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(12, Math.round(fontSize * 0.66)) }}>
                {Math.round(it.pct)}%
              </span>
            </div>
            <div className="flex items-center justify-end gap-2" style={{ paddingBottom: "0.5rem" }}>
              <span className={currentTextClass} style={{ color: accent, fontWeight: 800, fontSize: Math.max(14, Math.round(fontSize * 0.72)) }}>
                {num(it.current)}원
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(12, Math.round(fontSize * 0.66)) }}>
                / {num(it.goal)}
              </span>
            </div>
            <div className={`overlay-goal-bar ${barBgClass} overflow-hidden`} style={{ height: barH, borderRadius: 999 }}>
              <div style={{ width: `${it.pct}%`, height: "100%", background: accent, borderRadius: 999 }} />
            </div>
          </div>
        )})}
      </div>
    </div>
  );
}

function DonorTicker({ donors, theme, fontSize, color, bgColor, bgOpacity, full, duration, gap, limit, unit, locale, placeholderText, previewGuide, tickerTheme, tickerGlow, tickerShadow }: { donors: Donor[]; theme: typeof THEMES.default; fontSize: number; color?: string; bgColor?: string; bgOpacity?: number; full?: boolean; duration?: number; gap?: number; limit?: number; unit?: string; locale?: string; placeholderText?: string; previewGuide?: boolean; tickerTheme?: string; tickerGlow?: number; tickerShadow?: number }) {
  const recent = useMemo(() => {
    const lim = Math.max(1, limit || 5);
    const sorted = donors.slice().sort((a, b) => b.at - a.at);
    const byName = new Map<string, { name: string; at: number; account: number; toon: number }>();
    for (const d of sorted) {
      if ((d.target || "account") === "toon") continue;
      const key = (d.name || "무명").trim() || "무명";
      const prev = byName.get(key);
      if (!prev) {
        byName.set(key, {
          name: key,
          at: d.at || 0,
          account: (d.amount || 0),
          toon: 0,
        });
        continue;
      }
      byName.set(key, {
        name: key,
        at: Math.max(prev.at, d.at || 0),
        account: prev.account + (d.amount || 0),
        toon: prev.toon,
      });
    }
    return Array.from(byName.values())
      .sort((a, b) => b.at - a.at)
      .slice(0, lim);
  }, [donors, limit]);
  const stream = useMemo(() => {
    if (!recent.length) return [];
    const minItems = Math.max(24, (limit || 5) * 10);
    const out: { name: string; at: number; account: number; toon: number }[] = [];
    while (out.length < minItems) out.push(...recent);
    return out.slice(0, minItems);
  }, [recent, limit]);

  const runtimeTickerCfg = typeof window !== "undefined" ? (window as any).__overlayTickerConfig : null;
  const shouldShowGuide = typeof previewGuide === "boolean"
    ? previewGuide
    : (runtimeTickerCfg && typeof runtimeTickerCfg.previewGuide === "boolean")
      ? runtimeTickerCfg.previewGuide
      : (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("previewGuide") === "true" : false);
  const tickerThemeValue = tickerTheme || (runtimeTickerCfg?.tickerTheme || (typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("tickerTheme") || "auto")
    : "auto"));
  const tickerGlowValue = typeof tickerGlow === "number"
    ? Math.max(0, Math.min(100, tickerGlow))
    : (typeof runtimeTickerCfg?.tickerGlow === "number")
      ? Math.max(0, Math.min(100, runtimeTickerCfg.tickerGlow))
      : (typeof window !== "undefined" ? Math.max(0, Math.min(100, parseInt(new URLSearchParams(window.location.search).get("tickerGlow") || "45", 10))) : 45);
  const tickerShadowValue = typeof tickerShadow === "number"
    ? Math.max(0, Math.min(100, tickerShadow))
    : (typeof runtimeTickerCfg?.tickerShadow === "number")
      ? Math.max(0, Math.min(100, runtimeTickerCfg.tickerShadow))
      : (typeof window !== "undefined" ? Math.max(0, Math.min(100, parseInt(new URLSearchParams(window.location.search).get("tickerShadow") || "35", 10))) : 35);
  const baseTickerThemeStyle: React.CSSProperties =
    tickerThemeValue === "neon"
      ? { color: "#8cf4ff", fontWeight: 700 }
      : tickerThemeValue === "warm"
      ? { color: "#ffd28a", fontWeight: 700 }
      : tickerThemeValue === "ice"
      ? { color: "#c5e9ff", fontWeight: 700 }
      : tickerThemeValue === "mono"
      ? { color: "#e5e7eb", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontWeight: 700 }
      : tickerThemeValue === "accent"
      ? { color: "#fcd34d", fontWeight: 700 }
      : {};
  const colorWithAlpha = (hex: string, alpha: number): string => {
    const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return hex;
    const raw = m[1];
    const normalized = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  };
  const normalizeColorWithAlpha = (input: string, alpha: number): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("#")) return colorWithAlpha(trimmed, alpha);
    const rgb = trimmed.match(/^rgb\(\s*([^\)]*)\s*\)$/i);
    if (rgb) {
      return `rgba(${rgb[1]}, ${Math.max(0, Math.min(1, alpha))})`;
    }
    const rgba = trimmed.match(/^rgba\(\s*([^\)]*)\s*\)$/i);
    if (rgba) {
      const parts = rgba[1].split(",").map((p) => p.trim());
      if (parts.length >= 3) {
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Math.max(0, Math.min(1, alpha))})`;
      }
    }
    return trimmed;
  };
  const glowColor = (color || (typeof baseTickerThemeStyle.color === "string" ? baseTickerThemeStyle.color : "")) as string;
  const glowBlur = Math.round((tickerGlowValue / 100) * 16);
  const shadowBlur = Math.round((tickerShadowValue / 100) * 8);
  const shadowAlpha = (tickerShadowValue / 100) * 0.72;
  const glowAlpha = (tickerGlowValue / 100) * 0.65;
  const shadowParts: string[] = [];
  if (shadowBlur > 0) shadowParts.push(`0 1px ${shadowBlur}px rgba(0, 0, 0, ${shadowAlpha.toFixed(2)})`);
  if (glowBlur > 0 && glowColor) {
    shadowParts.push(`0 0 ${glowBlur}px ${colorWithAlpha(glowColor, glowAlpha)}`);
  }
  const tickerThemeStyle: React.CSSProperties = {
    ...baseTickerThemeStyle,
    ...(shadowParts.length ? { textShadow: shadowParts.join(", ") } : {}),
  };
  const backgroundOpacity = Math.max(0, Math.min(100, bgOpacity ?? 0)) / 100;
  const tickerBackground = bgColor ? normalizeColorWithAlpha(bgColor, backgroundOpacity) : "";
  const tickerContainerStyle: React.CSSProperties = {
    fontSize,
    width: "100%",
    ...(tickerBackground
      ? {
          background: tickerBackground,
          borderRadius: 8,
          padding: "0.12em 0.3em",
        }
      : {}),
  };
  const amountText = (d: { account: number; toon: number }) => {
    const f = (n: number) => {
      const base = full ? roundToThousand(n).toLocaleString(locale || "ko-KR") : formatManThousand(n);
      return unit ? `${base} ${unit}` : base;
    };
    const accountPart = d.account > 0 ? f(d.account) : "";
    const toonPart = d.toon > 0 ? `(${f(d.toon)})` : "";
    if (accountPart && toonPart) return `${accountPart} ${toonPart}`;
    return accountPart || toonPart || "0";
  };
  if (!recent.length) {
    if (!shouldShowGuide) return null;
    return (
      <div className="overflow-hidden whitespace-nowrap" style={tickerContainerStyle}>
        <div className={theme.tickerCls} style={{ ...tickerThemeStyle, ...(color ? { color } : {}) }}>
          {placeholderText || "후원티커는 이곳에 출력됩니다."}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden whitespace-nowrap" style={tickerContainerStyle}>
      <div
        className="inline-block"
        style={{
          ...tickerThemeStyle,
          ...(color ? { color } : {}),
          animation: `ticker ${Math.max(10, duration || 60)}s linear infinite`,
        }}
      >
        {stream.map((d, i) => (
          <span
            key={`${d.name}-${d.at}-${i}`}
            className={theme.tickerCls}
            style={{ marginLeft: gap ?? 10, marginRight: gap ?? 10, ...(color ? { color } : {}) }}
          >
            ♥ {d.name} {amountText(d)}
          </span>
        ))}
        {stream.map((d, i) => (
          <span
            key={`dup-${d.name}-${d.at}-${i}`}
            className={theme.tickerCls}
            style={{ marginLeft: gap ?? 10, marginRight: gap ?? 10, ...(color ? { color } : {}) }}
          >
            ♥ {d.name} {amountText(d)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timer({
  elapsed,
  fontSize,
  fontColor,
  bgColor,
  borderColor,
  bgOpacity,
}: {
  elapsed: string | null;
  fontSize: number;
  fontColor?: string;
  bgColor?: string;
  borderColor?: string;
  bgOpacity?: number;
}) {
  if (!elapsed) return null;
  const hasCustomFontColor = Boolean(fontColor && fontColor.trim());
  return (
    <div
      className="inline-flex min-w-[4.5ch] items-center justify-center rounded-full px-4 py-1.5 backdrop-blur-md"
      style={{
        borderColor: borderColor || "rgba(255,255,255,0.2)",
        borderWidth: 1,
        borderStyle: "solid",
        backgroundColor: bgColor || `rgba(255,255,255,${Math.max(0, Math.min(100, bgOpacity ?? 40)) / 100})`,
      }}
      suppressHydrationWarning
    >
      <span
        className={`font-mono font-bold tabular-nums ${hasCustomFontColor ? "" : "text-pastel-ink"}`}
        style={{
          fontSize,
          lineHeight: 1.1,
          color: hasCustomFontColor ? fontColor : undefined,
        }}
      >
        {elapsed}
      </span>
    </div>
  );
}

function OverlayInner() {
  const rawSp = useSearchParams();
  const rawUserId = (rawSp.get("u") || "").trim();
  const userId = rawUserId || "finalent";
  const snapKey = (rawSp.get("snapKey") || "").trim();
  const snap = tryReadSnapshotFromStorage(snapKey || null) || tryDecodeSnapshot(rawSp.get("snap"));
  const { state: remoteState, ready: remoteReady } = useRemoteState(userId);
  const s = snap || remoteState;
  const ready = !!snap || remoteReady;
  const [localPresets, setLocalPresets] = useState<OverlayPresetLike[]>([]);
  const readLocalPresets = () => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("excel-broadcast-overlay-presets");
      if (!raw) {
        setLocalPresets([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setLocalPresets(parsed as OverlayPresetLike[]);
    } catch {
      setLocalPresets([]);
    }
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    readLocalPresets();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "excel-broadcast-overlay-presets") readLocalPresets();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const membersRemote = useMemo(() => ensureMembers(ready && s ? s.members : []), [ready, s]);
  const donorsRemote = useMemo(() => (ready && s ? s.donors : []), [ready, s]);
  const missions = useMemo(() => {
    const raw = ready && s ? (s.missions || []) : [];
    const base = ensureMissionItems(raw);
    if (base.length > 0) return base;
    const spLocal = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const preview = spLocal.get("previewGuide") === "true";
    const pId = (spLocal.get("p") || "").trim();
    let showMissionEffective = (spLocal.get("showMission") || "").toLowerCase() === "true";
    if (!showMissionEffective && s) {
      const presets = (s as any).overlayPresets || [];
      let active: any = null;
      if (pId) active = presets.find((x: any) => x.id === pId) || null;
      if (!active) {
        const prefId = (s as any).overlaySettings?.currentPresetId;
        if (prefId) active = presets.find((x: any) => x.id === prefId) || null;
        if (!active && Array.isArray(presets) && presets.length) active = presets[0];
      }
      showMissionEffective = Boolean(active?.showMission);
    }
    // 관리자 프리뷰(iframe)에서만 미션이 비었을 때 예시 표시
    if (preview) showMissionEffective = true;
    if (showMissionEffective && preview) {
      return [
        { id: "mis_ph_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
        { id: "mis_ph_2", title: "즉흥 노래 한 곡", price: "3만" },
        { id: "mis_ph_3", title: "게임 미션 클리어 도전", price: "5만" },
      ] as MissionItem[];
    }
    return base;
  }, [ready, s]);
  const overlayPresets = useMemo(() => {
    const remote = ready && s && Array.isArray(s.overlayPresets) ? (s.overlayPresets as OverlayPresetLike[]) : [];
    return remote.length > 0 ? remote : localPresets;
  }, [ready, s, localPresets]);
  const sumAccount = useMemo(() => (ready && s ? totalAccount(s) : 0), [ready, s]);
  const sumToon = useMemo(() => (ready && s ? totalToon(s) : 0), [ready, s]);
  const sumCombined = useMemo(() => (ready && s ? totalCombined(s) : 0), [ready, s]);
  const rounded = useMemo(() => roundToThousand(sumCombined), [sumCombined]);
  const memberPositionsMap = useMemo<Record<string, string>>(
    () => ((ready && s && typeof (s as AppState).memberPositions === "object") ? ((s as AppState).memberPositions || {}) : {}),
    [ready, s]
  );
  const memberPositionMode = useMemo<"fixed" | "rankLinked">(
    () => ((ready && s && (s as AppState).memberPositionMode === "rankLinked") ? "rankLinked" : "fixed"),
    [ready, s]
  );
  const rankPositionLabels = useMemo<string[]>(
    () => ((ready && s && Array.isArray((s as AppState).rankPositionLabels)) ? (s as AppState).rankPositionLabels : []),
    [ready, s]
  );
  const displaySum = useCountUp(rounded, 800);
  const presetId = (rawSp.get("p") || "").trim();
  const activePreset = useMemo(() => {
    if (presetId) return overlayPresets.find((x) => x.id === presetId) || null;
    const preferredId = ready && s && (s as any).overlaySettings?.currentPresetId;
    if (preferredId) {
      const byPreferred = overlayPresets.find((x) => x.id === preferredId);
      if (byPreferred) return byPreferred;
    }
    return overlayPresets.length ? overlayPresets[0] : null;
  }, [presetId, overlayPresets, ready, s]);
  const presetParams = useMemo(() => presetToParams(activePreset), [activePreset]);
  const sp = useMemo(
    () => ({
      get: (key: string) => {
        const direct = rawSp.get(key);
        if (direct !== null && direct !== "") return direct;
        return presetParams.get(key);
      },
    }),
    [rawSp, presetParams, presetId]
  );
  const demoMode = ((sp.get("demo") || "").toLowerCase() === "true") || ((sp.get("test") || "").toLowerCase() === "true");
  useEffect(() => {
    let cancelled = false;
    const needFetch = presetId && (!activePreset || (overlayPresets.length === 0 && localPresets.length === 0));
    if (!needFetch) return;
    const q = new URLSearchParams();
    q.set("user", userId);
    fetch(`/api/overlays?${q.toString()}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return;
        if (data && Array.isArray(data.overlayPresets)) {
          try { window.localStorage.setItem("excel-broadcast-overlay-presets", JSON.stringify(data.overlayPresets)); } catch {}
          setLocalPresets(data.overlayPresets as OverlayPresetLike[]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [presetId, userId, activePreset, overlayPresets.length, localPresets.length]);
  const parsePct = (raw: string | null, fallback: number) => {
    if (raw === null || raw.trim() === "") return fallback;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, n));
  };
  const fitWidthToViewport = (px: number, margin = 24) => `min(${Math.max(1, Math.round(px))}px, calc(100vw - ${margin}px))`;

  const compact = (sp.get("compact") || "false").toLowerCase() === "true";
  const autoFont = (sp.get("autoFont") || "false").toLowerCase() === "true";
  const tight = (sp.get("tight") || "false").toLowerCase() === "true";
  const verticalParam = (sp.get("vertical") || "false").toLowerCase() === "true";
  const [isVertical, setIsVertical] = useState(verticalParam);
  useEffect(() => {
    if (verticalParam) { setIsVertical(true); return; }
    const check = () => setIsVertical(typeof window !== "undefined" && window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [verticalParam]);
  const fitBase = Math.max(240, Math.min(1600, parseInt(sp.get("fitBase") || (isVertical ? "400" : "480"), 10)));
  const fitMinMember = Math.max(8, Math.min(40, parseInt(sp.get("fitMinMember") || (isVertical ? "22" : "10"), 10)));
  const fitMaxMember = Math.max(fitMinMember, Math.min(80, parseInt(sp.get("fitMaxMember") || (isVertical ? "44" : "24"), 10)));
  const scale = Math.max(0.5, Math.min(4, parseFloat(sp.get("scale") || (isVertical ? "1" : (compact ? "0.9" : "1.1")))));
  const hasExplicitScale = sp.get("scale") !== null;
  const memberSize = Math.max(10, Math.min(80, parseInt(sp.get("memberSize") || (compact ? "16" : (isVertical ? "40" : "24")), 10)));
  const totalSize = Math.max(14, Math.min(160, parseInt(sp.get("totalSize") || (isVertical ? "48" : "30"), 10)));
  const dense = (sp.get("dense") || "false").toLowerCase() === "true";
  const layoutMode = (sp.get("layout") || "center-fixed").toLowerCase();
  const centerFixed = layoutMode === "center-fixed" || layoutMode === "center";
  const anchor = centerFixed ? "cc" : (sp.get("anchor") || "cc").toLowerCase();
  const tableFree = (sp.get("tableFree") || "false").toLowerCase() === "true";
  const tableXParam = sp.get("tableX");
  const tableYParam = sp.get("tableY");
  const hasTableFreePos = centerFixed ? false : (tableFree || (tableXParam !== null && tableYParam !== null));
  const tableMarginTop = parseInt(sp.get("tableMarginTop") || "0", 10) || 0;
  const tableMarginRight = parseInt(sp.get("tableMarginRight") || "0", 10) || 0;
  const tableMarginBottom = parseInt(sp.get("tableMarginBottom") || "0", 10) || 0;
  const tableMarginLeft = parseInt(sp.get("tableMarginLeft") || "0", 10) || 0;
  const sumAnchor = (sp.get("sumAnchor") || "bc").toLowerCase();
  const sumXParam = sp.get("sumX");
  const sumYParam = sp.get("sumY");
  const hasFreePos = centerFixed ? false : (sumXParam !== null && sumYParam !== null);
  const sumX = hasFreePos ? parsePct(sumXParam, 50) : 0;
  const sumY = hasFreePos ? parsePct(sumYParam, 90) : 0;
  const themeId: ThemeId = "default";
  const baseTheme = THEMES.default;
  const totalHeaderLabel = "합계";
  const resolveThemeId = (key: string): ThemeId => {
    const raw = (sp.get(key) || "auto").trim();
    if (raw === "auto" || !raw) return "default";
    return "default";
  };
  const membersThemeId = resolveThemeId("membersTheme");
  const totalThemeId = resolveThemeId("totalTheme");
  const tickerBaseThemeId = resolveThemeId("tickerBaseTheme");
  const missionThemeId = resolveThemeId("missionTheme");
  const membersTheme = THEMES[membersThemeId];
  const totalTheme = THEMES[totalThemeId];
  const tickerBaseTheme = THEMES[tickerBaseThemeId];
  const missionTheme = THEMES[missionThemeId];
  const missionThemeVariant = (() => {
    const excelThemes = ["excel", "excelBlue", "excelSlate", "excelAmber", "excelRose", "excelNavy", "excelTeal", "excelPurple", "excelEmerald", "excelOrange", "excelIndigo"];
    return excelThemes.includes(missionThemeId) ? "excel" : (["rainbow", "sunset", "ocean", "forest", "aurora", "violet", "coral", "mint", "lava", "ice"].includes(missionThemeId) ? "neon" : missionThemeId);
  })() as "default" | "excel" | "neon" | "retro" | "minimal" | "rpg" | "pastel" | "neonExcel";

  const timerTypeRaw = (
    sp.get("timerType") ||
    sp.get("timertype") ||
    sp.get("timer") ||
    sp.get("type") ||
    ""
  ).trim();
  const timerOnlyMode = Boolean(timerTypeRaw);
  const timerType = useMemo<"general" | null>(() => {
    if (!timerTypeRaw) return null;
    const normalized = timerTypeRaw.toLowerCase();
    if (normalized === "general" || normalized === "generaltimer" || normalized === "timer") return "general";
    return null;
  }, [timerTypeRaw]);
  const tableOnly = timerOnlyMode ? false : (sp.get("tableOnly") === "true");
  const showGoalRequested = (() => {
    const raw = sp.get("showGoal");
    if (raw === "true") return true;
    if (raw === "false") return false;
    return Boolean(activePreset?.showGoal);
  })();
  // tableOnly가 켜져 있어도 목표바를 명시적으로 켠 프리셋/URL에서는 목표바를 우선한다.
  const effectiveTableOnly = tableOnly && !showGoalRequested;
  const showMembers = effectiveTableOnly ? true : (timerOnlyMode ? false : (sp.get("showMembers") !== "false"));
  const showTotal = effectiveTableOnly ? true : (timerOnlyMode ? false : (sp.get("showTotal") !== "false"));
  const showGoal = (() => {
    if (effectiveTableOnly) return false;
    const raw = sp.get("showGoal");
    if (timerOnlyMode) return raw === "true";
    if (raw === "true") return true;
    if (raw === "false") return false;
    // URL에 설정이 없으면 프리셋 값을 따름
    return Boolean(activePreset?.showGoal);
  })();
  const showTicker = false;
  const tickerInMembers = false;
  const tickerInPersonalGoal = false;
  const tickerInGoal = false;
  const hasContextTicker = false;
  const showTimerRaw = (sp.get("showTimer") || "").toLowerCase();
  const showTimer = effectiveTableOnly ? false : (timerOnlyMode ? showTimerRaw !== "false" : showTimerRaw === "true");
  const goal = useMemo(() => {
    const fromUrl = parseInt(sp.get("goal") || "0", 10);
    if (Number.isFinite(fromUrl) && fromUrl > 0) return fromUrl;
    const fromPreset = Number((activePreset as any)?.goal || 0);
    if (Number.isFinite(fromPreset) && fromPreset > 0) return Math.floor(fromPreset);
    return 0;
  }, [sp, activePreset]);
  const goalLabel = (sp.get("goalLabel") || (activePreset as any)?.goalLabel || "후원").trim();
  const goalWidth = useMemo(() => {
    const fromUrl = parseInt(sp.get("goalWidth") || "0", 10);
    if (Number.isFinite(fromUrl) && fromUrl > 0) return Math.max(200, Math.min(800, fromUrl));
    const fromPreset = Number((activePreset as any)?.goalWidth || 0);
    if (Number.isFinite(fromPreset) && fromPreset > 0) return Math.max(200, Math.min(800, Math.floor(fromPreset)));
    return 400;
  }, [sp, activePreset]);
  const goalAnchor = (sp.get("goalAnchor") || "bc").toLowerCase();
  const personalGoalAnchor = (sp.get("personalGoalAnchor") || "tl").toLowerCase();
  const personalGoalLimit = Math.max(1, Math.min(12, parseInt(sp.get("personalGoalLimit") || "3", 10)));
  const personalGoalTheme = (sp.get("personalGoalTheme") || "goalClassic") as "goalClassic" | "goalNeon";
  const personalGoalFree = (sp.get("personalGoalFree") || "false").toLowerCase() === "true";
  const personalGoalXParam = sp.get("personalGoalX");
  const personalGoalYParam = sp.get("personalGoalY");
  const hasPersonalGoalFreePos = centerFixed ? false : (personalGoalFree || (personalGoalXParam !== null && personalGoalYParam !== null));
  const personalGoalX = hasPersonalGoalFreePos ? parsePct(personalGoalXParam, 78) : 0;
  const personalGoalY = hasPersonalGoalFreePos ? parsePct(personalGoalYParam, 82) : 0;
  const goalCurrent = useMemo(() => {
    const fromUrlRaw = sp.get("goalCurrent");
    if (fromUrlRaw !== null) {
      const fromUrl = parseInt(fromUrlRaw || "0", 10);
      return Math.max(0, Number.isFinite(fromUrl) ? fromUrl : 0);
    }
    const fromPreset = Number((activePreset as any)?.goalCurrent || NaN);
    if (Number.isFinite(fromPreset) && fromPreset >= 0) return Math.floor(fromPreset);
    return null;
  }, [sp, activePreset]);
  const timerStart = sp.get("timerStart") ? parseInt(sp.get("timerStart")!, 10) : null;
  const timerAnchorParam = (sp.get("timerAnchor") || "").trim().toLowerCase();
  const timerAnchor = timerAnchorParam || (timerOnlyMode ? "cc" : "tr");
  const tickerAnchor = (sp.get("tickerAnchor") || "bc").toLowerCase();
  const tickerWidth = Math.max(200, Math.min(1200, parseInt(sp.get("tickerWidth") || "600", 10)));
  const tickerXParam = sp.get("tickerX");
  const tickerYParam = sp.get("tickerY");
  const hasTickerFreePos = centerFixed ? false : (tickerXParam !== null && tickerYParam !== null);
  const tickerX = hasTickerFreePos ? parsePct(tickerXParam, 50) : 0;
  const tickerY = hasTickerFreePos ? parsePct(tickerYParam, 86) : 0;
  const showMission = (() => {
    if (effectiveTableOnly) return false;
    if (timerOnlyMode) return sp.get("showMission") === "true";
    const raw = sp.get("showMission");
    if (raw === "true") return true;
    if (raw === "false") return false;
    // URL에 설정이 없으면 프리셋 값을 따름(프리뷰/외부 호스트 모두)
    return Boolean(activePreset?.showMission);
  })();
  // 미션 관련 세부 옵션은 외부 호스트 여부에 따라 프리셋 또는 URL에서 해석
  const confettiMilestoneMan = (() => {
    const raw = (sp.get("confettiMilestone") || "").trim();
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(1000, n)) : 0;
  })();

  const resolvedTimerType = useMemo<"general" | null>(() => {
    if (timerType) return timerType;
    return timerOnlyMode ? "general" : null;
  }, [timerOnlyMode, timerType]);
  const timerFromState = useMemo(() => {
    if (!s) return null;
    if (!resolvedTimerType) return null;
    return s.generalTimer;
  }, [resolvedTimerType, s]);
  const timerStyleFromState = useMemo(() => {
    if (!s || !resolvedTimerType) return null;
    return s.timerDisplayStyles?.[resolvedTimerType] || null;
  }, [resolvedTimerType, s]);
  const timerShowHoursRaw = (sp.get("timerShowHours") || "").toLowerCase();
  const timerShowHours = timerShowHoursRaw
    ? timerShowHoursRaw === "true"
    : (timerStyleFromState?.showHours ?? !timerOnlyMode);
  const timerFontColor = (sp.get("timerFontColor") || "").trim() || timerStyleFromState?.fontColor || undefined;
  const timerBgColor = (sp.get("timerBgColor") || "").trim() || timerStyleFromState?.bgColor || undefined;
  const timerBorderColor = (sp.get("timerBorderColor") || "").trim() || timerStyleFromState?.borderColor || undefined;
  const timerBgOpacity = (() => {
    const raw = (sp.get("timerBgOpacity") || "").trim();
    if (!raw) return timerStyleFromState?.bgOpacity ?? 40;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : (timerStyleFromState?.bgOpacity ?? 40);
  })();
  const timerScalePercent = (() => {
    const raw = (sp.get("timerScale") || "").trim();
    if (!raw) return timerStyleFromState?.scalePercent ?? 100;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(50, Math.min(250, n)) : (timerStyleFromState?.scalePercent ?? 100);
  })();
  const timerBaseFontSize = timerOnlyMode ? 56 : Math.max(28, Math.round(memberSize * 1.45));
  const timerFontSize = Math.max(14, Math.round(timerBaseFontSize * (timerScalePercent / 100)));
  const matchTimerAllowed = useMemo(() => {
    if (!s?.matchTimerEnabled) return true;
    return s.matchTimerEnabled.general;
  }, [s]);
  const effectiveTimerAllowed = timerOnlyMode ? true : matchTimerAllowed;
  const serverTimer = useServerTimer(timerFromState);
  const elapsed = useElapsed(timerStart);
  const timerBaseText = serverTimer.text || elapsed || (timerOnlyMode ? "00:00:00" : null);
  const timerText = formatTimerText(timerBaseText, serverTimer.remainingSeconds, timerShowHours);

  const nameCh = Math.max(6, Math.min(40, parseInt(sp.get("nameCh") || (compact ? "10" : (isVertical ? "14" : "12")), 10)));
  const nameGrow = (sp.get("nameGrow") || "true").toLowerCase() === "true";
  const currencyFull = (sp.get("currencyFull") || "false").toLowerCase() === "true";
  const nameMaxCh = Math.max(nameCh, Math.min(80, parseInt(sp.get("nameMaxCh") || String(nameCh + 8), 10)));
  const fullAmountMode = sp.get("donorsFormat") === "full" || currencyFull;
  const defBankCh = (sp.get("bankCh") && parseInt(sp.get("bankCh")!, 10)) || (fullAmountMode ? (compact ? 9 : 11) : (compact ? 4 : 5));
  const defToonCh = (sp.get("toonCh") && parseInt(sp.get("toonCh")!, 10)) || (fullAmountMode ? (compact ? 9 : 11) : (compact ? 4 : 5));
  const defTotalCh = (sp.get("totalCh") && parseInt(sp.get("totalCh")!, 10)) || (fullAmountMode ? (compact ? 7 : 8) : (compact ? 5 : 6));
  const defContributionCh = (sp.get("contributionCh") && parseInt(sp.get("contributionCh")!, 10)) || (fullAmountMode ? (compact ? 7 : 8) : (compact ? 5 : 6));
  const bankCh = Math.max(3, Math.min(12, defBankCh));
  const toonCh = Math.max(4, Math.min(12, defToonCh));
  const totalCh = Math.max(4, Math.min(10, defTotalCh));
  const contributionCh = Math.max(4, Math.min(10, defContributionCh));
  const showSideDonors = false;
  const donorsSide = (sp.get("donorsSide") || "right").toLowerCase();
  const donorsWidth = Math.max(120, Math.min(600, parseInt(sp.get("donorsWidth") || "220", 10)));
  const donorsSize = Math.max(10, Math.min(60, parseInt(sp.get("donorsSize") || String(Math.round(memberSize * 0.9)), 10)));
  const donorsColor = sp.get("donorsColor") || undefined;
  const donorsBgColor = sp.get("donorsBgColor") || undefined;
  const accountColor = sp.get("accountColor") || undefined;
  const toonColor = sp.get("toonColor") || undefined;
  const donorsBgOpacity = Math.max(0, Math.min(100, parseInt(sp.get("donorsBgOpacity") || "0", 10)));
  const showBottomDonors = false;
  const effectiveShowTicker = false;
  const donorsGap = Math.max(0, Math.min(48, parseInt(sp.get("donorsGap") || (tight ? "8" : "16"), 10)));
  const donorsSpeed = Math.max(10, Math.min(7200, parseFloat(sp.get("donorsSpeed") || "60"))); // seconds per loop (기본 60초, 최대 2시간)
  const donorsLimit = Math.max(1, Math.min(50, parseInt(sp.get("donorsLimit") || "8", 10)));
  const donorsFormat = sp.get("donorsFormat") === "full" ? "full" : "short"; // only full|short
  const donorsUnit = sp.get("donorsUnit") || sp.get("currencyUnit") || "";
  const currencyLocale = sp.get("currencyLocale") || "ko-KR";
  const previewGuide = sp.get("previewGuide") === "true";
  const tickerThemeCfg = sp.get("tickerTheme") || "auto";
  const tickerGlowCfg = Math.max(0, Math.min(100, parseInt(sp.get("tickerGlow") || "45", 10)));
  const tickerShadowCfg = Math.max(0, Math.min(100, parseInt(sp.get("tickerShadow") || "35", 10)));
  const tableBgOpacity = (() => {
    const rawUrl = (sp.get("tableBgOpacity") || "").trim();
    const rawPreset = String((activePreset as any)?.tableBgOpacity || "").trim();
    const raw = rawUrl || rawPreset;
    if (!raw) {
      const neonThemes = ["rainbow", "sunset", "ocean", "forest", "aurora", "violet", "coral", "mint", "lava", "ice"];
      return neonThemes.includes(membersThemeId) ? 92 : 100;
    }
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
  })();
  const goalOpacity = (() => {
    const rawUrl = (sp.get("goalOpacity") || "").trim();
    const rawPreset = String((activePreset as any)?.goalOpacity || "").trim();
    const raw = rawUrl || rawPreset;
    if (!raw) return tableBgOpacity;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : tableBgOpacity;
  })();
  const tableBgGifUrl = ((sp.get("tableBgGifUrl") || "").trim() || String((activePreset as any)?.tableBgGifUrl || "").trim());
  const tableBgGifOpacity = (() => {
    const rawUrl = (sp.get("tableBgGifOpacity") || "").trim();
    const rawPreset = String((activePreset as any)?.tableBgGifOpacity || "").trim();
    const raw = rawUrl || rawPreset;
    if (!raw) return 45;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 45;
  })();
  const showTableBgGif = Boolean(tableBgGifUrl);
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__overlayTickerConfig = {
      previewGuide,
      tickerTheme: tickerThemeCfg,
      tickerGlow: tickerGlowCfg,
      tickerShadow: tickerShadowCfg,
    };
  }, [previewGuide, tickerThemeCfg, tickerGlowCfg, tickerShadowCfg]);
  // Keep member/total amount format aligned with donor ticker format.
  const fmt = (n: number) =>
    donorsFormat === "full"
      ? roundToThousand(n).toLocaleString(currencyLocale)
      : formatManThousand(n);
  const fmtTotalCell = (n: number) => fmt(n);
  const stripBg = (cls: string) =>
    cls
      // Remove any solid bg-* utilities
      .replace(/\bbg-[^\s]+/g, "bg-transparent")
      // Remove gradient-related utilities so they don't apply per-cell
      .replace(/\bbg-gradient-[^\s]+/g, "")
      .replace(/\bfrom-[^\s]+/g, "")
      .replace(/\bvia-[^\s]+/g, "")
      .replace(/\bto-[^\s]+/g, "");
  const stripBorder = (cls: string) =>
    cls
      .replace(/\bborder(?:-[trblxy])?(?:-[^\s]+)?/g, "")
      .replace(/\brounded(?:-[^\s]+)?/g, "")
      .replace(/\bshadow(?:-[^\s]+)?/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const useTableOpacity = tableBgOpacity < 100;
  const effectiveTableCls = useTableOpacity ? stripBg(membersTheme.tableCls) : membersTheme.tableCls;
  // Always remove per-cell gradients/backgrounds for cleaner unified look
  const effectiveRowCls = stripBg(membersTheme.rowCls);
  const effectiveHeaderCls = stripBg(membersTheme.headerCls);
  const effectiveTotalWrapCls = stripBorder(stripBg(totalTheme.totalWrapCls));
  const lockWidth = (sp.get("lockWidth") || "false").toLowerCase() === "true";
  const effectiveNameGrow = lockWidth ? false : nameGrow;
  const scaledMainStyle: React.CSSProperties = {};
  const BASE_W = isVertical ? 1080 : 1920;
  const BASE_H = isVertical ? 1920 : 1080;
  const renderW = sp.get("renderWidth") ? parseInt(sp.get("renderWidth")!, 10) : null;
  const renderH = sp.get("renderHeight") ? parseInt(sp.get("renderHeight")!, 10) : null;
  const isPreviewGuide = sp.get("previewGuide") === "true";
  const autoFit = (sp.get("autoFit") || "none").toLowerCase() as "none" | "width" | "height" | "contain" | "cover";
  const zoomMode = ((sp.get("zoomMode") || "follow").toLowerCase() as "follow" | "invert" | "neutral");
  const hostParam = (sp.get("host") || "").toLowerCase();
  const externalHost = hostParam === "prism" || hostParam === "obs" || hostParam === "external";
  const fitPin = centerFixed ? "cc" : ((sp.get("fitPin") || "cc").toLowerCase() as "cc" | "tl" | "tr" | "bl" | "br" | "tc" | "bc" | "cl" | "cr");
  const showGuide = (sp.get("guide") || "false").toLowerCase() === "true";
  const boxMode = (sp.get("box") || "full").toLowerCase() as "full" | "tight";
  const noCrop = (sp.get("noCrop") || "true").toLowerCase() !== "false";
  const useRenderDims = isPreviewGuide && Number.isFinite(renderW) && Number.isFinite(renderH) && renderW! > 0 && renderH! > 0;
  const [viewportScale, setViewportScale] = useState(1);
  const [containLimitScale, setContainLimitScale] = useState(1);
  const baseViewportRef = useRef<{ w: number; h: number } | null>(null);
  const [centerZoomScale, setCenterZoomScale] = useState(1);
  useEffect(() => {
    if (!centerFixed) { setCenterZoomScale(1); return; }
    if (typeof window === "undefined") return;
    if (!baseViewportRef.current) {
      baseViewportRef.current = { w: window.innerWidth, h: window.innerHeight };
    }
    const update = () => {
      const vv: any = (window as any).visualViewport;
      let s = 1;
      if (vv && typeof vv.scale === "number") {
        s = vv.scale || 1;
      } else {
        const b = baseViewportRef.current!;
        const sx = window.innerWidth / Math.max(1, b.w);
        const sy = window.innerHeight / Math.max(1, b.h);
        s = Math.min(sx, sy);
      }
      setCenterZoomScale(Math.max(0.1, Math.min(8, s)));
    };
    update();
    const vv: any = (window as any).visualViewport;
    vv?.addEventListener?.("resize", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener?.("resize", update);
      window.removeEventListener("resize", update);
    };
  }, [centerFixed]);
  // 외부 호스트 판단 이후에 미션 옵션을 계산
  const missionAnchor = (externalHost && activePreset?.missionAnchor)
    ? String(activePreset.missionAnchor).toLowerCase()
    : (sp.get("missionAnchor") || "bc").toLowerCase();
  const missionWidth = Math.max(
    400,
    Math.min(
      1600,
      parseInt(
        (externalHost && activePreset?.missionWidth)
          ? String(activePreset.missionWidth)
          : (sp.get("missionWidth") || "800"),
        10,
      ),
    ),
  );
  const missionDuration = Math.max(
    15,
    Math.min(
      60,
      parseInt(
        (externalHost && activePreset?.missionDuration)
          ? String(activePreset.missionDuration)
          : (sp.get("missionDuration") || "25"),
        10,
      ),
    ),
  );
  const missionFontSize = Math.max(
    10,
    Math.min(
      80,
      parseInt(
        (externalHost && activePreset?.missionFontSize)
          ? String(activePreset.missionFontSize)
          : (sp.get("missionFontSize") || "18"),
        10,
      ),
    ),
  );
  const missionBgOpacityCfg = Math.max(
    0,
    Math.min(
      100,
      parseInt(
        (externalHost && activePreset?.missionBgOpacity)
          ? String(activePreset.missionBgOpacity)
          : (sp.get("missionBgOpacity") || "85"),
        10,
      ),
    ),
  );
  const missionBgColorCfg =
    ((externalHost && activePreset?.missionBgColor)
      ? String(activePreset.missionBgColor)
      : (sp.get("missionBgColor") || "")).trim() || undefined;
  const missionItemColorCfg =
    ((externalHost && activePreset?.missionItemColor)
      ? String(activePreset.missionItemColor)
      : (sp.get("missionItemColor") || "")).trim() || undefined;
  const missionTitleColorCfg =
    ((externalHost && activePreset?.missionTitleColor)
      ? String(activePreset.missionTitleColor)
      : (sp.get("missionTitleColor") || "")).trim() || undefined;
  const missionTitleTextCfg =
    ((externalHost && (activePreset as any)?.missionTitleText)
      ? String((activePreset as any).missionTitleText)
      : (sp.get("missionTitleText") || "")).trim() || "MISSION";
  const missionTitleEffectCfg = (
    (externalHost && (activePreset as any)?.missionTitleEffect)
      ? String((activePreset as any).missionTitleEffect)
      : (sp.get("missionTitleEffect") || "none")
  ) as "none" | "blink" | "pulse" | "glow" | "sparkle" | "gradient" | "rainbow" | "shadow";
  const missionEffectCfg = (
    (externalHost && (activePreset as any)?.missionEffect)
      ? String((activePreset as any).missionEffect)
      : (sp.get("missionEffect") || "none")
  ) as "none" | "blink" | "pulse" | "glow";
  const missionEffectHotOnlyCfg = (
    (externalHost && (activePreset as any)?.missionEffectHotOnly)
      ? String((activePreset as any).missionEffectHotOnly) === "true"
      : (sp.get("missionEffectHotOnly") === "true")
  );
  const missionDisplayMode = (externalHost && (activePreset as any)?.missionDisplayMode)
    ? String((activePreset as any).missionDisplayMode)
    : ((sp.get("displayMode") || "horizontal") as "horizontal" | "vertical-slot");
  const missionVisibleCount = Math.max(
    1,
    Math.min(
      6,
      parseInt(
        (externalHost && (activePreset as any)?.missionVisibleCount)
          ? String((activePreset as any).missionVisibleCount)
          : (sp.get("visibleCount") || "3"),
        10,
      ),
    ),
  );
  const missionSpeedSec = Math.max(
    1,
    Math.min(
      120,
      parseFloat(
        (externalHost && (activePreset as any)?.missionSpeed)
          ? String((activePreset as any).missionSpeed)
          : (sp.get("missionSpeed") || (missionDisplayMode === "horizontal" ? "25" : "2")),
      ),
    ),
  );
  const missionGapSizePx = Math.max(
    0,
    Math.min(
      48,
      parseInt(
        (externalHost && (activePreset as any)?.missionGapSize)
          ? String((activePreset as any).missionGapSize)
          : (sp.get("gapSize") || "8"),
        10,
      ),
    ),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const enableAuto = ((isPreviewGuide && !centerFixed && !(tableFree || (tableXParam !== null && tableYParam !== null))) || autoFit !== "none");
    if (!enableAuto) { setViewportScale(1); return; }
    const update = () => {
      const w = useRenderDims ? renderW! : window.innerWidth;
      const h = useRenderDims ? renderH! : window.innerHeight;
      const sx = w / BASE_W;
      const sy = h / BASE_H;
      let s = 1;
      switch (autoFit) {
        case "width": s = sx; break;
        case "height": s = sy; break;
        case "cover": s = Math.max(sx, sy); break;
        case "contain": s = Math.min(sx, sy); break;
        default: s = Math.min(sx, sy); break;
      }
      s = Math.max(0.1, s);
      setViewportScale(s);
      setContainLimitScale(Math.max(0.1, Math.min(sx, sy)));
    };
    update();
    if (!useRenderDims) {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    return () => {};
  }, [isPreviewGuide, centerFixed, tableFree, tableXParam, tableYParam, autoFit, useRenderDims, renderW, renderH, BASE_W, BASE_H]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [contentW, setContentW] = useState<number>(BASE_W);
  const [contentH, setContentH] = useState<number>(BASE_H);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      setContentW(w);
      setContentH(h);
    };
    updateSize();
    const ro = new (window as any).ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [autoMemberSize, setAutoMemberSize] = useState(memberSize);
  const [autoTotalSize, setAutoTotalSize] = useState(totalSize);
  const [autoDonorSize, setAutoDonorSize] = useState(donorsSize);
  const tableBoxRef = useRef<HTMLDivElement | HTMLTableElement | null>(null);
  const [donorBoxWidth, setDonorBoxWidth] = useState<number | null>(null);
  const contextualTickerWidth = donorBoxWidth ? Math.max(donorBoxWidth, tickerWidth) : tickerWidth;
  useEffect(() => {
    if (!autoFont) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth || fitBase;
      const factor = width / fitBase;
      const m = Math.round(memberSize * factor);
      const t = Math.round(totalSize * factor);
      const d = Math.round(donorsSize * factor);
      setAutoMemberSize(Math.max(fitMinMember, Math.min(fitMaxMember, m)));
      setAutoTotalSize(Math.max(fitMinMember, Math.min(Math.max(fitMaxMember, 40), t)));
      setAutoDonorSize(Math.max(fitMinMember, Math.min(fitMaxMember, d)));
    };
    update();
    const ro = new (window as any).ResizeObserver(update);
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch {} };
  }, [autoFont, memberSize, totalSize, donorsSize, fitBase, fitMinMember, fitMaxMember]);
  const mSize = autoFont ? autoMemberSize : memberSize;
  const tSize = autoFont ? autoTotalSize : totalSize;
  const dSize = autoFont ? autoDonorSize : donorsSize;

  useEffect(() => {
    const el = tableBoxRef.current;
    if (!el) return;
    const update = () => setDonorBoxWidth(Math.round(el.getBoundingClientRect().width));
    update();
    const ro = new (window as any).ResizeObserver(update);
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch {} };
  }, [showMembers, themeId, mSize, nameCh, bankCh, toonCh, totalCh, lockWidth, effectiveNameGrow]);

  const members = useMemo(() => {
    if (demoMode) {
      return [
        { id: "demo-1", name: "멤버1", account: 320000, toon: 110000, contribution: 45000, goal: 700000, operating: false },
        { id: "demo-2", name: "멤버2", account: 240000, toon: 90000, contribution: 30000, goal: 650000, operating: false },
        { id: "demo-3", name: "멤버3", account: 170000, toon: 70000, contribution: 15000, goal: 500000, operating: false },
      ] as Member[];
    }
    const base = membersRemote;
    if (base.length > 0) return base;
    if ((!ready) && (isPreviewGuide || externalHost)) {
      return defaultState().members;
    }
    if ((isPreviewGuide || externalHost) && base.length === 0) {
      return defaultState().members;
    }
    return base;
  }, [demoMode, membersRemote, ready, isPreviewGuide, externalHost]);
  const sumContribution = useMemo(
    () => members.reduce((sum, m) => sum + Math.max(0, (m.account || 0) + (m.toon || 0)), 0),
    [members]
  );
  const donors = useMemo(() => {
    if (demoMode) {
      return [
        { id: "d1", name: "후원자A", amount: 120000, memberId: "demo-1", at: Date.now() - 120000, target: "account" },
        { id: "d2", name: "후원자B", amount: 90000, memberId: "demo-2", at: Date.now() - 90000, target: "toon" },
        { id: "d3", name: "후원자C", amount: 70000, memberId: "demo-3", at: Date.now() - 60000, target: "account" },
      ] as Donor[];
    }
    return donorsRemote;
  }, [demoMode, donorsRemote]);
  const personalGoals = useMemo(() => {
    return members
      .filter((m) => (m.goal || 0) > 0)
      .map((m) => {
        const goal = Math.max(0, m.goal || 0);
        const current = Math.max(0, (m.account || 0) + (m.toon || 0));
        const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
        return { id: m.id, name: m.name, current, goal, pct };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, personalGoalLimit);
  }, [members, personalGoalLimit]);
  const liveGoalCurrent = useMemo(
    () => members.reduce((sum, m) => sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)), 0),
    [members]
  );
  const resolvedMemberRoles = useMemo<Record<string, string>>(() => {
    if (memberPositionMode !== "rankLinked") return memberPositionsMap;
    const roleMap: Record<string, string> = {};
    const representative = members.find((m) => (memberPositionsMap[m.id] || "").trim() === "대표") || null;
    const others = members
      .filter((m) => !representative || m.id !== representative.id)
      .sort((a, b) => ((b.account || 0) + (b.toon || 0)) - ((a.account || 0) + (a.toon || 0)));
    if (representative) roleMap[representative.id] = "대표";
    const startIdx = representative ? 1 : 0;
    others.forEach((m, idx) => {
      const rankIdx = idx + startIdx;
      const label = String(rankPositionLabels[rankIdx] || "").trim() || (rankIdx === 0 ? "대표" : "");
      if (label) roleMap[m.id] = label;
    });
    return roleMap;
  }, [memberPositionMode, memberPositionsMap, members, rankPositionLabels]);
  const getMemberRole = useCallback((m: Member) => resolvedMemberRoles[m.id] || "", [resolvedMemberRoles]);
  const pinnedFilter = (m: Member) => Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(getMemberRole(m));
  const showPersonalGoal = useMemo(() => {
    const raw = sp.get("showPersonalGoal");
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (timerOnlyMode) return false;
    const presetHas = typeof (activePreset as any)?.showPersonalGoal === "boolean";
    if (presetHas) return Boolean((activePreset as any).showPersonalGoal);
    if (isPreviewGuide || externalHost) return true;
    if (effectiveTableOnly) return false;
    return personalGoals.length > 0;
  }, [sp, timerOnlyMode, effectiveTableOnly, activePreset, personalGoals.length, isPreviewGuide, externalHost]);
  const fallbackShowGoal =
    !showMembers &&
    !showTotal &&
    !showGoal &&
    !showPersonalGoal &&
    !showTimer &&
    !showMission &&
    goal > 0;

  const unpinned = useMemo(() => members.filter((m) => !pinnedFilter(m)), [members]);
  const pinned = useMemo(() => members.filter(pinnedFilter), [members]);
  const hasRoleColumn = useMemo(
    () => members.some((m) => getMemberRole(m).trim().length > 0),
    [members, getMemberRole]
  );
  const ranked = useMemo(() => {
    const arr = [...unpinned].sort((a, b) => (b.account + b.toon) - (a.account + a.toon));
    let nextRank = 1;
    return arr.map((m) => {
      const role = getMemberRole(m).trim();
      if (role.includes("대표")) return { m, rank: null as number | null };
      const rank = nextRank;
      nextRank += 1;
      return { m, rank };
    });
  }, [unpinned, getMemberRole]);

  const allOrderKeys = [...ranked.map(({ m }) => m.id), ...pinned.map((m) => `${m.id}-p`)];
  const setRowRef = useFlip(allOrderKeys, 500);

  const prevTotalsRef = useRef<Map<string, number>>(new Map());
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const isInitialMount = useRef(true);
  useEffect(() => {
    const next = new Map<string, number>();
    const changed = new Set<string>();
    for (const m of members) {
      const total = (m.account || 0) + (m.toon || 0);
      const prev = prevTotalsRef.current.get(m.id);
      next.set(m.id, total);
      if (!isInitialMount.current && prev !== undefined && prev !== total) {
        changed.add(m.id);
      }
    }
    isInitialMount.current = false;
    prevTotalsRef.current = next;
    if (changed.size > 0) {
      setChangedIds(changed);
      const t = setTimeout(() => setChangedIds(new Set()), 800);
      return () => clearTimeout(t);
    }
  }, [members]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("overlay-page");
    body.classList.add("overlay-page");
    html.style.background = "transparent";
    body.style.background = "transparent";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.margin = "0";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    html.style.height = "100%";
    body.style.height = "100%";
    html.style.width = "100%";
    body.style.width = "100%";
    return () => {
      html.classList.remove("overlay-page");
      body.classList.remove("overlay-page");
      html.style.background = "";
      body.style.background = "";
      html.style.overflow = "";
      body.style.overflow = "";
      body.style.margin = "";
      html.style.overscrollBehavior = "";
      body.style.overscrollBehavior = "";
      html.style.height = "";
      body.style.height = "";
      html.style.width = "";
      body.style.width = "";
      body.classList.remove("overlay-vertical");
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isVertical) document.body.classList.add("overlay-vertical");
    else document.body.classList.remove("overlay-vertical");
    return () => document.body.classList.remove("overlay-vertical");
  }, [isVertical]);

  const confettiLastMilestoneRef = useRef<number>(0);
  useEffect(() => {
    if (confettiMilestoneMan <= 0) return;
    const milestoneWon = confettiMilestoneMan * 10000;
    const curr = Math.floor(rounded / milestoneWon);
    const prev = confettiLastMilestoneRef.current;
    if (curr > prev && prev >= 0) {
      confettiLastMilestoneRef.current = curr;
      import("canvas-confetti").then(({ default: confetti }) => {
        const count = 150;
        const defaults = { origin: { y: 0.6 }, zIndex: 9999 };
        function fire(particleRatio: number, opts: Record<string, unknown>) {
          confetti({ ...defaults, ...opts, particleCount: Math.floor(count * particleRatio) });
        }
        fire(0.25, { spread: 26, startVelocity: 55 });
        fire(0.2, { spread: 60 });
        fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
        fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
        fire(0.1, { spread: 120, startVelocity: 45 });
      });
    } else if (curr >= 0) {
      confettiLastMilestoneRef.current = curr;
    }
  }, [rounded, confettiMilestoneMan]);

  const posClass = (a: string) =>
    a === "cc" || a === "center" ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" :
    a === "tr" ? "top-4 right-4" :
    a === "bl" ? "bottom-4 left-4" :
    a === "br" ? "bottom-4 right-4" :
    a === "tc" ? "top-4 left-1/2 -translate-x-1/2" :
    a === "bc" ? "bottom-4 left-1/2 -translate-x-1/2" :
    "top-4 left-4";

  const listPosStyle: React.CSSProperties | undefined = hasTableFreePos
    ? { left: `${parsePct(tableXParam, 50)}%`, top: `${parsePct(tableYParam, 50)}%`, transform: "translate(-50%, -50%)" }
    : {
        marginTop: tableMarginTop,
        marginRight: tableMarginRight,
        marginBottom: tableMarginBottom,
        marginLeft: tableMarginLeft,
      };
  const listPosClass =
    centerFixed || previewGuide || hasTableFreePos ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" :
    anchor === "cc" || anchor === "center" ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" :
    anchor === "tc" ? "top-0 left-1/2 -translate-x-1/2" :
    anchor === "bc" ? "bottom-0 left-1/2 -translate-x-1/2" :
    anchor === "tr" ? "top-0 right-0 items-end text-right" :
    anchor === "bl" ? "bottom-0 left-0" :
    anchor === "br" ? "bottom-0 right-0 items-end text-right" :
    "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";

  const sumPosStyle: React.CSSProperties | undefined = hasFreePos
    ? { left: `${sumX}%`, top: `${sumY}%`, transform: "translate(-50%, -50%)" }
    : undefined;
  const sumPosClass = hasFreePos ? "" : posClass(sumAnchor);
  const personalGoalPosClass = posClass(personalGoalAnchor);
  const renderPersonalGoal = () => {
    const content = (
      <>
        <PersonalGoalBoard items={personalGoals} themeId={personalGoalTheme} fontSize={memberSize} />
      </>
    );
    if (hasPersonalGoalFreePos) {
      return (
        <div className="absolute inset-0 pointer-events-none z-[9985]">
          <div className="absolute pointer-events-auto" style={{ left: `${personalGoalX}%`, top: `${personalGoalY}%`, transform: "translate(-50%, -50%)" }}>
            {content}
          </div>
        </div>
      );
    }
    return <div className={`absolute ${personalGoalPosClass} z-[9985]`}>{content}</div>;
  };
  const responsiveTickerWidth = fitWidthToViewport(tickerWidth);
  const tickerPosStyle: React.CSSProperties | undefined = hasTickerFreePos
    ? { left: `${tickerX}%`, top: `${tickerY}%`, transform: "translate(-50%, -50%)", width: responsiveTickerWidth }
    : { width: responsiveTickerWidth };
  const tickerPosClass = hasTickerFreePos ? "" : posClass(tickerAnchor);

    const roleCh = Math.max(6, Math.min(14, members.reduce((max, m) => Math.max(max, getMemberRole(m).length), 2)));
    const excelGridCols = hasRoleColumn
      ? ["3ch", `${roleCh}ch`, `${nameCh}ch`, `${bankCh}ch`, `${toonCh}ch`, `${totalCh}ch`, `${contributionCh}ch`]
      : ["3ch", `${nameCh}ch`, `${bankCh}ch`, `${toonCh}ch`, `${totalCh}ch`, `${contributionCh}ch`];
    const columnGradients = hasRoleColumn
      ? [
          "rgba(255, 212, 231, 0.70)", // rank
          "rgba(255, 212, 231, 0.70)", // role
          "rgba(255, 212, 231, 0.70)", // name
          "rgba(255, 212, 231, 0.70)", // account
          "rgba(255, 212, 231, 0.70)", // toon
          "rgba(255, 212, 231, 0.70)", // total
          "rgba(255, 212, 231, 0.70)", // contribution
        ]
      : [
          "rgba(255, 212, 231, 0.70)", // rank
          "rgba(255, 212, 231, 0.70)", // name
          "rgba(255, 212, 231, 0.70)", // account
          "rgba(255, 212, 231, 0.70)", // toon
          "rgba(255, 212, 231, 0.70)", // total
          "rgba(255, 212, 231, 0.70)", // contribution
        ];
    let effectiveScale = centerFixed || hasTableFreePos
      ? (scale * (zoomMode === "neutral" ? 1 : (zoomMode === "invert" ? (1 / centerZoomScale) : centerZoomScale)))
      : (externalHost ? scale : (viewportScale * scale));
    if (noCrop && !hasExplicitScale) {
      effectiveScale = Math.min(effectiveScale, containLimitScale);
    }
    const justify =
      externalHost ? "center" :
      centerFixed ? "center" :
      fitPin === "tl" || fitPin === "cl" || fitPin === "bl" ? "flex-start" :
      fitPin === "tr" || fitPin === "cr" || fitPin === "br" ? "flex-end" :
      "center";
    const align =
      externalHost ? "center" :
      centerFixed ? "center" :
      fitPin === "tl" || fitPin === "tc" || fitPin === "tr" ? "flex-start" :
      fitPin === "bl" || fitPin === "bc" || fitPin === "br" ? "flex-end" :
      "center";
    const FIT_W = boxMode === "tight" ? Math.max(1, contentW) : BASE_W;
    const FIT_H = boxMode === "tight" ? Math.max(1, contentH) : BASE_H;
    const viewportWrapperStyle: React.CSSProperties = {
      position: "fixed",
      inset: 0,
      overflow: "hidden",
      display: "flex",
      alignItems: align as any,
      justifyContent: justify as any,
      width: "100%",
      height: "100%",
      background: "transparent",
    };
    const viewportInnerStyle: React.CSSProperties = {
      position: "relative",
      width: (centerFixed || externalHost) ? BASE_W : FIT_W,
      height: (centerFixed || externalHost) ? BASE_H : FIT_H,
      flexShrink: 0,
    };
    const origin = centerFixed ? "center center" :
      fitPin === "tl" ? "left top" :
      fitPin === "tr" ? "right top" :
      fitPin === "bl" ? "left bottom" :
      fitPin === "br" ? "right bottom" :
      fitPin === "tc" ? "center top" :
      fitPin === "bc" ? "center bottom" :
      fitPin === "cl" ? "left center" :
      fitPin === "cr" ? "right center" :
      "center center";
    const scaleStyleTag = (
      <style dangerouslySetInnerHTML={{ __html: `
        .overlay-route { transform: scale(${effectiveScale}) !important; -webkit-transform: scale(${effectiveScale}) !important; transform-origin: ${origin} !important; }
      ` }} />
    );
    const nameWrapCls = "truncate";
    const centerFixedStyle = centerFixed ? (
      <style dangerouslySetInnerHTML={{ __html: `
        html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
        .overlay-center-fixed .overlay-row td,
        .overlay-center-fixed thead td { font-size: min(${mSize}px, 18cqw) !important; min-height: ${Math.round(mSize * 1.5)}px !important; line-height: 1.2 !important; padding: ${Math.round(mSize * 0.25)}px ${Math.round(mSize * 0.4)}px !important; }
        .overlay-center-fixed .overlay-total-row td { font-size: min(${tSize}px, 20cqw) !important; min-height: ${Math.round(tSize * 1.5)}px !important; padding: ${Math.round(tSize * 0.2)}px ${Math.round(tSize * 0.3)}px !important; font-weight: 600 !important; }
        .overlay-center-fixed table { background: rgba(0,0,0,0.5) !important; }
        .overlay-center-fixed table td { container-type: inline-size; white-space: nowrap !important; overflow: hidden !important; }
      ` }} />
    ) : null;
    const colorOverrideStyle = (accountColor || toonColor) ? (
      <style dangerouslySetInnerHTML={{ __html: [
        accountColor && `.overlay-root .overlay-account-cell { color: ${accountColor} !important; }`,
        toonColor && `.overlay-root .overlay-toon-cell { color: ${toonColor} !important; }`,
      ].filter(Boolean).join("\n") }} />
    ) : null;
    const numericNoWrapStyle = (
      <style dangerouslySetInnerHTML={{ __html: `
        .overlay-root .overlay-account-cell,
        .overlay-root .overlay-toon-cell {
          white-space: nowrap !important;
          overflow: hidden !important;
          text-overflow: clip !important;
        }
      ` }} />
    );
    const tableVisualStyle = (
      <style dangerouslySetInnerHTML={{ __html: `
        .overlay-root .overlay-elegant-table {
          border-radius: 0 !important;
          overflow: hidden;
          border: 1px solid rgba(255, 236, 246, 0.72);
          box-shadow: 0 12px 24px rgba(118, 36, 79, 0.18), inset 0 1px 0 rgba(255,255,255,0.22);
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }
        .overlay-root .overlay-elegant-table td {
          color: #ffffff !important;
          transition: filter 180ms ease, transform 180ms ease, background-size 220ms ease;
          background: transparent !important;
          text-shadow: none !important;
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
        }
        .overlay-root .overlay-elegant-table thead td {
          color: #ffffff !important;
          text-shadow: 0 1px 0 rgba(20, 8, 14, 0.35);
          box-shadow: inset 0 -1px 0 rgba(255, 228, 244, 0.46), inset 0 1px 0 rgba(255,255,255,0.20);
        }
        .overlay-root .overlay-elegant-table td.overlay-col-total { color: #fff9f0 !important; }
        .overlay-root .overlay-elegant-table td.overlay-col-contribution { color: #fff7fa !important; }
        .overlay-root .overlay-elegant-table thead td.overlay-col-rank,
        .overlay-root .overlay-elegant-table thead td.overlay-col-role,
        .overlay-root .overlay-elegant-table thead td.overlay-col-name,
        .overlay-root .overlay-elegant-table thead td.overlay-col-account,
        .overlay-root .overlay-elegant-table thead td.overlay-col-toon,
        .overlay-root .overlay-elegant-table thead td.overlay-col-total,
        .overlay-root .overlay-elegant-table thead td.overlay-col-contribution {
          background: rgba(244, 170, 205, 0.92) !important;
        }
        .overlay-root .overlay-elegant-table tbody tr:hover td {
          filter: brightness(1.06) saturate(1.03);
          transform: scale(1.009);
        }
      ` }} />
    );
    return (
      <div style={viewportWrapperStyle} className={`overlay-root ${centerFixed ? "overlay-center-fixed" : ""}`}>
        {scaleStyleTag}
        {centerFixedStyle}
        {colorOverrideStyle}
        {numericNoWrapStyle}
        {tableVisualStyle}
        {showGuide && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 9998 }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "rgba(0,255,200,0.4)" }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 1, background: "rgba(0,255,200,0.2)" }} />
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 1, background: "rgba(0,255,200,0.2)" }} />
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 1, background: "rgba(0,255,200,0.2)" }} />
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(0,200,255,0.2)" }} />
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(0,200,255,0.2)" }} />
            <div style={{ position: "absolute", top: 8, left: 8, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
              GUIDE ON — autoFit={autoFit}
            </div>
          </div>
        )}
        <div style={viewportInnerStyle} className="overlay-route">
          <main className="transparent-bg no-select" style={{ ...scaledMainStyle, minHeight: FIT_H, width: FIT_W, background: "transparent" }}>
        {showMembers && (ready || isPreviewGuide || externalHost) && (
          <div className={`absolute ${listPosClass}`} style={{ maxWidth: FIT_W, maxHeight: FIT_H, ...listPosStyle }}>
            <div ref={containerRef} className="flex items-start gap-3" style={{ width: "fit-content", maxWidth: FIT_W }}>
              {showSideDonors && donorsSide === "left" && (
                <div style={{ width: donorsWidth }}>
                  <DonorTicker donors={donors} theme={tickerBaseTheme} fontSize={dSize} color={donorsColor} bgColor={donorsBgColor} bgOpacity={donorsBgOpacity} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                </div>
              )}
              <div
                className="relative overflow-hidden"
                style={{ borderRadius: 0 }}
              >
                {showTableBgGif ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={tableBgGifUrl}
                    alt=""
                    className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                    style={{ opacity: tableBgGifOpacity / 100 }}
                    loading="eager"
                    decoding="async"
                  />
                ) : null}
                <div className="relative z-[1]">
                {useTableOpacity ? (
                <div className="relative overflow-hidden" style={{ borderRadius: 0, backgroundColor: `rgba(${(TABLE_BG_RGB[themeId] || defaultTableBgRgb).join(",")}, ${tableBgOpacity / 100})` }}>
                    <table
                      ref={tableBoxRef as any}
                      className={`${effectiveTableCls} overlay-elegant-table${membersThemeId === "pastel" ? " pastel-member-table" : ""}`}
                      style={{ fontSize: mSize, borderSpacing: 0, tableLayout: "fixed" }}
                    >
                  <colgroup>
                    {excelGridCols.map((w, idx) => (
                      <col key={`excel-col-${idx}`} style={{ width: w, backgroundImage: columnGradients[idx], backgroundRepeat: "no-repeat", backgroundSize: "100% 100%" }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <td className={`${effectiveHeaderCls} overlay-col-rank overlay-rank-cell`}>순위</td>
                      {hasRoleColumn && <td className={`${effectiveHeaderCls} overlay-col-role`} style={{ whiteSpace: "nowrap" }}>직급</td>}
                      <td className={`${effectiveHeaderCls} overlay-col-name`}>이름</td>
                      <td className={`${effectiveHeaderCls} overlay-col-account text-right`}>계좌</td>
                      <td className={`${effectiveHeaderCls} overlay-col-toon text-right`}>투네</td>
                      <td className={`${effectiveHeaderCls} overlay-col-total text-right`}>{totalHeaderLabel}</td>
                      <td className={`${effectiveHeaderCls} overlay-col-contribution text-right`}>기여도</td>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map(({m, rank}) => (
                      <tr key={m.id} ref={setRowRef(m.id)} className={`overlay-row transition-transform will-change-transform ${changedIds.has(m.id) ? "animate-row-flash" : ""}`}>
                        <td className={`${effectiveRowCls} overlay-col-rank text-left overlay-rank-cell`}>{rank == null ? "—" : `#${rank}`}</td>
                        {hasRoleColumn && (
                          <td
                            className={`${effectiveRowCls} overlay-col-role`}
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: `${roleCh}ch`,
                            }}
                          >
                            {getMemberRole(m) || "-"}
                          </td>
                        )}
                        <td className={`${effectiveRowCls} overlay-col-name ${membersTheme.nameCls} ${nameWrapCls}`}>{m.name}</td>
                        <td className={`${effectiveRowCls} overlay-col-account ${membersTheme.accountCls} overlay-account-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.account)}</td>
                        <td className={`${effectiveRowCls} overlay-col-toon ${membersTheme.toonCls} overlay-toon-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-total text-right font-bold`}>{fmtTotalCell(m.account + m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-contribution text-right font-semibold`}>{fmt((m.account || 0) + (m.toon || 0))}</td>
                      </tr>
                    ))}
                    {pinned.map((m) => (
                      <tr key={m.id + "-p"} ref={setRowRef(m.id + "-p")} className={`overlay-row transition-transform will-change-transform ${changedIds.has(m.id) ? "animate-row-flash" : ""}`}>
                        <td className={`${effectiveRowCls} overlay-col-rank text-right overlay-rank-cell`}>—</td>
                        {hasRoleColumn && <td className={`${effectiveRowCls} overlay-col-role`}></td>}
                        <td className={`${effectiveRowCls} overlay-col-name ${membersTheme.nameCls} ${nameWrapCls}`}>{m.name}</td>
                        <td className={`${effectiveRowCls} overlay-col-account ${membersTheme.accountCls} overlay-account-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.account)}</td>
                        <td className={`${effectiveRowCls} overlay-col-toon ${membersTheme.toonCls} overlay-toon-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-total text-right font-bold`}>{fmtTotalCell(m.account + m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-contribution text-right font-semibold`}>{fmt((m.account || 0) + (m.toon || 0))}</td>
                      </tr>
                    ))}
                    {showTotal && ready && (
                      <tr className="overlay-total-row">
                        <td className={effectiveTotalWrapCls} colSpan={hasRoleColumn ? 2 : 1}>총합</td>
                        <td className={effectiveTotalWrapCls} />
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(sumAccount)}</td>
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(sumToon)}</td>
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(rounded)}</td>
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(sumContribution)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                  </div>
                ) : (
                <table
                  ref={tableBoxRef as any}
                  className={`${membersTheme.tableCls} overlay-elegant-table${membersThemeId === "pastel" ? " pastel-member-table" : ""}`}
                  style={{ fontSize: mSize, borderSpacing: 0, tableLayout: "fixed" }}
                >
                  <colgroup>
                    {excelGridCols.map((w, idx) => (
                      <col key={`excel-col-${idx}`} style={{ width: w, backgroundImage: columnGradients[idx], backgroundRepeat: "no-repeat", backgroundSize: "100% 100%" }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <td className={`${effectiveHeaderCls} overlay-col-rank overlay-rank-cell`}>순위</td>
                      {hasRoleColumn && <td className={`${effectiveHeaderCls} overlay-col-role`} style={{ whiteSpace: "nowrap" }}>직급</td>}
                      <td className={`${effectiveHeaderCls} overlay-col-name`}>이름</td>
                      <td className={`${effectiveHeaderCls} overlay-col-account text-right`}>계좌</td>
                      <td className={`${effectiveHeaderCls} overlay-col-toon text-right`}>투네</td>
                      <td className={`${effectiveHeaderCls} overlay-col-total text-right`}>{totalHeaderLabel}</td>
                      <td className={`${effectiveHeaderCls} overlay-col-contribution text-right`}>기여도</td>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map(({m, rank}) => (
                      <tr key={m.id} ref={setRowRef(m.id)} className={`overlay-row transition-transform will-change-transform ${changedIds.has(m.id) ? "animate-row-flash" : ""}`}>
                        <td className={`${effectiveRowCls} overlay-col-rank text-left overlay-rank-cell`}>{rank == null ? "—" : `#${rank}`}</td>
                        {hasRoleColumn && (
                          <td
                            className={`${effectiveRowCls} overlay-col-role`}
                            style={{
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: `${roleCh}ch`,
                            }}
                          >
                            {getMemberRole(m) || "-"}
                          </td>
                        )}
                        <td className={`${effectiveRowCls} overlay-col-name ${membersTheme.nameCls} ${nameWrapCls}`}>{m.name}</td>
                        <td className={`${effectiveRowCls} overlay-col-account ${membersTheme.accountCls} overlay-account-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.account)}</td>
                        <td className={`${effectiveRowCls} overlay-col-toon ${membersTheme.toonCls} overlay-toon-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-total text-right font-bold`}>{fmtTotalCell(m.account + m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-contribution text-right font-semibold`}>{fmt((m.account || 0) + (m.toon || 0))}</td>
                      </tr>
                    ))}
                    {pinned.map((m) => (
                      <tr key={m.id + "-p"} ref={setRowRef(m.id + "-p")} className={`overlay-row transition-transform will-change-transform ${changedIds.has(m.id) ? "animate-row-flash" : ""}`}>
                        <td className={`${effectiveRowCls} overlay-col-rank text-right overlay-rank-cell`}>—</td>
                        {hasRoleColumn && <td className={`${effectiveRowCls} overlay-col-role`}></td>}
                        <td className={`${effectiveRowCls} overlay-col-name ${membersTheme.nameCls} ${nameWrapCls}`}>{m.name}</td>
                        <td className={`${effectiveRowCls} overlay-col-account ${membersTheme.accountCls} overlay-account-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.account)}</td>
                        <td className={`${effectiveRowCls} overlay-col-toon ${membersTheme.toonCls} overlay-toon-cell text-right`} style={{ textOverflow: "clip" }}>{fmt(m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-total text-right font-bold`}>{fmtTotalCell(m.account + m.toon)}</td>
                        <td className={`${effectiveRowCls} overlay-col-contribution text-right font-semibold`}>{fmt((m.account || 0) + (m.toon || 0))}</td>
                      </tr>
                    ))}
                    {showTotal && ready && (
                      <tr className="overlay-total-row">
                        <td className={effectiveTotalWrapCls} colSpan={hasRoleColumn ? 2 : 1}>총합</td>
                        <td className={effectiveTotalWrapCls} />
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(sumAccount)}</td>
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(sumToon)}</td>
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(rounded)}</td>
                        <td className={`${effectiveTotalWrapCls} text-right`}>{fmt(sumContribution)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                )}
                </div>
              </div>
            </div>
          </div>
        )}
        {(showGoal || fallbackShowGoal) && (ready || isPreviewGuide || externalHost) && goal > 0 && (
          <div className={`absolute ${posClass(goalAnchor)}`}>
            <GoalBar current={liveGoalCurrent} goal={goal} label={goalLabel} width={goalWidth} opacityPercent={goalOpacity} />
          </div>
        )}
        {showPersonalGoal && (ready || isPreviewGuide || externalHost) && (
          renderPersonalGoal()
        )}
        {showTimer && effectiveTimerAllowed && (
          <div className={`absolute ${posClass(timerAnchor)} z-[10000]`}>
            <Timer
              elapsed={timerText}
              fontSize={timerFontSize}
              fontColor={timerFontColor}
              bgColor={timerBgColor}
              borderColor={timerBorderColor}
              bgOpacity={timerBgOpacity}
            />
          </div>
        )}
        {showMission && (ready || isPreviewGuide) && missions.length > 0 && (
          <div className={`absolute ${posClass(externalHost ? "cc" : missionAnchor)} z-[9990] pointer-events-none`} style={{ width: fitWidthToViewport(missionWidth) }}>
            <div className="pointer-events-auto">
              {missionDisplayMode === "vertical-slot" ? (
                <MissionBoardSlot
                  missions={missions}
                  fontSize={missionFontSize}
                  themeVariant={missionThemeVariant}
                  titleText={missionTitleTextCfg}
                  visibleCount={missionVisibleCount}
                  speed={missionSpeedSec}
                  gapSize={missionGapSizePx}
                  bgOpacity={missionBgOpacityCfg}
                  bgColor={missionBgColorCfg}
                  itemColor={missionItemColorCfg}
                  titleColor={missionTitleColorCfg}
                  titleEffect={missionTitleEffectCfg}
                />
              ) : (
                <MissionBoard
                  missions={missions}
                  fontSize={missionFontSize}
                  themeVariant={missionThemeVariant}
                  titleText={missionTitleTextCfg}
                  duration={missionSpeedSec}
                  bgOpacity={missionBgOpacityCfg}
                  bgColor={missionBgColorCfg}
                  itemColor={missionItemColorCfg}
                  titleColor={missionTitleColorCfg}
                  titleEffect={missionTitleEffectCfg}
                  effect={missionEffectCfg}
                  effectHotOnly={missionEffectHotOnlyCfg}
                />
              )}
            </div>
          </div>
        )}
        {!rawUserId && <div className="fixed top-2 left-2 z-[9999] px-2 py-0.5 rounded bg-amber-600/90 text-white text-[11px] font-semibold shadow">인증 누락: 기본 계정 사용 중</div>}
          </main>
        </div>
      </div>
    );
  }

export default function OverlayPage() {
  return (
    <Suspense>
      <OverlayInner />
    </Suspense>
  );
}
