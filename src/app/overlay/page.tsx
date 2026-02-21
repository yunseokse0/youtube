"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppState, totalAccount, Member, Donor, MissionItem, roundToThousand, formatManThousand, loadStateFromApi } from "@/lib/state";
import { useSSEConnection } from "@/lib/sse-client";
import { createModuleLogger } from "@/lib/logger";
import MissionMenu from "@/components/MissionMenu";
import MissionTicker from "@/components/MissionTicker";

const logger = createModuleLogger('Overlay');

function useRemoteState(): { state: AppState | null; ready: boolean; connected: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const { connected } = useSSEConnection((data) => {
    if (data.type === 'overlay_update' && data.updatedAt && data.updatedAt !== lastUpdatedRef.current) {
      lastUpdatedRef.current = data.updatedAt;
      setState(data);
      logger.info('SSE 상태 업데이트 수신', { 
        updatedAt: data.updatedAt,
        members: data.members?.length,
        donors: data.donors?.length,
        memberData: data.members?.map((m: Member) => ({ name: m.name, account: m.account, toon: m.toon }))
      });
    } else if (data.type === 'preset_update' && data.preset) {
      // 프리셋 업데이트 메시지 처리 - 오버레이 설정 업데이트
      logger.info('프리셋 업데이트 수신, 오버레이 설정 업데이트', data.preset);
      
      // 프리셋 데이터를 오버레이 설정으로 변환하여 업데이트
      setState((prevState) => {
        if (!prevState) return prevState;
        
        const preset = data.preset;
        const newOverlaySettings = {
          scale: parseFloat(preset.scale || '1'),
          memberSize: parseInt(preset.memberSize || '24', 10),
          totalSize: parseInt(preset.totalSize || '64', 10),
          dense: preset.dense || false,
          anchor: preset.anchor || 'tl',
          sumAnchor: preset.sumAnchor || 'bc',
          sumFree: preset.sumFree || false,
          sumX: parseFloat(preset.sumX || '50'),
          sumY: parseFloat(preset.sumY || '90'),
          theme: preset.theme || 'default',
          showMembers: preset.showMembers !== false,
          showTotal: preset.showTotal !== false,
          showGoal: preset.showGoal || false,
          goal: parseInt(preset.goal || '0', 10),
          goalLabel: preset.goalLabel || '목표 금액',
          goalWidth: parseInt(preset.goalWidth || '400', 10),
          goalAnchor: preset.goalAnchor || 'bc',
          showTicker: preset.showTicker || false,
          showTimer: preset.showTimer || false,
          timerStart: preset.timerStart || null,
          timerAnchor: preset.timerAnchor || 'tr',
          showMission: preset.showMission || false,
          missionAnchor: preset.missionAnchor || 'br'
        };
        
        return {
          ...prevState,
          overlaySettings: newOverlaySettings,
          updatedAt: Date.now()
        };
      });
    }
  });
  
  // Initial state loading
  useEffect(() => {
    const fetchInitialState = async () => {
      const data = await loadStateFromApi();
      if (data) {
        lastUpdatedRef.current = data.updatedAt;
        setState(data);
        logger.info('초기 상태 로드됨', { updatedAt: data.updatedAt });
      }
    };
    fetchInitialState();
  }, []);

  // Fallback polling when SSE is not connected
  useEffect(() => {
    if (connected) return; // Don't poll if SSE is connected
    
    let running = true;
    const poll = async () => {
      if (!running || !state) return;
      try {
        const res = await fetch(`/api/state?_t=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data && data.updatedAt && data.updatedAt !== lastUpdatedRef.current) {
            lastUpdatedRef.current = data.updatedAt;
            setState(data);
          }
        }
      } catch (error) {
        logger.error('상태 페치 실패', error);
      }
      if (running) setTimeout(poll, 1500);
    };
    
    if (state) {
      poll();
    }
    
    return () => {
      running = false;
    };
  }, [connected, state]);

  return { state, ready: state !== null, connected };
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
    accountCls: "text-blue-700 font-bold",
    toonCls: "text-gray-500",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#217346] px-3 py-1",
    rowCls: "border border-[#d4d4d4] px-3 py-1",
    tableCls: "bg-white/95 border-collapse shadow-lg",
    headerCls: "bg-[#217346] text-white font-bold px-3 py-1 border border-[#1a5c37] text-sm",
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
    accountCls: "ml-2 text-fuchsia-400 drop-shadow-[0_0_8px_rgba(255,0,255,0.7)]",
    toonCls: "ml-1 text-yellow-300 drop-shadow-[0_0_6px_rgba(255,255,0,0.5)]",
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
    accountCls: "text-right text-slate-400 font-mono",
    toonCls: "text-right text-slate-400 font-mono",
    totalCls: "font-mono font-black text-cyan-400 italic",
    totalWrapCls: "bg-cyan-900/30 px-3 py-1 border-t-2 border-cyan-500/50",
    rowCls: "bg-slate-900/40 py-2 px-3 border-b border-slate-800 last:border-none",
    tableCls: "border-2 border-cyan-500/50 bg-black/40 rounded-lg overflow-hidden animate-neonPulse",
    headerCls: "bg-cyan-900/30 text-cyan-300 text-xs font-mono py-1 px-3 border-b border-cyan-500/50 uppercase",
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

function DonorTicker({ donors, theme, fontSize }: { donors: Donor[]; theme: typeof THEMES.default; fontSize: number }) {
  const recent = useMemo(() => {
    return donors
      .filter(d => d.amount > 0) // 금액이 0이 아닌 후원자만 표시
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, 5);
  }, [donors]);

  if (!recent.length) return null;

  return (
    <div className="overflow-hidden whitespace-nowrap" style={{ fontSize }}>
      <div className="inline-block animate-ticker">
        {recent.map((d, i) => (
          <span key={d.id || i} className={`${theme.tickerCls} mx-4`}>
            ♥ {d.name} {formatManThousand(d.amount)}
          </span>
        ))}
        {recent.map((d, i) => (
          <span key={`dup-${d.id || i}`} className={`${theme.tickerCls} mx-4`}>
            ♥ {d.name} {formatManThousand(d.amount)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timer({ elapsed, theme, fontSize }: { elapsed: string | null; theme: typeof THEMES.default; fontSize: number }) {
  if (!elapsed) return null;
  return (
    <div className={theme.timerCls} style={{ fontSize }}>
      {elapsed}
    </div>
  );
}

function OverlayInner() {
  const { state: s, ready, connected } = useRemoteState();
  const members = useMemo(() => (ready && s ? s.members : []), [ready, s]);
  const donors = useMemo(() => (ready && s ? s.donors : []), [ready, s]);
  const missions = useMemo(() => (ready && s ? s.missions || [] : []), [ready, s]);
  const sum = useMemo(() => (ready && s ? totalAccount(s) : 0), [ready, s]);
  const toonSum = useMemo(() => (ready && s ? s.members.reduce((acc, m) => acc + m.toon, 0) : 0), [ready, s]);
  const rounded = useMemo(() => roundToThousand(sum), [sum]);
  const displaySum = useCountUp(rounded, 800);
  
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <OverlayContentWrapper 
        state={s} ready={ready} connected={connected} members={members} donors={donors} 
        missions={missions} sum={sum} toonSum={toonSum} rounded={rounded} displaySum={displaySum} 
      />
    </Suspense>
  );
}

function OverlayContentWrapper({ state: s, ready, connected, members, donors, missions, sum, toonSum, rounded, displaySum }: {
  state: AppState | null;
  ready: boolean;
  connected: boolean;
  members: Member[];
  donors: Donor[];
  missions: MissionItem[];
  sum: number;
  toonSum: number;
  rounded: number;
  displaySum: number;
}) {
  const sp = useSearchParams();
  
  // Log SSE connection status
  useEffect(() => {
    logger.debug('SSE 연결 상태', { connected });
  }, [connected]);
  
  // Use overlay settings from state, with URL params as fallback for backward compatibility
  const overlaySettings = s?.overlaySettings;
  
  const scale = Math.max(0.3, Math.min(3, overlaySettings?.scale ?? parseFloat(sp.get("scale") || "1")));
  const memberSize = Math.max(10, Math.min(80, overlaySettings?.memberSize ?? parseInt(sp.get("memberSize") || "24", 10)));
  const totalSize = Math.max(10, Math.min(200, overlaySettings?.totalSize ?? parseInt(sp.get("totalSize") || "64", 10)));
  const dense = overlaySettings?.dense ?? (sp.get("dense") === "true");
  const anchor = overlaySettings?.anchor ?? (sp.get("anchor") as any) ?? "tl";
  const sumAnchor = overlaySettings?.sumAnchor ?? (sp.get("sumAnchor") as any) ?? "bc";
  const sumFree = overlaySettings?.sumFree ?? (sp.get("sumFree") === "true");
  const sumX = Math.max(0, Math.min(100, overlaySettings?.sumX ?? parseFloat(sp.get("sumX") || "50")));
  const sumY = Math.max(0, Math.min(100, overlaySettings?.sumY ?? parseFloat(sp.get("sumY") || "90")));
  const themeId = (overlaySettings?.theme ?? sp.get("theme") ?? "default") as ThemeId;
  const showMembers = overlaySettings?.showMembers ?? (sp.get("showMembers") !== "false");
  const showTotal = overlaySettings?.showTotal ?? (sp.get("showTotal") !== "false");
  const showGoal = overlaySettings?.showGoal ?? (sp.get("showGoal") === "true");
  const goal = overlaySettings?.goal ?? parseInt(sp.get("goal") || "0", 10);
  const goalLabel = overlaySettings?.goalLabel ?? sp.get("goalLabel") ?? "목표 금액";
  const goalWidth = Math.max(100, Math.min(800, overlaySettings?.goalWidth ?? parseInt(sp.get("goalWidth") || "400", 10)));
  const goalAnchor = overlaySettings?.goalAnchor ?? (sp.get("goalAnchor") as any) ?? "bc";
  const showTicker = overlaySettings?.showTicker ?? (sp.get("showTicker") === "true");
  const showTimer = overlaySettings?.showTimer ?? (sp.get("showTimer") === "true");
  const timerStart = overlaySettings?.timerStart ?? (sp.get("timerStart") ? new Date(sp.get("timerStart")!).getTime() : null);
  const timerAnchor = overlaySettings?.timerAnchor ?? (sp.get("timerAnchor") as any) ?? "tr";
  const showMission = overlaySettings?.showMission ?? (sp.get("showMission") === "true");
  const missionAnchor = overlaySettings?.missionAnchor ?? (sp.get("missionAnchor") as any) ?? "br";
  
  // 개별 위치 설정 (URL 파라미터에서 읽기)
  const memberPosition = overlaySettings?.memberPosition || (sp.get("memberX") && sp.get("memberY") ? {
    x: parseFloat(sp.get("memberX")!),
    y: parseFloat(sp.get("memberY")!)
  } : undefined);
  const totalPosition = overlaySettings?.totalPosition || (sp.get("totalX") && sp.get("totalY") ? {
    x: parseFloat(sp.get("totalX")!),
    y: parseFloat(sp.get("totalY")!)
  } : undefined);
  const goalPosition = overlaySettings?.goalPosition || (sp.get("goalX") && sp.get("goalY") ? {
    x: parseFloat(sp.get("goalX")!),
    y: parseFloat(sp.get("goalY")!)
  } : undefined);
  const tickerPosition = overlaySettings?.tickerPosition || (sp.get("tickerX") && sp.get("tickerY") ? {
    x: parseFloat(sp.get("tickerX")!),
    y: parseFloat(sp.get("tickerY")!)
  } : undefined);
  const timerPosition = overlaySettings?.timerPosition || (sp.get("timerX") && sp.get("timerY") ? {
    x: parseFloat(sp.get("timerX")!),
    y: parseFloat(sp.get("timerY")!)
  } : undefined);
  const missionPosition = overlaySettings?.missionPosition || (sp.get("missionX") && sp.get("missionY") ? {
    x: parseFloat(sp.get("missionX")!),
    y: parseFloat(sp.get("missionY")!)
  } : undefined);
  
  return (
    <OverlayContent 
      state={s} ready={ready} connected={connected} members={members} donors={donors} 
      missions={missions} sum={sum} toonSum={toonSum} rounded={rounded} displaySum={displaySum}
      scale={scale} memberSize={memberSize} totalSize={totalSize} dense={dense} anchor={anchor}
      sumAnchor={sumAnchor} sumFree={sumFree} sumX={sumX} sumY={sumY} themeId={themeId}
      showMembers={showMembers} showTotal={showTotal} showGoal={showGoal} goal={goal}
      goalLabel={goalLabel} goalWidth={goalWidth} goalAnchor={goalAnchor} showTicker={showTicker}
      showTimer={showTimer} timerStart={timerStart} timerAnchor={timerAnchor} showMission={showMission}
      missionAnchor={missionAnchor}
      memberPosition={memberPosition} totalPosition={totalPosition} goalPosition={goalPosition}
      tickerPosition={tickerPosition} timerPosition={timerPosition} missionPosition={missionPosition}
    />
  );
}

function OverlayContent({ state: s, ready, connected, members, donors, missions, sum, toonSum, rounded, displaySum, scale, memberSize, totalSize, dense, anchor, sumAnchor, sumFree, sumX, sumY, themeId, showMembers, showTotal, showGoal, goal, goalLabel, goalWidth, goalAnchor, showTicker, showTimer, timerStart, timerAnchor, showMission, missionAnchor, memberPosition, totalPosition, goalPosition, tickerPosition, timerPosition, missionPosition }: {
  state: AppState | null;
  ready: boolean;
  connected: boolean;
  members: Member[];
  donors: Donor[];
  missions: MissionItem[];
  sum: number;
  toonSum: number;
  rounded: number;
  displaySum: number;
  scale: number;
  memberSize: number;
  totalSize: number;
  dense: boolean;
  anchor: string;
  sumAnchor: string;
  sumFree: boolean;
  sumX: number;
  sumY: number;
  themeId: ThemeId;
  showMembers: boolean;
  showTotal: boolean;
  showGoal: boolean;
  goal: number;
  goalLabel: string;
  goalWidth: number;
  goalAnchor: string;
  showTicker: boolean;
  showTimer: boolean;
  timerStart: number | null;
  timerAnchor: string;
  showMission: boolean;
  missionAnchor: string;
  memberPosition?: { x?: number; y?: number; width?: number; height?: number; anchor?: string };
  totalPosition?: { x?: number; y?: number; width?: number; height?: number; anchor?: string };
  goalPosition?: { x?: number; y?: number; width?: number; height?: number; anchor?: string };
  tickerPosition?: { x?: number; y?: number; width?: number; height?: number; anchor?: string };
  timerPosition?: { x?: number; y?: number; width?: number; height?: number; anchor?: string };
  missionPosition?: { x?: number; y?: number; width?: number; height?: number; anchor?: string };
}) {
  // Log SSE connection status
  useEffect(() => {
    logger.debug('SSE 연결 상태', { connected });
  }, [connected]);
  
  const theme = THEMES[themeId] || THEMES.default;
  
  const hasFreePos = sumFree && sumX !== undefined && sumY !== undefined;

  const elapsed = useElapsed(timerStart);

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

  // 개별 요소 위치 설정 함수
  const getElementPosition = (position?: { x?: number; y?: number; width?: number; height?: number; anchor?: string }, defaultAnchor?: string) => {
    if (position && position.x !== undefined && position.y !== undefined) {
      const style: React.CSSProperties = {
        left: `${position.x}%`,
        top: `${position.y}%`,
        transform: "translate(-50%, -50%)",
        position: 'fixed'
      };
      if (position.width) style.width = `${position.width}px`;
      if (position.height) style.height = `${position.height}px`;
      return { style, className: "" };
    }
    return { style: undefined, className: posClass(position?.anchor || defaultAnchor || "tl") };
  };

  const listPosClass =
    anchor === "tr" ? "top-4 right-4 items-end text-right" :
    anchor === "bl" ? "bottom-4 left-4" :
    anchor === "br" ? "bottom-4 right-4 items-end text-right" :
    "top-4 left-4";

  const sumPosStyle: React.CSSProperties | undefined = hasFreePos
    ? { left: `${sumX}%`, top: `${sumY}%`, transform: "translate(-50%, -50%)" }
    : undefined;
  const sumPosClass = hasFreePos ? "" : posClass(sumAnchor);

  if (themeId === "excel") {
    return (
      <main className="transparent-bg min-h-screen no-select" style={{ zoom: scale }}>
        {showTicker && ready && (
          <div className={`${getElementPosition(tickerPosition, 'tc').className}`} style={getElementPosition(tickerPosition, 'tc').style}>
            <DonorTicker donors={donors} theme={theme} fontSize={memberSize} />
          </div>
        )}
        {showTimer && timerStart && ready && (
          <div className={`${getElementPosition(timerPosition, 'tr').className}`} style={getElementPosition(timerPosition, 'tr').style}>
            <Timer elapsed={elapsed} theme={theme} fontSize={memberSize} />
          </div>
        )}
        {showMission && ready && (
          <div className={`${getElementPosition(missionPosition, 'tl').className}`} style={getElementPosition(missionPosition, 'tl').style}>
            <MissionTicker missions={missions} />
          </div>
        )}
        {showMembers && ready && (
          <div className={`${getElementPosition(memberPosition, anchor).className}`} style={getElementPosition(memberPosition, anchor).style}>
            <table className={theme.tableCls} style={{ fontSize: memberSize, borderSpacing: 0 }}>
              <thead>
                <tr>
                  <td className={theme.headerCls}>이름</td>
                  <td className={theme.headerCls}>계좌</td>
                  <td className={theme.headerCls}>투네</td>
                </tr>
              </thead>
              <tbody>
                {members
                  .filter(m => m.account > 0 || m.toon > 0) // 계좌나 투네 금액이 0이 아닌 멤버만 표시
                  .map((m: Member) => (
                    <tr key={m.id}>
                      <td className={`${theme.rowCls} ${theme.nameCls}`}>{m.name}</td>
                      <td className={`${theme.rowCls} ${theme.accountCls} text-right`}>{formatManThousand(m.account)}</td>
                      <td className={`${theme.rowCls} ${theme.toonCls} text-right`}>{formatManThousand(m.toon)}</td>
                    </tr>
                  ))}
                {showTotal && ready && (
                  <tr>
                    <td className={theme.totalWrapCls}>총합</td>
                    <td className={`${theme.rowCls} ${theme.accountCls} text-right`}>{formatManThousand(sum)}</td>
                    <td className={`${theme.rowCls} ${theme.toonCls} text-right`}>{formatManThousand(toonSum)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    );
  }

  // 기본 테마 (simple) 또는 다른 테마들
  return (
    <main className="transparent-bg min-h-screen no-select" style={{ zoom: scale }}>
      {showTicker && ready && (
        <div className={`${getElementPosition(tickerPosition, 'tc').className}`} style={getElementPosition(tickerPosition, 'tc').style}>
          <DonorTicker donors={donors} theme={theme} fontSize={memberSize} />
        </div>
      )}
      {showTimer && timerStart && ready && (
        <div className={`${getElementPosition(timerPosition, 'tr').className}`} style={getElementPosition(timerPosition, 'tr').style}>
          <Timer elapsed={elapsed} theme={theme} fontSize={memberSize} />
        </div>
      )}
      {showMission && ready && (
        <div className={`${getElementPosition(missionPosition, 'tl').className}`} style={getElementPosition(missionPosition, 'tl').style}>
          <MissionTicker missions={missions} />
        </div>
      )}
      {showMembers && ready && (
        <div className={`${getElementPosition(memberPosition, anchor).className}`} style={getElementPosition(memberPosition, anchor).style}>
          <table className={theme.tableCls} style={{ fontSize: memberSize, borderSpacing: 0 }}>
            <thead>
              <tr>
                <td className={theme.headerCls}>이름</td>
                <td className={theme.headerCls}>계좌</td>
                <td className={theme.headerCls}>투네</td>
              </tr>
            </thead>
            <tbody>
              {members
                .filter(m => m.account > 0 || m.toon > 0)
                .map((m: Member) => (
                  <tr key={m.id}>
                    <td className={`${theme.rowCls} ${theme.nameCls}`}>{m.name}</td>
                    <td className={`${theme.rowCls} ${theme.accountCls} text-right`}>{formatManThousand(m.account)}</td>
                    <td className={`${theme.rowCls} ${theme.toonCls} text-right`}>{formatManThousand(m.toon)}</td>
                  </tr>
                ))}
              {showTotal && ready && (
                <tr>
                  <td className={theme.totalWrapCls}>총합</td>
                  <td className={`${theme.rowCls} ${theme.accountCls} text-right`}>{formatManThousand(sum)}</td>
                  <td className={`${theme.rowCls} ${theme.toonCls} text-right`}>{formatManThousand(toonSum)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

export default function OverlayPage() {
  return <OverlayInner />;
}