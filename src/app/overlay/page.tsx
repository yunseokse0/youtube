"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppState, totalAccount, Member, Donor, MissionItem, roundToThousand, formatManThousand, loadStateFromApi, loadState, totalToon, totalCombined, STORAGE_KEY } from "@/lib/state";
import { useFlip } from "@/lib/flip";
import MissionMenu from "@/components/MissionMenu";

type OverlayPresetLike = {
  id?: string;
  scale?: string;
  memberSize?: string;
  totalSize?: string;
  dense?: boolean;
  anchor?: string;
  sumAnchor?: string;
  sumX?: string;
  sumY?: string;
  sumFree?: boolean;
  theme?: string;
  showMembers?: boolean;
  showTotal?: boolean;
  showGoal?: boolean;
  goal?: string;
  goalLabel?: string;
  goalWidth?: string;
  goalAnchor?: string;
  goalCurrent?: string;
  showPersonalGoal?: boolean;
  personalGoalTheme?: string;
  personalGoalAnchor?: string;
  personalGoalLimit?: string;
  personalGoalFree?: boolean;
  personalGoalX?: string;
  personalGoalY?: string;
  tickerInMembers?: boolean;
  tickerInGoal?: boolean;
  tickerInPersonalGoal?: boolean;
  showTicker?: boolean;
  tickerAnchor?: string;
  tickerWidth?: string;
  tickerFree?: boolean;
  tickerX?: string;
  tickerY?: string;
  showTimer?: boolean;
  timerStart?: number | null;
  timerAnchor?: string;
  showMission?: boolean;
  missionAnchor?: string;
  showBottomDonors?: boolean;
  donorsSize?: string;
  donorsGap?: string;
  donorsSpeed?: string;
  donorsLimit?: string;
  donorsFormat?: string;
  donorsUnit?: string;
  donorsColor?: string;
  tickerTheme?: string;
  tickerGlow?: string;
  tickerShadow?: string;
  currencyLocale?: string;
};

function presetToParams(preset: OverlayPresetLike | null): URLSearchParams {
  const q = new URLSearchParams();
  if (!preset) return q;
  q.set("scale", preset.scale || "0.75");
  q.set("memberSize", preset.memberSize || "18");
  q.set("totalSize", preset.totalSize || "40");
  q.set("dense", String(preset.dense ?? true));
  q.set("anchor", preset.anchor || "tl");
  q.set("theme", preset.theme || "default");
  q.set("showMembers", String(preset.showMembers ?? true));
  q.set("showTotal", String(preset.showTotal ?? true));
  if (preset.sumFree) {
    q.set("sumX", preset.sumX || "50");
    q.set("sumY", preset.sumY || "90");
  } else {
    q.set("sumAnchor", preset.sumAnchor || "bc");
  }
  if (preset.showGoal) {
    q.set("showGoal", "true");
    q.set("goal", preset.goal || "0");
    q.set("goalLabel", preset.goalLabel || "목표 금액");
    q.set("goalWidth", preset.goalWidth || "400");
    q.set("goalAnchor", preset.goalAnchor || "bc");
    if (preset.goalCurrent && preset.goalCurrent.trim()) q.set("goalCurrent", preset.goalCurrent.trim());
  }
  if (preset.showPersonalGoal) q.set("showPersonalGoal", "true");
  if (preset.personalGoalTheme && preset.personalGoalTheme.trim()) q.set("personalGoalTheme", preset.personalGoalTheme.trim());
  if (preset.personalGoalFree) {
    q.set("personalGoalX", preset.personalGoalX || "78");
    q.set("personalGoalY", preset.personalGoalY || "82");
  } else if (preset.personalGoalAnchor && preset.personalGoalAnchor.trim()) {
    q.set("personalGoalAnchor", preset.personalGoalAnchor.trim());
  }
  if (preset.personalGoalLimit && preset.personalGoalLimit.trim()) q.set("personalGoalLimit", preset.personalGoalLimit.trim());
  if (preset.tickerInMembers) q.set("tickerInMembers", "true");
  if (preset.tickerInGoal) q.set("tickerInGoal", "true");
  if (preset.tickerInPersonalGoal) q.set("tickerInPersonalGoal", "true");
  if (preset.showTicker) {
    q.set("showTicker", "true");
    if (preset.tickerFree) {
      q.set("tickerX", preset.tickerX || "50");
      q.set("tickerY", preset.tickerY || "86");
    } else if (preset.tickerAnchor) {
      q.set("tickerAnchor", preset.tickerAnchor);
    }
    if (preset.tickerWidth && preset.tickerWidth.trim()) q.set("tickerWidth", preset.tickerWidth.trim());
  }
  if (preset.showTimer && preset.timerStart) {
    q.set("showTimer", "true");
    q.set("timerStart", String(preset.timerStart));
    q.set("timerAnchor", preset.timerAnchor || "tr");
  }
  if (preset.showMission) {
    q.set("showMission", "true");
    q.set("missionAnchor", preset.missionAnchor || "br");
  }
  if (preset.showBottomDonors) q.set("showBottomDonors", "true");
  if (preset.donorsSize && preset.donorsSize.trim()) q.set("donorsSize", preset.donorsSize.trim());
  if (preset.donorsGap && preset.donorsGap.trim()) q.set("donorsGap", preset.donorsGap.trim());
  if (preset.donorsSpeed && preset.donorsSpeed.trim()) q.set("donorsSpeed", preset.donorsSpeed.trim());
  if (preset.donorsLimit && preset.donorsLimit.trim()) q.set("donorsLimit", preset.donorsLimit.trim());
  q.set("donorsFormat", (preset.donorsFormat || "short").trim() === "full" ? "full" : "short");
  if (preset.donorsUnit && preset.donorsUnit.trim()) q.set("donorsUnit", preset.donorsUnit.trim());
  if (preset.donorsColor && preset.donorsColor.trim()) q.set("donorsColor", preset.donorsColor.trim());
  if (preset.tickerTheme && preset.tickerTheme.trim()) q.set("tickerTheme", preset.tickerTheme.trim());
  if (preset.tickerGlow && preset.tickerGlow.trim()) q.set("tickerGlow", preset.tickerGlow.trim());
  if (preset.tickerShadow && preset.tickerShadow.trim()) q.set("tickerShadow", preset.tickerShadow.trim());
  if (preset.currencyLocale && preset.currencyLocale.trim()) q.set("currencyLocale", preset.currencyLocale.trim());
  return q;
}

