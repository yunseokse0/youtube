"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppState, totalAccount, Member, Donor, MissionItem, roundToThousand, formatManThousand, loadStateFromApi } from "@/lib/state";
import MissionMenu from "@/components/MissionMenu";
import MissionTicker from "@/components/MissionTicker";

function useRemoteState(): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  
  // Initial state loading
  useEffect(() => {
    const fetchInitialState = async () => {
      const data = await loadStateFromApi();
      if (data) {
        lastUpdatedRef.current = data.updatedAt;
        setState(data);
      }
    };
    fetchInitialState();
  }, []);

  // Polling for updates
  useEffect(() => {
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
        console.error("Failed to fetch state:", error);
      }
      if (running) setTimeout(poll, 1500);
    };
    
    if (state) {
      poll();
    }
    
    return () => { running = false; };
  }, []); // Only run once on mount

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
  const { state: s, ready } = useRemoteState();
  const members = useMemo(() => (ready && s ? s.members : []), [ready, s]);
  const donors = useMemo(() => (ready && s ? s.donors : []), [ready, s]);
  const missions = useMemo(() => (ready && s ? s.missions || [] : []), [ready, s]);
  const sum = useMemo(() => (ready && s ? totalAccount(s) : 0), [ready, s]);
  const rounded = useMemo(() => roundToThousand(sum), [sum]);
  const displaySum = useCountUp(rounded, 800);
  const sp = useSearchParams();

  const scale = Math.max(0.3, Math.min(3, parseFloat(sp.get("scale") || "1")));
  const memberSize = Math.max(10, Math.min(80, parseInt(sp.get("memberSize") || "24", 10)));
  const totalSize = Math.max(14, Math.min(160, parseInt(sp.get("totalSize") || "64", 10)));
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
  const showTicker = sp.get("showTicker") === "true";
  const showTimer = sp.get("showTimer") === "true";
  const goalRaw = parseInt(sp.get("goal") || "0", 10);
  const goal = isNaN(goalRaw) ? 0 : goalRaw;
  const goalLabel = sp.get("goalLabel") || "목표 금액";
  const goalWidth = Math.max(200, Math.min(800, parseInt(sp.get("goalWidth") || "400", 10)));
  const goalAnchor = (sp.get("goalAnchor") || "bc").toLowerCase();
  const timerStart = sp.get("timerStart") ? parseInt(sp.get("timerStart")!, 10) : null;
  const timerAnchor = (sp.get("timerAnchor") || "tr").toLowerCase();
  const showMission = sp.get("showMission") === "true";
  const missionAnchor = (sp.get("missionAnchor") || "br").toLowerCase();

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
        {showMembers && ready && (
          <div className={`fixed ${listPosClass}`}>
            <table className={theme.tableCls} style={{ fontSize: memberSize, borderSpacing: 0 }}>
              <thead>
                <tr>
                  <td className={theme.headerCls}>이름</td>
                  <td className={theme.headerCls}>계좌</td>
                  <td className={theme.headerCls}>투네</td>
                </tr>
              </thead>
              <tbody>
                {members.map((m: Member) => (
                  <tr key={m.id}>
                    <td className={`${theme.rowCls} ${theme.nameCls}`}>{m.name}</td>
                    <td className={`${theme.rowCls} ${theme.accountCls} text-right`}>{formatManThousand(m.account)}</td>
                    <td className={`${theme.rowCls} ${theme.toonCls} text-right`}>{formatManThousand(m.toon)}</td>
                  </tr>
                ))}
                {showTotal && ready && (
                  <tr>
                    <td className={theme.totalWrapCls}>총합</td>
                    <td className={`${theme.totalWrapCls} text-right`} colSpan={2}>{formatManThousand(displaySum)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {showGoal && ready && goal > 0 && (
          <div className={`fixed ${posClass(goalAnchor)}`}>
            <GoalBar current={rounded} goal={goal} label={goalLabel} theme={theme} width={goalWidth} />
          </div>
        )}
        {showTicker && ready && <div className={`fixed ${posClass("bc")} mb-10`}><DonorTicker donors={donors} theme={theme} fontSize={memberSize * 0.8} /></div>}
        {showTimer && <div className={`fixed ${posClass(timerAnchor)}`}><Timer elapsed={elapsed} theme={theme} fontSize={memberSize} /></div>}
        {showMission && ready && missions.length > 0 && <MissionTicker missions={missions} fontSize={memberSize * 0.9} />}
      </main>
    );
  }

  if (themeId === "neonExcel") {
    return (
      <main className="transparent-bg min-h-screen no-select" style={{ zoom: scale }}>
        {showMembers && ready && (
          <div className={`fixed ${listPosClass}`}>
            <div className={theme.tableCls} style={{ fontSize: memberSize }}>
              <div className={`grid grid-cols-4 ${theme.headerCls}`}>
                <div className="col-span-1">MEMBER</div>
                <div className="col-span-1 text-right">BANK</div>
                <div className="col-span-1 text-right">TOON</div>
                <div className="col-span-1 text-right font-bold text-white">TOTAL</div>
              </div>
              {members.map((m: Member) => (
                <div key={m.id} className={`grid grid-cols-4 items-center ${theme.rowCls}`}>
                  <div className={theme.nameCls}>{m.name}</div>
                  <div className={theme.accountCls}>{formatManThousand(m.account)}</div>
                  <div className={theme.toonCls}>{formatManThousand(m.toon)}</div>
                  <div className={`${theme.totalCls} text-right`}>{formatManThousand(m.account + m.toon)}</div>
                </div>
              ))}
              {showTotal && ready && (
                <div className={`grid grid-cols-4 items-center ${theme.totalWrapCls}`}>
                  <div className="text-cyan-300 font-bold col-span-2">TOTAL</div>
                  <div className={`${theme.totalCls} text-right col-span-2`} style={{ fontSize: totalSize * 0.7 }}>{formatManThousand(displaySum)}</div>
                </div>
              )}
            </div>
          </div>
        )}
        {!showMembers && showTotal && ready && (
          <div className={`fixed ${sumPosClass}`} style={sumPosStyle}>
            <div className={theme.totalWrapCls}><div className={theme.totalCls} style={{ fontSize: totalSize }}>{formatManThousand(displaySum)}</div></div>
          </div>
        )}
        {showGoal && ready && goal > 0 && <div className={`fixed ${posClass(goalAnchor)}`}><GoalBar current={rounded} goal={goal} label={goalLabel} theme={theme} width={goalWidth} /></div>}
        {showTicker && ready && <div className="fixed bottom-4 left-0 right-0"><DonorTicker donors={donors} theme={theme} fontSize={memberSize * 0.8} /></div>}
        {showTimer && <div className={`fixed ${posClass(timerAnchor)}`}><Timer elapsed={elapsed} theme={theme} fontSize={memberSize} /></div>}
        {showMission && ready && missions.length > 0 && <MissionTicker missions={missions} fontSize={memberSize * 0.9} />}
      </main>
    );
  }

  return (
    <main className="transparent-bg min-h-screen text-outline-strong no-select" style={{ zoom: scale }}>
      {showMembers && ready && (
        <div className={`fixed ${listPosClass} space-y-1`}>
          {members.map((m: Member) => (
            <div key={m.id} className={`${theme.memberCls} ${theme.rowCls}`} style={{ fontSize: memberSize, lineHeight: dense ? 1 : 1.15 }}>
              <span className={theme.nameCls}>{m.name}</span>
              <span className={theme.accountCls}>{formatManThousand(m.account)}</span>
              <span className={theme.toonCls}>({formatManThousand(m.toon)})</span>
            </div>
          ))}
        </div>
      )}

      {showTotal && ready && (
        <div className={`fixed ${sumPosClass}`} style={sumPosStyle}>
          <div className={theme.totalWrapCls}>
            <div className={theme.totalCls} style={{ fontSize: totalSize, lineHeight: 1.05 }}>
              계좌 총합 {formatManThousand(displaySum)}
            </div>
          </div>
        </div>
      )}

      {showGoal && ready && goal > 0 && (
        <div className={`fixed ${posClass(goalAnchor)}`}>
          <GoalBar current={rounded} goal={goal} label={goalLabel} theme={theme} width={goalWidth} />
        </div>
      )}

      {showTicker && ready && (
        <div className={`fixed bottom-4 left-0 right-0`}>
          <DonorTicker donors={donors} theme={theme} fontSize={memberSize * 0.8} />
        </div>
      )}

      {showTimer && (
        <div className={`fixed ${posClass(timerAnchor)}`}>
          <Timer elapsed={elapsed} theme={theme} fontSize={memberSize} />
        </div>
      )}

      {showMission && ready && missions.length > 0 && (
        <MissionTicker missions={missions} fontSize={memberSize * 0.9} />
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
