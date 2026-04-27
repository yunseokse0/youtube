"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);

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

function outlineStyle(): React.CSSProperties {
  return { textShadow: "0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 -1px 0 #000, 0 0 8px rgba(0,0,0,.55)" };
}

function segmentBarStyle(seg: { memberId: string; color: string }): React.CSSProperties {
  if (seg.memberId === "__teamA") return { background: "linear-gradient(90deg,#f9a8d4,#fbcfe8)" };
  if (seg.memberId === "__teamB") return { background: "linear-gradient(90deg,#fda4af,#fecdd3)" };
  return { backgroundColor: seg.color };
}

export default function MealMatchOverlayPage() {
  const sp = useSearchParams();
  const userId = sp.get("u") || "finalent";
  const demoEnabled = sp.get("demo") === "true";
  const demoMode = (sp.get("demoMode") || "member").toLowerCase();
  const { state, ready } = useRemoteState(userId);
  const [overtakeText, setOvertakeText] = useState<string | null>(null);
  const lastLeaderRef = useRef<string>("");

  const timerState = state?.generalTimer || null;
  const remaining = timerState ? getEffectiveRemainingTime(timerState) : 0;
  const paused = Boolean(timerState && !timerState.isActive);
  const timerText = `${String(Math.floor(Math.max(0, remaining) / 60)).padStart(2, "0")}:${String(Math.max(0, remaining) % 60).padStart(2, "0")}`;
  const showMealMatchTimer = state?.matchTimerEnabled?.general !== false;
  const timerSize = Math.max(16, Math.min(120, state?.mealBattle?.timerSize || 36));
  const timerLowTime = remaining < 10 && remaining > 0 && !paused;

  const defaultGoal = Math.max(1, state?.mealBattle?.totalGoal || 100);
  const participants = useMemo(() => {
    if (demoEnabled) {
      if (demoMode === "team") {
        return [
          { memberId: "demo-a1", name: "멤버1", score: 72, goal: 100, color: "#f472b6" },
          { memberId: "demo-a2", name: "멤버2", score: 28, goal: 100, color: "#f9a8d4" },
          { memberId: "demo-b1", name: "멤버3", score: 55, goal: 100, color: "#fb7185" },
          { memberId: "demo-b2", name: "멤버4", score: 18, goal: 100, color: "#fda4af" },
        ];
      }
      if (demoMode === "individual") {
        return [
          { memberId: "demo-i1", name: "멤버1", score: 40, goal: 100, color: "#f472b6" },
          { memberId: "demo-i2", name: "멤버2", score: 35, goal: 100, color: "#f9a8d4" },
          { memberId: "demo-i3", name: "멤버3", score: 20, goal: 100, color: "#fb7185" },
        ];
      }
      return [
        { memberId: "demo-m1", name: "멤버1", score: 62, goal: 100, color: "#f472b6" },
        { memberId: "demo-m2", name: "멤버2", score: 31, goal: 100, color: "#f9a8d4" },
        { memberId: "demo-m3", name: "멤버3", score: 14, goal: 100, color: "#fb7185" },
      ];
    }
    const configured = (state?.mealBattle?.participants || [])
      .filter((p) => p.memberId)
      .map((p) => ({
        memberId: p.memberId,
        name: p.name || "멤버",
        score: Math.max(0, Number(p.score || 0)),
        goal: Math.max(1, Math.floor(Number(p.goal) || 0) || defaultGoal),
        color: p.color || "#f472b6",
      }));
    if (configured.length > 0) return configured;
    const fallbackColors = ["#f472b6", "#fb7185", "#f9a8d4", "#fda4af", "#e879f9"];
    return (state?.members || []).map((m, idx) => ({
      memberId: m.id,
      name: m.name || "멤버",
      score: 0,
      goal: defaultGoal,
      color: fallbackColors[idx % fallbackColors.length],
    }));
  }, [demoEnabled, demoMode, state?.mealBattle?.participants, state?.members, defaultGoal]);
  const totalScore = participants.reduce((sum, p) => sum + p.score, 0);
  const totalGoalsSum = useMemo(
    () => Math.max(1, participants.reduce((s, p) => s + p.goal, 0)),
    [participants]
  );
  const overlayTitle = state?.mealBattle?.overlayTitle?.trim() || "식사 대전";
  const missionBubble = state?.mealBattle?.currentMission?.trim() || "";
  const mb = state?.mealBattle;
  const missionBubbleBg = mb?.missionBubbleBg || "#db2777";
  const missionBubbleTextColor = mb?.missionBubbleTextColor || "#ffffff";
  const gaugeTrackBg = mb?.gaugeTrackBg || "rgba(255,255,255,0.30)";
  const gaugeFillColor = mb?.gaugeFillColor || "#f472b6";
  const fillGaugeMode = demoEnabled
    ? demoMode === "individual"
    : state?.mealMatchSettings?.mode === "individual";
  const fillPercent = useMemo(() => {
    if (!fillGaugeMode) return 0;
    return Math.min(100, (totalScore / totalGoalsSum) * 100);
  }, [fillGaugeMode, totalScore, totalGoalsSum]);
  const scoreTextColor = mb?.scoreTextColor || "#ffffff";
  const nameTagBg = "rgba(255, 255, 255, 0.82)";
  const nameTagTextColor = "#ec4899";
  const showPanelBorder = Boolean(mb?.showPanelBorder);
  const panelBorderColor = mb?.panelBorderColor || "rgba(255,255,255,0.25)";
  const showGaugeTrackBorder = Boolean(mb?.showGaugeTrackBorder);
  const gaugeTrackBorderColor = mb?.gaugeTrackBorderColor || "rgba(255,255,255,0.2)";

  const teamBattleEnabled = demoEnabled
    ? demoMode === "team"
    : Boolean(mb?.teamBattleEnabled);
  const teamAName = mb?.teamAName?.trim() || "A팀";
  const teamBName = mb?.teamBName?.trim() || "B팀";
  const teamAGoalSetting = Math.max(0, Math.floor(Number(mb?.teamAGoal || 0) || 0));
  const teamBGoalSetting = Math.max(0, Math.floor(Number(mb?.teamBGoal || 0) || 0));
  const teamAColor = mb?.teamAColor || "#f472b6";
  const teamBColor = mb?.teamBColor || "#fb7185";
  const teamAIds = useMemo(() => {
    if (demoEnabled && demoMode === "team") return new Set(["demo-a1", "demo-a2"]);
    return new Set(mb?.teamAMemberIds || []);
  }, [demoEnabled, demoMode, mb?.teamAMemberIds]);
  const teamBIds = useMemo(() => {
    if (demoEnabled && demoMode === "team") return new Set(["demo-b1", "demo-b2"]);
    return new Set(mb?.teamBMemberIds || []);
  }, [demoEnabled, demoMode, mb?.teamBMemberIds]);

  const hasTeamRoster = useMemo(
    () => participants.some((p) => teamAIds.has(p.memberId) || teamBIds.has(p.memberId)),
    [participants, teamAIds, teamBIds]
  );

  const teamAgg = useMemo(() => {
    let aScore = 0;
    let aGoal = 0;
    let bScore = 0;
    let bGoal = 0;
    for (const p of participants) {
      if (teamAIds.has(p.memberId)) {
        aScore += p.score;
        aGoal += p.goal;
      } else if (teamBIds.has(p.memberId)) {
        bScore += p.score;
        bGoal += p.goal;
      }
    }
    const resolvedAGoal = teamAGoalSetting > 0 ? teamAGoalSetting : Math.max(1, aGoal);
    const resolvedBGoal = teamBGoalSetting > 0 ? teamBGoalSetting : Math.max(1, bGoal);
    return { aScore, bScore, aGoal: resolvedAGoal, bGoal: resolvedBGoal };
  }, [participants, teamAIds, teamBIds, teamAGoalSetting, teamBGoalSetting]);

  const useTeamSplitGauge = teamBattleEnabled && !fillGaugeMode && hasTeamRoster;

  const segments = useMemo(() => {
    if (!participants.length || fillGaugeMode) return [];
    if (useTeamSplitGauge) {
      const wA = teamAgg.aScore / teamAgg.aGoal;
      const wB = teamAgg.bScore / teamAgg.bGoal;
      const sumW = wA + wB;
      if (teamAgg.aScore + teamAgg.bScore <= 0 || sumW <= 0) {
        return [
          {
            memberId: "__teamA",
            name: teamAName,
            score: teamAgg.aScore,
            goal: teamAgg.aGoal,
            color: teamAColor,
            percent: 0,
            center: 25,
          },
          {
            memberId: "__teamB",
            name: teamBName,
            score: teamAgg.bScore,
            goal: teamAgg.bGoal,
            color: teamBColor,
            percent: 0,
            center: 75,
          },
        ];
      }
      const pA = (wA / sumW) * 100;
      const pB = (wB / sumW) * 100;
      return [
        {
          memberId: "__teamA",
          name: teamAName,
          score: teamAgg.aScore,
          goal: teamAgg.aGoal,
          color: teamAColor,
          percent: pA,
          center: pA / 2,
        },
        {
          memberId: "__teamB",
          name: teamBName,
          score: teamAgg.bScore,
          goal: teamAgg.bGoal,
          color: teamBColor,
          percent: pB,
          center: pA + pB / 2,
        },
      ];
    }
    const weights = participants.map((p) => p.score / Math.max(1, p.goal));
    const sumW = weights.reduce((a, b) => a + b, 0);
    if (totalScore <= 0 || sumW <= 0) {
      return participants.map((p, idx) => ({
        ...p,
        percent: 0,
        center: ((idx + 0.5) / participants.length) * 100,
      }));
    }
    let cumulative = 0;
    return participants.map((p, idx) => {
      const percent = (weights[idx]! / sumW) * 100;
      const center = cumulative + percent / 2;
      cumulative += percent;
      return { ...p, percent, center };
    });
  }, [
    participants,
    totalScore,
    fillGaugeMode,
    useTeamSplitGauge,
    teamAgg,
    teamAName,
    teamBName,
    teamAColor,
    teamBColor,
  ]);

  const sortedByScore = [...participants].sort((a, b) => b.score - a.score);
  const topMemberId = sortedByScore[0]?.memberId || "";
  const leaderKey = useMemo(() => {
    if (useTeamSplitGauge) {
      if (teamAgg.aScore > teamAgg.bScore) return "__teamA";
      if (teamAgg.bScore > teamAgg.aScore) return "__teamB";
      return "__teamA";
    }
    return topMemberId;
  }, [useTeamSplitGauge, teamAgg.aScore, teamAgg.bScore, topMemberId]);

  const unassignedScore = Math.max(0, totalScore - teamAgg.aScore - teamAgg.bScore);
  const showTeamStripeInFill =
    fillGaugeMode && teamBattleEnabled && hasTeamRoster && totalScore > 0;

  useEffect(() => {
    if (!ready || !leaderKey) return;
    const prev = lastLeaderRef.current;
    if (prev && prev !== leaderKey) {
      setOvertakeText("RANK UP!");
      const t = window.setTimeout(() => setOvertakeText(null), 1400);
      return () => window.clearTimeout(t);
    }
    lastLeaderRef.current = leaderKey;
  }, [leaderKey, ready]);

  return (
    <main className="min-h-screen w-full bg-transparent text-white p-5">
      <div className="mx-auto max-w-[1350px]">
        <div className="mb-4 text-center">
          <div className="pastel-text-outline text-4xl font-black tracking-wide text-pink-100" style={outlineStyle()}>
            {overlayTitle}
          </div>
          {demoEnabled && (
            <div className="mx-auto mt-2 inline-flex rounded-full border border-pink-200/80 bg-pink-300/35 px-3 py-1 text-xs font-bold text-pink-100">
              DEMO · {demoMode === "team" ? "팀 모드" : demoMode === "individual" ? "개인(단일게이지) 모드" : "개인 분할 모드"}
            </div>
          )}
          {showMealMatchTimer ? (
            <div
              className={`mx-auto mt-2 inline-flex min-w-[5.5ch] items-center justify-center rounded-full border border-white/20 bg-white/40 px-5 py-2 backdrop-blur-md ${
                paused ? "animate-pulse opacity-90" : ""
              }`}
              style={{ borderColor: "rgba(251, 207, 232, 0.55)", background: "rgba(251, 207, 232, 0.35)" }}
            >
              <span
                className={`font-extrabold tabular-nums pastel-text-outline ${
                  paused ? "text-pastel-orange" : timerLowTime ? "text-pastel-alert animate-pastel-timer-low" : "text-pastel-ink"
                }`}
                style={{ fontSize: `${timerSize}px`, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}
              >
                {timerText}
              </span>
            </div>
          ) : null}
        </div>

        <div
          className={`rounded-3xl border border-white/40 bg-[linear-gradient(135deg,#FFDEE9_0%,#FCE4EC_50%,#FFD1FF_100%)] px-4 py-6 backdrop-blur-xl shadow-[0_8px_32px_0_rgba(255,182,193,0.3)] ${showPanelBorder ? "border-2" : ""}`}
          style={showPanelBorder ? { borderColor: panelBorderColor } : undefined}
        >
          <div className={`relative ${missionBubble ? "h-36" : "h-32"}`}>
            {missionBubble ? (
              <div
                className="pastel-text-outline absolute left-1/2 top-0 z-10 -translate-x-1/2 rounded-2xl border border-white/20 bg-white/35 px-4 py-1.5 text-lg font-black backdrop-blur-md"
                style={{ ...outlineStyle(), backgroundColor: missionBubbleBg, color: missionBubbleTextColor }}
              >
                {missionBubble}
              </div>
            ) : null}
            <div className={`absolute left-0 right-0 ${missionBubble ? "top-14" : "top-2"}`}>
              <div
                className={`relative h-14 rounded-full overflow-hidden ${showGaugeTrackBorder ? "border" : ""}`}
                style={{
                  backgroundColor: gaugeTrackBg,
                  ...(showGaugeTrackBorder ? { borderColor: gaugeTrackBorderColor } : {}),
                }}
              >
                {fillGaugeMode ? (
                  <>
                    <motion.div
                      className="absolute left-0 top-0 bottom-0 z-[1] rounded-full overflow-hidden"
                      initial={false}
                      animate={{ width: `${fillPercent}%` }}
                      transition={{ type: "spring", stiffness: 115, damping: 22 }}
                    >
                      {showTeamStripeInFill ? (
                        <div className="flex h-full w-full">
                          <div
                            className="h-full shrink-0"
                            style={{
                              width: `${(teamAgg.aScore / Math.max(1, totalScore)) * 100}%`,
                                background: "linear-gradient(90deg,#f9a8d4,#fbcfe8)",
                            }}
                          />
                          <div
                            className="h-full shrink-0"
                            style={{
                              width: `${(teamAgg.bScore / Math.max(1, totalScore)) * 100}%`,
                                background: "linear-gradient(90deg,#fda4af,#fecdd3)",
                            }}
                          />
                          {unassignedScore > 0 ? (
                            <div
                              className="h-full min-w-0 flex-1"
                              style={{
                                backgroundColor: "rgba(0,0,0,0.35)",
                              }}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <div className="relative h-full w-full overflow-hidden">
                          <div
                            className={`h-full w-full ${
                              gaugeFillColor === "#f472b6"
                                ? "bg-gradient-to-r from-pink-200 to-pink-400"
                                : ""
                            }`}
                            style={gaugeFillColor !== "#f472b6" ? { backgroundColor: gaugeFillColor } : undefined}
                          />
                          <div className="pointer-events-none absolute left-0 right-0 top-0 h-[20%] bg-white/20" />
                        </div>
                      )}
                    </motion.div>
                    <div
                      className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none px-2"
                      style={outlineStyle()}
                    >
                      <span className="text-base sm:text-lg font-black tabular-nums" style={{ color: scoreTextColor }}>
                        {Math.round(totalScore)} / {Math.round(totalGoalsSum)}
                      </span>
                    </div>
                  </>
                ) : (
                  <motion.div layout className="absolute inset-0 flex" transition={{ type: "spring", stiffness: 120, damping: 20 }}>
                    {segments.map((seg) => (
                      <motion.div
                        key={seg.memberId}
                        layout
                        animate={{ width: `${seg.percent}%` }}
                        transition={{ type: "spring", stiffness: 120, damping: 20 }}
                        style={segmentBarStyle(seg)}
                        className="relative h-full"
                      />
                    ))}
                    <div className="pointer-events-none absolute left-0 right-0 top-0 h-[20%] bg-white/20" />
                  </motion.div>
                )}
              </div>
            </div>

            {!fillGaugeMode
              ? segments.map((seg) => (
                  <motion.div
                    key={`score-${seg.memberId}`}
                    className="absolute top-6 -translate-x-1/2 flex flex-col items-center leading-tight"
                    style={{ left: `${seg.center}%`, color: scoreTextColor, ...outlineStyle() }}
                    animate={{ left: `${seg.center}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  >
                    <span className="text-3xl sm:text-4xl font-black tabular-nums">{Math.round(seg.score)}</span>
                    <span className="text-[11px] sm:text-xs font-bold opacity-90 tabular-nums">
                      / {Math.round(seg.goal)}
                    </span>
                  </motion.div>
                ))
              : null}

            {!fillGaugeMode
              ? segments.map((seg) => (
                  <motion.div
                    key={`tag-${seg.memberId}`}
                    className={`absolute -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-1 text-2xl font-black shadow-sm pastel-text-outline ${
                      missionBubble ? "top-[114px]" : "top-[100px]"
                    }`}
                    style={{ left: `${seg.center}%`, backgroundColor: nameTagBg, color: nameTagTextColor }}
                    animate={{ left: `${seg.center}%` }}
                    transition={{ type: "spring", stiffness: 120, damping: 20 }}
                  >
                    {seg.name}
                  </motion.div>
                ))
              : null}
          </div>
        </div>

        <AnimatePresence>
          {overtakeText ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.1, y: -12 }}
              transition={{ duration: 0.35 }}
              className="pastel-text-outline mt-6 text-center text-6xl font-black text-pastel-yellow"
              style={outlineStyle()}
            >
              {overtakeText}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}