function useRemoteState(): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const loadRef = useRef(loadStateFromApi);
  const syncingRef = useRef(false);
  const readLocalStateIfExists = (): AppState | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return loadState();
    } catch {
      return null;
    }
  };
  useEffect(() => {
    const local = readLocalStateIfExists();
    if (local) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
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
        if (localNow && localNow.updatedAt && localNow.updatedAt > lastUpdatedRef.current) {
          lastUpdatedRef.current = localNow.updatedAt;
          setState(localNow);
        }
        const data = await loadRef.current();
        // Keep local state when API is stale (e.g. API save failed),
        // and only accept strictly newer snapshots from server.
        if (data && data.updatedAt && data.updatedAt > lastUpdatedRef.current) {
          lastUpdatedRef.current = data.updatedAt;
          setState(data);
        }
      } catch {}
      syncingRef.current = false;
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const localNow = readLocalStateIfExists();
      if (localNow && localNow.updatedAt && localNow.updatedAt > lastUpdatedRef.current) {
        lastUpdatedRef.current = localNow.updatedAt;
        setState(localNow);
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
  }, []);

  return { state, ready: state !== null };
}

function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const from = display;
    const to = value;
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

type ThemeId = "default" | "excel" | "neon" | "retro" | "minimal" | "rpg" | "pastel" | "neonExcel";

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
    label: "기본",
    memberCls: "font-bold tracking-tight",
    nameCls: "text-white",
    accountCls: "ml-2 text-emerald-300",
    toonCls: "ml-1 text-neutral-200",
    totalCls: "font-extrabold text-amber-200 drop-shadow-[0_0_6px_rgba(0,0,0,1)]",
    totalWrapCls: "",
    rowCls: "",
    tableCls: "",
    headerCls: "",
    goalBarBg: "bg-neutral-800/80",
    goalBarFill: "bg-gradient-to-r from-emerald-500 to-emerald-300",
    goalText: "text-white font-bold drop-shadow-[0_0_4px_rgba(0,0,0,1)]",
    goalWrap: "",
    tickerCls: "text-amber-200 font-semibold",
    timerCls: "font-mono text-white/80",
  },
  excel: {
    label: "엑셀",
    memberCls: "font-mono",
    nameCls: "text-black font-semibold",
    accountCls: "text-blue-700 font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden",
    toonCls: "text-gray-500 whitespace-nowrap font-mono tabular-nums overflow-hidden",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#217346] px-2 py-1",
    rowCls: "border border-[#d4d4d4] px-2 py-1 align-middle",
    tableCls: "bg-white/95 border-collapse shadow-lg",
    headerCls: "bg-[#217346] text-white font-bold px-2 py-1 border border-[#1a5c37] text-sm",
    goalBarBg: "bg-[#d4d4d4]",
    goalBarFill: "bg-[#217346]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-[#d4d4d4] bg-white/95 p-1",
    tickerCls: "text-[#217346] font-mono font-bold",
    timerCls: "font-mono text-black/60 bg-white/80 px-2",
  },
  neon: {
    label: "네온",
    memberCls: "font-black tracking-wide",
    nameCls: "text-cyan-300 drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]",
    accountCls: "ml-2 text-fuchsia-400 drop-shadow-[0_0_8px_rgba(255,0,255,0.7)] tabular-nums overflow-hidden",
    toonCls: "ml-1 text-yellow-300 drop-shadow-[0_0_6px_rgba(255,255,0,0.5)] tabular-nums overflow-hidden",
    totalCls: "font-black text-lime-300 drop-shadow-[0_0_12px_rgba(0,255,0,0.8)]",
    totalWrapCls: "",
    rowCls: "",
    tableCls: "",
    headerCls: "",
    goalBarBg: "bg-neutral-900/80 border border-cyan-500/40",
    goalBarFill: "bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-lime-400 shadow-[0_0_15px_rgba(0,255,255,0.5)]",
    goalText: "text-white font-black drop-shadow-[0_0_8px_rgba(0,255,255,0.7)]",
    goalWrap: "",
    tickerCls: "text-cyan-300 font-bold drop-shadow-[0_0_8px_rgba(0,255,255,0.5)]",
    timerCls: "font-mono text-fuchsia-300 drop-shadow-[0_0_6px_rgba(255,0,255,0.5)]",
  },
  retro: {
    label: "레트로",
    memberCls: "font-mono font-bold",
    nameCls: "text-amber-100",
    accountCls: "ml-2 text-green-400",
    toonCls: "ml-1 text-green-600",
    totalCls: "font-mono font-bold text-green-300",
    totalWrapCls: "border-2 border-green-500/60 bg-black/70 px-4 py-2 rounded",
    rowCls: "",
    tableCls: "",
    headerCls: "",
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
    accountCls: "ml-3 text-white/70",
    toonCls: "ml-1 text-white/40",
    totalCls: "font-thin text-white/80 tracking-[0.2em]",
    totalWrapCls: "",
    rowCls: "",
    tableCls: "",
    headerCls: "",
    goalBarBg: "bg-white/10",
    goalBarFill: "bg-white/50",
    goalText: "text-white/70 font-light tracking-wider",
    goalWrap: "",
    tickerCls: "text-white/60 font-light",
    timerCls: "font-mono text-white/40 font-light",
  },
  rpg: {
    label: "RPG",
    memberCls: "font-bold",
    nameCls: "text-yellow-200 drop-shadow-[0_0_4px_rgba(0,0,0,1)]",
    accountCls: "ml-2 text-red-400",
    toonCls: "ml-1 text-sky-400",
    totalCls: "font-extrabold text-yellow-300",
    totalWrapCls: "bg-gradient-to-r from-amber-900/80 via-amber-800/80 to-amber-900/80 border-2 border-yellow-600/70 px-4 py-2 rounded-lg shadow-[0_0_15px_rgba(255,200,0,0.3)]",
    rowCls: "bg-slate-900/70 border border-slate-600/50 px-3 py-1 rounded mb-1",
    tableCls: "",
    headerCls: "",
    goalBarBg: "bg-slate-900/80 border-2 border-yellow-700/60 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-red-600 via-orange-500 to-yellow-400 rounded-lg shadow-[0_0_10px_rgba(255,150,0,0.4)]",
    goalText: "text-yellow-200 font-extrabold drop-shadow-[0_0_4px_rgba(0,0,0,1)]",
    goalWrap: "bg-slate-900/70 border border-yellow-700/50 rounded-lg p-1",
    tickerCls: "text-yellow-300 font-bold",
    timerCls: "font-mono text-sky-300",
  },
  pastel: {
    label: "파스텔",
    memberCls: "font-semibold",
    nameCls: "text-pink-200",
    accountCls: "ml-2 text-sky-200",
    toonCls: "ml-1 text-purple-200/70",
    totalCls: "font-bold text-pink-100",
    totalWrapCls: "bg-gradient-to-r from-pink-500/40 to-purple-500/40 backdrop-blur-sm px-4 py-2 rounded-full border border-white/20",
    rowCls: "",
    tableCls: "",
    headerCls: "",
    goalBarBg: "bg-white/10 backdrop-blur-sm rounded-full",
    goalBarFill: "bg-gradient-to-r from-pink-400 to-purple-400 rounded-full",
    goalText: "text-white/90 font-semibold",
    goalWrap: "backdrop-blur-sm",
    tickerCls: "text-pink-200 font-semibold",
    timerCls: "font-mono text-purple-200/70",
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
};

function GoalBar({ current, goal, label, theme, width }: { current: number; goal: number; label: string; theme: typeof THEMES.default; width: number }) {
  const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
  const displayPct = useCountUp(Math.round(pct), 600);
  return (
    <div className={theme.goalWrap} style={{ width }}>
      <div className="flex justify-between items-center px-1 mb-1" style={{ fontSize: Math.max(12, width * 0.04) }}>
        <span className={theme.goalText}>{label}</span>
        <span className={theme.goalText}>{formatManThousand(current)} / {formatManThousand(goal)} ({displayPct}%)</span>
      </div>
      <div className={`${theme.goalBarBg} overflow-hidden`} style={{ height: Math.max(14, width * 0.04), borderRadius: 6 }}>
        <div
          className={`${theme.goalBarFill} h-full transition-all duration-700 ease-out`}
          style={{ width: `${pct}%`, borderRadius: 6 }}
        />
      </div>
    </div>
  );
}

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
      <div className="space-y-2">
        {items.map((it, idx) => {
          const accent = palette[idx % palette.length];
          const remain = Math.max(0, it.goal - it.current);
          return (
          <div key={it.id} className={`rounded-xl p-2 ${cardClass}`}>
            <div className="flex items-center justify-between gap-2">
              <span
                className="px-2 py-0.5 rounded-md border font-bold tracking-wide text-white"
                style={{ borderColor: accent, fontSize: Math.max(11, Math.round(fontSize * 0.72)), minWidth: 74 }}
              >
                {it.name}
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(10, Math.round(fontSize * 0.66)) }}>
                남은 금액: {num(remain)}
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(10, Math.round(fontSize * 0.66)) }}>
                {Math.round(it.pct)}%
              </span>
            </div>
            <div className="flex items-center justify-end gap-1 mt-1">
              <span className={currentTextClass} style={{ color: accent, fontWeight: 800, fontSize: Math.max(11, Math.round(fontSize * 0.72)) }}>
                {num(it.current)}원
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(10, Math.round(fontSize * 0.66)) }}>
                / {num(it.goal)}
              </span>
            </div>
            <div className={`${barBgClass} mt-1 overflow-hidden`} style={{ height: Math.max(7, Math.round(fontSize * 0.3)), borderRadius: 999 }}>
              <div style={{ width: `${it.pct}%`, height: "100%", background: accent, borderRadius: 999 }} />
            </div>
          </div>
        )})}
      </div>
    </div>
  );
}

function DonorTicker({ donors, theme, fontSize, color, full, duration, gap, limit, unit, locale, placeholderText, previewGuide, tickerTheme, tickerGlow, tickerShadow }: { donors: Donor[]; theme: typeof THEMES.default; fontSize: number; color?: string; full?: boolean; duration?: number; gap?: number; limit?: number; unit?: string; locale?: string; placeholderText?: string; previewGuide?: boolean; tickerTheme?: string; tickerGlow?: number; tickerShadow?: number }) {
  const recent = useMemo(() => {
    const lim = Math.max(1, limit || 5);
    const sorted = donors.slice().sort((a, b) => b.at - a.at);
    const byName = new Map<string, { name: string; at: number; account: number; toon: number }>();
    for (const d of sorted) {
      const key = (d.name || "무명").trim() || "무명";
      const prev = byName.get(key);
      const isToon = (d.target || "account") === "toon";
      if (!prev) {
        byName.set(key, {
          name: key,
          at: d.at || 0,
          account: isToon ? 0 : d.amount,
          toon: isToon ? d.amount : 0,
        });
        continue;
      }
      byName.set(key, {
        name: key,
        at: Math.max(prev.at, d.at || 0),
        account: prev.account + (isToon ? 0 : d.amount),
        toon: prev.toon + (isToon ? d.amount : 0),
      });
    }
    return Array.from(byName.values())
      .sort((a, b) => b.at - a.at)
      .slice(0, lim);
  }, [donors, limit]);
  const stream = useMemo(() => {
    if (!recent.length) return [];
    const minItems = Math.max(8, (limit || 5) * 3);
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
      <div className="overflow-hidden whitespace-nowrap" style={{ fontSize, width: "100%" }}>
        <div className={theme.tickerCls} style={{ ...tickerThemeStyle, ...(color ? { color } : {}) }}>
          {placeholderText || "후원티커는 이곳에 출력됩니다."}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden whitespace-nowrap" style={{ fontSize, width: "100%" }}>
      <div
        className="inline-block animate-ticker"
        style={{
          ...tickerThemeStyle,
          ...(color ? { color } : {}),
          ...(duration ? { animationDuration: `${Math.max(3, duration)}s` } : {}),
        }}
      >
        {stream.map((d, i) => (
          <span
            key={`${d.name}-${d.at}-${i}`}
            className={theme.tickerCls}
            style={{ marginLeft: gap ?? 16, marginRight: gap ?? 16 }}
          >
            ♥ {d.name} {amountText(d)}
          </span>
        ))}
        {stream.map((d, i) => (
          <span
            key={`dup-${d.name}-${d.at}-${i}`}
            className={theme.tickerCls}
            style={{ marginLeft: gap ?? 16, marginRight: gap ?? 16 }}
          >
            ♥ {d.name} {amountText(d)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timer({ elapsed, theme, fontSize }: { elapsed: string | null; theme: typeof THEMES.default; fontSize: number }) {
  if (!elapsed) return null;
  return (
    <div className={theme.timerCls} style={{ fontSize }} suppressHydrationWarning>
      {elapsed}
    </div>
  );
}

function OverlayInner() {
  const { state: s, ready } = useRemoteState();
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
  const membersRemote = useMemo(() => (ready && s ? s.members : []), [ready, s]);
  const donorsRemote = useMemo(() => (ready && s ? s.donors : []), [ready, s]);
  const missions = useMemo(() => (ready && s ? s.missions || [] : []), [ready, s]);
  const overlayPresets = useMemo(() => {
    const remote = ready && s && Array.isArray(s.overlayPresets) ? (s.overlayPresets as OverlayPresetLike[]) : [];
    return remote.length > 0 ? remote : localPresets;
  }, [ready, s, localPresets]);
  const sumAccount = useMemo(() => (ready && s ? totalAccount(s) : 0), [ready, s]);
  const sumToon = useMemo(() => (ready && s ? totalToon(s) : 0), [ready, s]);
  const sumCombined = useMemo(() => (ready && s ? totalCombined(s) : 0), [ready, s]);
  const rounded = useMemo(() => roundToThousand(sumCombined), [sumCombined]);
  const pinnedFilter = (m: Member) => Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(m.role || "");
  const displaySum = useCountUp(rounded, 800);
  const rawSp = useSearchParams();
  const presetId = (rawSp.get("p") || "").trim();
  const activePreset = useMemo(
    () => (presetId ? overlayPresets.find((x) => x.id === presetId) || null : null),
    [presetId, overlayPresets]
  );
  const presetParams = useMemo(() => presetToParams(activePreset), [activePreset]);
  const sp = useMemo(
    () => ({
      get: (key: string) => {
        const direct = rawSp.get(key);
        if (direct !== null) return direct;
        return presetParams.get(key);
      },
    }),
    [rawSp, presetParams]
  );

  const compact = (sp.get("compact") || "false").toLowerCase() === "true";
  const autoFont = (sp.get("autoFont") || "false").toLowerCase() === "true";
  const tight = (sp.get("tight") || "false").toLowerCase() === "true";
  const fitBase = Math.max(240, Math.min(1600, parseInt(sp.get("fitBase") || "480", 10)));
  const fitMinMember = Math.max(8, Math.min(40, parseInt(sp.get("fitMinMember") || "10", 10)));
  const fitMaxMember = Math.max(fitMinMember, Math.min(80, parseInt(sp.get("fitMaxMember") || "24", 10)));
  const scale = Math.max(0.3, Math.min(3, parseFloat(sp.get("scale") || (compact ? "0.8" : "1"))));
  const memberSize = Math.max(10, Math.min(80, parseInt(sp.get("memberSize") || (compact ? "14" : "18"), 10)));
  const totalSize = Math.max(14, Math.min(160, parseInt(sp.get("totalSize") || "20", 10)));
  const dense = (sp.get("dense") || "false").toLowerCase() === "true";
  const anchor = (sp.get("anchor") || "tl").toLowerCase();
  const sumAnchor = (sp.get("sumAnchor") || "bc").toLowerCase();
  const sumXParam = sp.get("sumX");
  const sumYParam = sp.get("sumY");
  const hasFreePos = sumXParam !== null && sumYParam !== null;
  const sumX = hasFreePos ? Math.max(0, Math.min(100, parseFloat(sumXParam!))) : 0;
  const sumY = hasFreePos ? Math.max(0, Math.min(100, parseFloat(sumYParam!))) : 0;
  const themeId = (sp.get("theme") || "default") as ThemeId;
  const theme = THEMES[themeId] || THEMES.default;

  const showMembers = sp.get("showMembers") !== "false";
  const showTotal = sp.get("showTotal") !== "false";
  const showGoal = sp.get("showGoal") === "true";
  const showPersonalGoal = sp.get("showPersonalGoal") === "true";
  const tickerInMembers = sp.get("tickerInMembers") === "true";
  const tickerInGoal = sp.get("tickerInGoal") === "true";
  const tickerInPersonalGoal = sp.get("tickerInPersonalGoal") === "true";
  const showTicker = sp.get("showTicker") === "true";
  const hasContextTicker = tickerInMembers || tickerInGoal || tickerInPersonalGoal;
  const showTimer = sp.get("showTimer") === "true";
  const goalRaw = parseInt(sp.get("goal") || "0", 10);
  const goal = isNaN(goalRaw) ? 0 : goalRaw;
  const goalLabel = sp.get("goalLabel") || "목표 금액";
  const goalWidth = Math.max(200, Math.min(800, parseInt(sp.get("goalWidth") || "400", 10)));
  const goalAnchor = (sp.get("goalAnchor") || "bc").toLowerCase();
  const personalGoalAnchor = (sp.get("personalGoalAnchor") || "br").toLowerCase();
  const personalGoalLimit = Math.max(1, Math.min(12, parseInt(sp.get("personalGoalLimit") || "3", 10)));
  const personalGoalTheme = (sp.get("personalGoalTheme") || "goalClassic") as "goalClassic" | "goalNeon";
  const personalGoalXParam = sp.get("personalGoalX");
  const personalGoalYParam = sp.get("personalGoalY");
  const hasPersonalGoalFreePos = personalGoalXParam !== null && personalGoalYParam !== null;
  const personalGoalX = hasPersonalGoalFreePos ? Math.max(0, Math.min(100, parseFloat(personalGoalXParam!))) : 0;
  const personalGoalY = hasPersonalGoalFreePos ? Math.max(0, Math.min(100, parseFloat(personalGoalYParam!))) : 0;
  const goalCurrentParam = sp.get("goalCurrent");
  const goalCurrent = goalCurrentParam !== null ? Math.max(0, parseInt(goalCurrentParam || "0", 10) || 0) : null;
  const timerStart = sp.get("timerStart") ? parseInt(sp.get("timerStart")!, 10) : null;
  const timerAnchor = (sp.get("timerAnchor") || "tr").toLowerCase();
  const tickerAnchor = (sp.get("tickerAnchor") || "bc").toLowerCase();
  const tickerWidth = Math.max(200, Math.min(1200, parseInt(sp.get("tickerWidth") || "600", 10)));
  const tickerXParam = sp.get("tickerX");
  const tickerYParam = sp.get("tickerY");
  const hasTickerFreePos = tickerXParam !== null && tickerYParam !== null;
  const tickerX = hasTickerFreePos ? Math.max(0, Math.min(100, parseFloat(tickerXParam!))) : 0;
  const tickerY = hasTickerFreePos ? Math.max(0, Math.min(100, parseFloat(tickerYParam!))) : 0;
  const showMission = sp.get("showMission") === "true";
  const missionAnchor = (sp.get("missionAnchor") || "br").toLowerCase();

  const elapsed = useElapsed(timerStart);

  const nameCh = Math.max(6, Math.min(40, parseInt(sp.get("nameCh") || (compact ? "10" : "12"), 10)));
  const nameGrow = (sp.get("nameGrow") || "true").toLowerCase() === "true";
  const currencyFull = (sp.get("currencyFull") || "false").toLowerCase() === "true";
  const nameMaxCh = Math.max(nameCh, Math.min(80, parseInt(sp.get("nameMaxCh") || String(nameCh + 8), 10)));
  const fullAmountMode = sp.get("donorsFormat") === "full" || currencyFull;
  const defBankCh = (sp.get("bankCh") && parseInt(sp.get("bankCh")!, 10)) || (fullAmountMode ? (compact ? 9 : 11) : (compact ? 4 : 5));
  const defToonCh = (sp.get("toonCh") && parseInt(sp.get("toonCh")!, 10)) || (fullAmountMode ? (compact ? 9 : 11) : (compact ? 4 : 5));
  const defTotalCh = (sp.get("totalCh") && parseInt(sp.get("totalCh")!, 10)) || (fullAmountMode ? (compact ? 7 : 8) : (compact ? 5 : 6));
  const bankCh = Math.max(3, Math.min(12, defBankCh));
  const toonCh = Math.max(4, Math.min(12, defToonCh));
  const totalCh = Math.max(4, Math.min(10, defTotalCh));
  const showSideDonors = sp.get("showSideDonors") === "true";
  const donorsSide = (sp.get("donorsSide") || "right").toLowerCase();
  const donorsWidth = Math.max(120, Math.min(600, parseInt(sp.get("donorsWidth") || "220", 10)));
  const donorsSize = Math.max(10, Math.min(60, parseInt(sp.get("donorsSize") || String(Math.round(memberSize * 0.9)), 10)));
  const donorsColor = sp.get("donorsColor") || undefined;
  const showBottomDonors = sp.get("showBottomDonors") === "true";
  const effectiveShowTicker = showTicker && !hasContextTicker && !showBottomDonors;
  const donorsGap = Math.max(0, Math.min(48, parseInt(sp.get("donorsGap") || (tight ? "8" : "16"), 10)));
  const donorsSpeed = Math.max(3, Math.min(120, parseFloat(sp.get("donorsSpeed") || "20"))); // seconds per loop
  const donorsLimit = Math.max(1, Math.min(50, parseInt(sp.get("donorsLimit") || "8", 10)));
  const donorsFormat = sp.get("donorsFormat") === "full" ? "full" : "short"; // only full|short
  const donorsUnit = sp.get("donorsUnit") || sp.get("currencyUnit") || "";
  const currencyLocale = sp.get("currencyLocale") || "ko-KR";
  const previewGuide = sp.get("previewGuide") === "true";
  const tickerThemeCfg = sp.get("tickerTheme") || "auto";
  const tickerGlowCfg = Math.max(0, Math.min(100, parseInt(sp.get("tickerGlow") || "45", 10)));
  const tickerShadowCfg = Math.max(0, Math.min(100, parseInt(sp.get("tickerShadow") || "35", 10)));
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
  const lockWidth = (sp.get("lockWidth") || "false").toLowerCase() === "true";
  const effectiveNameGrow = lockWidth ? false : nameGrow;
  const scaledMainStyle: React.CSSProperties = { zoom: scale as any };

  const containerRef = useRef<HTMLDivElement>(null);
  const [autoMemberSize, setAutoMemberSize] = useState(memberSize);
  const [autoTotalSize, setAutoTotalSize] = useState(totalSize);
  const [autoDonorSize, setAutoDonorSize] = useState(donorsSize);
  const tableBoxRef = useRef<HTMLDivElement | HTMLTableElement | null>(null);
  const [donorBoxWidth, setDonorBoxWidth] = useState<number | null>(null);
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

  const demo = (sp.get("demo") || "false").toLowerCase() === "true";
  const [demoMembers, setDemoMembers] = useState<Member[] | null>(null);
  const [demoDonors, setDemoDonors] = useState<Donor[] | null>(null);
  useEffect(() => {
    if (!demo) return;
    const baseMembers: Member[] = [
      { id: "m1", name: "멤버1", account: 0, toon: 0, role: "과장" },
      { id: "m2", name: "멤버2", account: 0, toon: 0, role: "부장" },
      { id: "m3", name: "멤버3", account: 0, toon: 0, role: "대리" },
      { id: "m4", name: "운영비", account: 0, toon: 0, role: "운영비" },
    ];
    setDemoMembers(baseMembers);
    setDemoDonors([]);
    const donorNames = ["Alice", "Bob", "Charlie", "Daisy", "Ethan", "Fiona", "Grace", "Henry"];
    const interval = setInterval(() => {
      setDemoMembers((prev) => {
        if (!prev) return prev;
        const arr = prev.map((m) => ({ ...m }));
        const idx = Math.floor(Math.random() * 3);
        const delta = Math.floor(Math.random() * 5 + 1) * 1000;
        if (Math.random() < 0.5) arr[idx].account += delta;
        else arr[idx].toon += delta;
        return arr;
      });
      setDemoDonors((prev) => {
        const list = prev ? [...prev] : [];
        const name = donorNames[Math.floor(Math.random() * donorNames.length)];
        const amount = (Math.floor(Math.random() * 10) + 1) * 1000;
        const targets: ("account" | "toon")[] = ["account", "toon"];
        const target = targets[Math.floor(Math.random() * targets.length)];
        const membersPool = ["m1", "m2", "m3"];
        const memberId = membersPool[Math.floor(Math.random() * membersPool.length)];
        list.unshift({ id: `d-${Date.now()}`, name, amount, at: Date.now(), memberId, target });
        return list.slice(0, 12);
      });
    }, 1200);
    return () => clearInterval(interval);
  }, [demo]);

  const members = useMemo(() => (demo && demoMembers ? demoMembers : membersRemote), [demo, demoMembers, membersRemote]);
  const donors = useMemo(() => (demo && demoDonors ? demoDonors : donorsRemote), [demo, demoDonors, donorsRemote]);
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

  const unpinned = useMemo(() => members.filter((m) => !pinnedFilter(m)), [members]);
  const pinned = useMemo(() => members.filter(pinnedFilter), [members]);
  const hasRoleColumn = useMemo(
    () => members.some((m) => (m.role || "").trim().length > 0),
    [members]
  );
  const ranked = useMemo(() => {
    const arr = [...unpinned].sort((a, b) => (b.account + b.toon) - (a.account + a.toon));
    return arr.map((m, i) => ({ m, rank: i + 1 }));
  }, [unpinned]);

  const allOrderKeys = [...ranked.map(({ m }) => m.id), ...pinned.map((m) => `${m.id}-p`)];
  const setRowRef = useFlip(allOrderKeys, 500);

  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => { document.body.style.background = ""; };
  }, []);

  const posClass = (a: string) =>
    a === "tr" ? "top-4 right-4" :
    a === "bl" ? "bottom-4 left-4" :
    a === "br" ? "bottom-4 right-4" :
    a === "tc" ? "top-4 left-1/2 -translate-x-1/2" :
    a === "bc" ? "bottom-4 left-1/2 -translate-x-1/2" :
    "top-4 left-4";

  const listPosClass =
    anchor === "tr" ? "top-4 right-4 items-end text-right" :
    anchor === "bl" ? "bottom-4 left-4" :
    anchor === "br" ? "bottom-4 right-4 items-end text-right" :
    "top-4 left-4";

  const sumPosStyle: React.CSSProperties | undefined = hasFreePos
    ? { left: `${sumX}%`, top: `${sumY}%`, transform: "translate(-50%, -50%)" }
    : undefined;
  const sumPosClass = hasFreePos ? "" : posClass(sumAnchor);
  const personalGoalPosStyle: React.CSSProperties | undefined = hasPersonalGoalFreePos
    ? { left: `${personalGoalX}%`, top: `${personalGoalY}%`, transform: "translate(-50%, -50%)" }
    : undefined;
  const personalGoalPosClass = hasPersonalGoalFreePos ? "" : posClass(personalGoalAnchor);
  const tickerPosStyle: React.CSSProperties | undefined = hasTickerFreePos
    ? { left: `${tickerX}%`, top: `${tickerY}%`, transform: "translate(-50%, -50%)", width: tickerWidth }
    : { width: tickerWidth };
  const tickerPosClass = hasTickerFreePos ? "" : posClass(tickerAnchor);

  if (themeId === "excel") {
    const excelGridCols = hasRoleColumn
      ? ["3ch", "6ch", `${nameCh}ch`, `${bankCh}ch`, `${toonCh}ch`, `${totalCh}ch`]
      : ["3ch", `${nameCh}ch`, `${bankCh}ch`, `${toonCh}ch`, `${totalCh}ch`];
    return (
      <main className="transparent-bg min-h-screen no-select" style={scaledMainStyle}>
        {showMembers && ready && (
          <div className={`fixed ${listPosClass}`}>
            <div ref={containerRef} className="flex items-start gap-3" style={{ width: "fit-content" }}>
              {showSideDonors && donorsSide === "left" && (
                <div style={{ width: donorsWidth }}>
                  <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                </div>
              )}
              <div>
                <table ref={tableBoxRef as any} className={theme.tableCls} style={{ fontSize: mSize, borderSpacing: 0, tableLayout: "fixed" }}>
                  <colgroup>
                    {excelGridCols.map((w, idx) => (
                      <col key={`excel-col-${idx}`} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <td className={theme.headerCls}>순위</td>
                      {hasRoleColumn && <td className={theme.headerCls}>직급</td>}
                      <td className={theme.headerCls}>이름</td>
                      <td className={`${theme.headerCls} text-right`}>계좌</td>
                      <td className={`${theme.headerCls} text-right`}>투네</td>
                      <td className={`${theme.headerCls} text-right`}>TOTAL</td>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map(({m, rank}) => (
                      <tr key={m.id} ref={setRowRef(m.id)} className="transition-transform will-change-transform">
                        <td className={`${theme.rowCls} text-left`}>#{rank}</td>
                        {hasRoleColumn && <td className={`${theme.rowCls}`}>{m.role || "-"}</td>}
                        <td className={`${theme.rowCls} ${theme.nameCls} truncate`}>{m.name}</td>
                        <td className={`${theme.rowCls} ${theme.accountCls} text-right`} style={{ textOverflow: "clip" }}>{fmt(m.account)}</td>
                        <td className={`${theme.rowCls} ${theme.toonCls} text-right`} style={{ textOverflow: "clip" }}>{fmt(m.toon)}</td>
                        <td className={`${theme.rowCls} text-right`}>{fmt(m.account + m.toon)}</td>
                      </tr>
                    ))}
                    {pinned.map((m) => (
                      <tr key={m.id + "-p"} ref={setRowRef(m.id + "-p")} className="transition-transform will-change-transform">
                        <td className={`${theme.rowCls} text-right`}>—</td>
                        {hasRoleColumn && <td className={`${theme.rowCls}`}></td>}
                        <td className={`${theme.rowCls} ${theme.nameCls} truncate`}>{m.name}</td>
                        <td className={`${theme.rowCls} ${theme.accountCls} text-right`} style={{ textOverflow: "clip" }}>{fmt(m.account)}</td>
                        <td className={`${theme.rowCls} ${theme.toonCls} text-right`} style={{ textOverflow: "clip" }}>{fmt(m.toon)}</td>
                        <td className={`${theme.rowCls} text-right`}>{fmt(m.account + m.toon)}</td>
                      </tr>
                    ))}
                    {showTotal && ready && (
                      <tr>
                        <td className={theme.totalWrapCls} colSpan={hasRoleColumn ? 2 : 1}>총합</td>
                        <td className={theme.totalWrapCls} />
                        <td className={`${theme.totalWrapCls} text-right`}>{fmt(sumAccount)}</td>
                        <td className={`${theme.totalWrapCls} text-right`}>{fmt(sumToon)}</td>
                        <td className={`${theme.totalWrapCls} text-right`}>{fmt(rounded)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {showBottomDonors && !tickerInMembers && (
                  <div className="mt-2" style={{ width: donorBoxWidth ? `${donorBoxWidth}px` : "100%", overflow: "hidden" }}>
                    <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                  </div>
                )}
                {tickerInMembers && (
                  <div className="mt-2" style={{ width: donorBoxWidth ? `${donorBoxWidth}px` : "100%", overflow: "hidden" }}>
                    <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                  </div>
                )}
              </div>
              {showSideDonors && donorsSide === "right" && (
                <div style={{ width: donorsWidth }}>
                  <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                </div>
              )}
            </div>
          </div>
        )}
        {showGoal && ready && goal > 0 && (
          <div className={`fixed ${posClass(goalAnchor)}`}>
            <GoalBar current={rounded} goal={goal} label={goalLabel} theme={theme} width={goalWidth} />
            {tickerInGoal && (
              <div className="mt-2" style={{ width: goalWidth, overflow: "hidden" }}>
                <DonorTicker donors={donors} theme={theme} fontSize={Math.max(10, memberSize * 0.75)} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
              </div>
            )}
          </div>
        )}
        {showPersonalGoal && ready && (
          <div className={`fixed ${personalGoalPosClass}`} style={personalGoalPosStyle}>
            <PersonalGoalBoard items={personalGoals} themeId={personalGoalTheme} fontSize={memberSize} />
            {tickerInPersonalGoal && (
              <div className="mt-2 overflow-hidden">
                <DonorTicker donors={donors} theme={theme} fontSize={Math.max(10, memberSize * 0.75)} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
              </div>
            )}
          </div>
        )}
        {effectiveShowTicker && ready && <div className={`fixed ${tickerPosClass} ${hasTickerFreePos ? "" : "mb-10"}`} style={tickerPosStyle}><DonorTicker donors={donors} theme={theme} fontSize={memberSize * 0.8} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} /></div>}
        {showTimer && <div className={`fixed ${posClass(timerAnchor)}`}><Timer elapsed={elapsed} theme={theme} fontSize={memberSize} /></div>}
        {showMission && ready && missions.length > 0 && <div className={`fixed ${posClass(missionAnchor)}`}><MissionMenu missions={missions} fontSize={memberSize * 0.9} /></div>}
      </main>
    );
  }

  if (themeId === "neonExcel") {
    const neonNameMaxCh = Math.max(nameCh, Math.round(nameMaxCh * 0.5));
    const neonNameCol = `minmax(${nameCh}ch, ${neonNameMaxCh}ch)`;
    const neonGridTemplate = hasRoleColumn
      ? `3ch 6ch ${neonNameCol} ${bankCh}ch ${toonCh}ch ${totalCh}ch`
      : `3ch ${neonNameCol} ${bankCh}ch ${toonCh}ch ${totalCh}ch`;
    return (
      <main className="transparent-bg min-h-screen no-select" style={scaledMainStyle}>
        {showMembers && ready && (
          <div className={`fixed ${listPosClass}`}>
            <div ref={containerRef} className={`flex items-start ${tight ? "gap-2" : "gap-3"}`} style={{ width: "fit-content" }}>
              {showSideDonors && donorsSide === "left" && (
                <div style={{ width: donorsWidth }}>
                  <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                </div>
              )}
              <div>
                <div ref={tableBoxRef as any} className={theme.tableCls} style={{ fontSize: mSize, width: "fit-content" }}>
                  <div className={`${theme.headerCls} grid items-center ${tight ? "py-0.5 px-1" : ""} gap-x-0`} style={{ gridTemplateColumns: neonGridTemplate }}>
                    <div className="text-left">RANK</div>
                    {hasRoleColumn && <div className="text-left">ROLE</div>}
                    <div className="text-left">MEMBER</div>
                    <div className="text-right pr-1">BANK</div>
                    <div className="text-right pl-1 border-l border-cyan-500/30">TOON</div>
                    <div className="text-right pl-1 border-l border-cyan-500/30 font-bold text-white">TOTAL</div>
                  </div>
                  {ranked.map(({m, rank}) => (
                    <div key={m.id} ref={setRowRef(m.id)} className={`${theme.rowCls} ${tight ? "py-0.5 px-1" : ""} gap-x-0 grid items-center transition-transform will-change-transform`} style={{ gridTemplateColumns: neonGridTemplate }}>
                      <div className={`${theme.nameCls} text-left`}>#{rank}</div>
                      {hasRoleColumn && <div className={`${theme.nameCls} text-left`}>{m.role || "-"}</div>}
                      <div className={`${theme.nameCls} text-left overflow-hidden whitespace-nowrap text-ellipsis`}>{m.name}</div>
                      <div className={theme.accountCls + " text-right pr-1 overflow-hidden whitespace-nowrap text-ellipsis"}>{fmt(m.account)}</div>
                      <div className={theme.toonCls + " text-right pl-1 border-l border-cyan-500/20 overflow-hidden whitespace-nowrap text-ellipsis"}>{fmt(m.toon)}</div>
                      <div className={`${theme.totalCls} text-right pl-1 border-l border-cyan-500/20 overflow-hidden whitespace-nowrap text-ellipsis`}>{fmt(m.account + m.toon)}</div>
                    </div>
                  ))}
                  {pinned.map((m) => (
                    <div key={m.id + "-p"} ref={setRowRef(m.id + "-p")} className={`${theme.rowCls} ${tight ? "py-0.5 px-1" : ""} gap-x-0 grid items-center transition-transform will-change-transform`} style={{ gridTemplateColumns: neonGridTemplate }}>
                      <div className={theme.nameCls}>—</div>
                      {hasRoleColumn && <div className={theme.nameCls}></div>}
                      <div className={theme.nameCls + " overflow-hidden whitespace-nowrap text-ellipsis"}>{m.name}</div>
                      <div className={theme.accountCls + " text-right pr-1 overflow-hidden whitespace-nowrap text-ellipsis"}>{fmt(m.account)}</div>
                      <div className={theme.toonCls + " text-right pl-1 border-l border-cyan-500/20 overflow-hidden whitespace-nowrap text-ellipsis"}>{fmt(m.toon)}</div>
                      <div className={`${theme.totalCls} text-right pl-1 border-l border-cyan-500/20 overflow-hidden whitespace-nowrap text-ellipsis`}>{fmt(m.account + m.toon)}</div>
                    </div>
                  ))}
                  {showTotal && ready && (
                    <div
                      className={`grid items-center ${theme.totalWrapCls} ${tight ? "px-1 py-0.5" : ""} gap-x-0`}
                      style={{ gridTemplateColumns: neonGridTemplate }}
                    >
                      <div />
                      {hasRoleColumn && <div />}
                      <div className="text-cyan-300 font-bold whitespace-nowrap">{hasRoleColumn ? "합계" : "총합"}</div>
                      <div className={`${theme.totalCls} text-right pr-1 overflow-hidden whitespace-nowrap text-ellipsis`} style={{ fontSize: tSize * 0.68 }}>
                        {fmt(sumAccount)}
                      </div>
                      <div className={`${theme.totalCls} text-right pl-1 border-l border-cyan-500/20 overflow-hidden whitespace-nowrap text-ellipsis`} style={{ fontSize: tSize * 0.68 }}>
                        {fmt(sumToon)}
                      </div>
                      <div className={`${theme.totalCls} text-right pl-1 border-l border-cyan-500/20 overflow-hidden whitespace-nowrap text-ellipsis`} style={{ fontSize: tSize * 0.72 }}>
                        {fmt(rounded)}
                      </div>
                    </div>
                  )}
                </div>
                {showBottomDonors && !tickerInMembers && (
                  <div className={tight ? "mt-1" : "mt-2"} style={{ width: donorBoxWidth ? `${donorBoxWidth}px` : "100%", overflow: "hidden" }}>
                    <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                  </div>
                )}
                {tickerInMembers && (
                  <div className={tight ? "mt-1" : "mt-2"} style={{ width: donorBoxWidth ? `${donorBoxWidth}px` : "100%", overflow: "hidden" }}>
                    <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                  </div>
                )}
              </div>
              {showSideDonors && donorsSide === "right" && (
                <div style={{ width: donorsWidth }}>
                  <DonorTicker donors={donors} theme={theme} fontSize={dSize} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                </div>
              )}
            </div>
          </div>
        )}
        {!showMembers && showTotal && ready && (
          <div className={`fixed ${sumPosClass}`} style={sumPosStyle}>
            <div className={theme.totalWrapCls}><div className={theme.totalCls} style={{ fontSize: totalSize }}>
              계좌 {formatManThousand(sumAccount)} · 투네 {formatManThousand(sumToon)} · 전체 {formatManThousand(rounded)}
            </div></div>
          </div>
        )}
        {showGoal && ready && goal > 0 && (
          <div className={`fixed ${posClass(goalAnchor)}`}>
            <GoalBar current={goalCurrent !== null ? goalCurrent : rounded} goal={goal} label={goalLabel} theme={theme} width={goalWidth} />
            {tickerInGoal && (
              <div className="mt-2" style={{ width: goalWidth, overflow: "hidden" }}>
                <DonorTicker donors={donors} theme={theme} fontSize={Math.max(10, memberSize * 0.75)} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
              </div>
            )}
          </div>
        )}
        {showPersonalGoal && ready && (
          <div className={`fixed ${personalGoalPosClass}`} style={personalGoalPosStyle}>
            <PersonalGoalBoard items={personalGoals} themeId={personalGoalTheme} fontSize={memberSize} />
            {tickerInPersonalGoal && (
              <div className="mt-2 overflow-hidden">
                <DonorTicker donors={donors} theme={theme} fontSize={Math.max(10, memberSize * 0.75)} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
              </div>
            )}
          </div>
        )}
        {effectiveShowTicker && ready && (
          <div className={`fixed ${tickerPosClass}`} style={tickerPosStyle}>
            <DonorTicker donors={donors} theme={theme} fontSize={memberSize * 0.8} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
          </div>
        )}
        {showTimer && <div className={`fixed ${posClass(timerAnchor)}`}><Timer elapsed={elapsed} theme={theme} fontSize={memberSize} /></div>}
        {showMission && ready && missions.length > 0 && <div className={`fixed ${posClass(missionAnchor)}`}><MissionMenu missions={missions} fontSize={memberSize * 0.9} /></div>}
      </main>
    );
  }

  return (
    <main className="transparent-bg min-h-screen text-outline-strong no-select" style={scaledMainStyle}>
      {showMembers && ready && (
        <div className={`fixed ${listPosClass} space-y-1`}>
          {ranked.map(({m, rank}) => (
            <div key={m.id} ref={setRowRef(m.id)} className={`${theme.memberCls} ${theme.rowCls} transition-transform will-change-transform whitespace-nowrap`} style={{ fontSize: mSize, lineHeight: dense ? 1 : 1.15 }}>
              <span className={theme.nameCls}>#{rank} {m.name}{m.role ? ` [${m.role}]` : ""}</span>
              <span className={theme.accountCls}>{fmt(m.account)}</span>
              <span className={theme.toonCls}>({fmt(m.toon)})</span>
            </div>
          ))}
          {pinned.map((m) => (
            <div key={m.id + "-p"} ref={setRowRef(m.id + "-p")} className={`${theme.memberCls} ${theme.rowCls} transition-transform will-change-transform whitespace-nowrap`} style={{ fontSize: mSize, lineHeight: dense ? 1 : 1.15 }}>
              <span className={theme.nameCls}>{m.name}</span>
              <span className={theme.accountCls}>{fmt(m.account)}</span>
              <span className={theme.toonCls}>({fmt(m.toon)})</span>
            </div>
          ))}
        </div>
      )}

      {showTotal && ready && (
        <div className={`fixed ${sumPosClass}`} style={sumPosStyle}>
          <div className={theme.totalWrapCls}>
            <div className={theme.totalCls} style={{ fontSize: tSize, lineHeight: 1.05 }}>
              계좌 {fmt(sumAccount)} · 투네 {fmt(sumToon)} · 전체 {fmt(rounded)}
            </div>
          </div>
        </div>
      )}

      {showGoal && ready && goal > 0 && (
        <div className={`fixed ${posClass(goalAnchor)}`}>
          <GoalBar current={goalCurrent !== null ? goalCurrent : rounded} goal={goal} label={goalLabel} theme={theme} width={goalWidth} />
          {tickerInGoal && (
            <div className="mt-2" style={{ width: goalWidth, overflow: "hidden" }}>
              <DonorTicker donors={donors} theme={theme} fontSize={Math.max(10, memberSize * 0.75)} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
            </div>
          )}
        </div>
      )}
      {showPersonalGoal && ready && (
        <div className={`fixed ${personalGoalPosClass}`} style={personalGoalPosStyle}>
          <PersonalGoalBoard items={personalGoals} themeId={personalGoalTheme} fontSize={memberSize} />
          {tickerInPersonalGoal && (
            <div className="mt-2 overflow-hidden">
              <DonorTicker donors={donors} theme={theme} fontSize={Math.max(10, memberSize * 0.75)} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
            </div>
          )}
        </div>
      )}
      {tickerInMembers && showMembers && ready && (
        <div className={`fixed ${listPosClass}`} style={{ marginTop: Math.max(48, mSize * 2.4), width: "min(640px, 75vw)" }}>
          <DonorTicker donors={donors} theme={theme} fontSize={Math.max(10, memberSize * 0.75)} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
        </div>
      )}

      {effectiveShowTicker && ready && (
        <div className={`fixed ${tickerPosClass}`} style={tickerPosStyle}>
          <DonorTicker donors={donors} theme={theme} fontSize={memberSize * 0.8} color={donorsColor} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
        </div>
      )}

      {showTimer && (
        <div className={`fixed ${posClass(timerAnchor)}`}>
          <Timer elapsed={elapsed} theme={theme} fontSize={memberSize} />
        </div>
      )}

      {showMission && ready && missions.length > 0 && (
        <div className={`fixed ${posClass(missionAnchor)}`}>
          <MissionMenu missions={missions} fontSize={memberSize * 0.9} />
        </div>
      )}
    </main>
  );
}

export default function OverlayPage() {
  return (
    <Suspense>
      <OverlayInner />
    </Suspense>
  );
}
