"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { defaultState, type AppState } from "@/lib/state";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";
import {
  mealTimerShellClass,
  mealTimerShellStyle,
  mealTimerTextClass,
  resolveMealGaugeEffects,
  resolveMealTimerTheme,
} from "@/lib/meal-gauge-effects";
import { MealGaugeFillMotion } from "@/components/meal-match/MealGaugeFillMotion";
import { resolveMealGaugeAnimStyle } from "@/lib/meal-gauge-motion";
import { MEAL_MATCH_OVERLAY_UI_REV } from "@/lib/overlay-ui-revision";
import { showOverlayDevHud, useOverlayHubCompactLayout } from "@/lib/overlay-dev-hud";

function outlineStyle(): React.CSSProperties {
  return { textShadow: "0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 -1px 0 #000, 0 0 8px rgba(0,0,0,.55)" };
}

/** 게이지 막대 안 점수 — 글로우 없이 얇은 획으로만 대비 */
function gaugeInBarScoreStyle(color: string): React.CSSProperties {
  return {
    color,
    textShadow: "none",
    WebkitTextStroke: "1px rgba(0,0,0,0.7)",
    paintOrder: "stroke fill",
  };
}

/** 엑셀표·식사대전과 동일: 운영비 행은 멤버 대전 상대로 치지 않음(`state.normalizeMember`와 맞춤) */
function isOperatingMemberLike(m: { operating?: boolean; name?: string; realName?: string } | undefined): boolean {
  if (!m) return false;
  if (Boolean(m.operating)) return true;
  const n = String(m.name || "");
  const r = String(m.realName || "");
  return /운영비/i.test(n) || /운영비/i.test(r);
}

function segmentBarStyle(seg: { memberId: string; color: string }): React.CSSProperties {
  if (seg.memberId === "__teamA") return { backgroundColor: seg.color };
  if (seg.memberId === "__teamB") return { backgroundColor: seg.color };
  return { backgroundColor: seg.color };
}

type FloatingScoreBurst = {
  id: number;
  value: string;
  color: string;
  x: number;
};

type MealDemoParticipant = {
  memberId: string;
  name: string;
  score: number;
  goal: number;
  color: string;
};

function mealDemoParticipants(demoMode: string): MealDemoParticipant[] {
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

function buildMealDemoFrozenState(demoMode: string, demoTimerSec: number): AppState {
  const base = defaultState();
  const participants = mealDemoParticipants(demoMode);
  return {
    ...base,
    updatedAt: 1,
    mealBattle: {
      ...(base.mealBattle || {}),
      participants: participants.map((p) => ({
        memberId: p.memberId,
        name: p.name,
        score: p.score,
        goal: p.goal,
        color: p.color,
        donationLinkActive: true,
      })),
      overlayTitle: "식사 대전",
      totalGoal: 100,
    },
    generalTimer: {
      remainingTime: demoTimerSec,
      isActive: true,
      lastUpdated: 1,
    },
    matchTimerEnabled: {
      ...(base.matchTimerEnabled || {}),
      general: true,
    },
  };
}

export default function MealMatchOverlayInner() {
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    setClientReady(true);
  }, []);

  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const hubPreview = sp.get("hubPreview") === "1";
  const compact = useOverlayHubCompactLayout(hubPreview);
  const overlayScalePct = (() => {
    const raw = sp.get("scalePct") || sp.get("zoomPct") || "100";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(50, Math.min(300, n));
  })();
  const overlayScale = overlayScalePct / 100;
  const overlayScaleStyle = overlayScale === 1
    ? undefined
    : ({ zoom: overlayScale } as React.CSSProperties);
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
  useEffect(() => {
    if (!hubPreview || typeof document === "undefined") return;
    document.documentElement.classList.add("overlay-hub-preview");
    return () => document.documentElement.classList.remove("overlay-hub-preview");
  }, [hubPreview]);

  const demoEnabled = sp.get("demo") === "true";
  const devHud = showOverlayDevHud({ hubPreview, demo: demoEnabled });
  const demoMode = (sp.get("demoMode") || "member").toLowerCase();
  const gaugePreview = demoEnabled && sp.get("gaugePreview") === "1";
  const demoTimerSec = (() => {
    const n = parseInt(sp.get("demoTimerSec") || "15", 10);
    return Number.isFinite(n) ? Math.max(3, Math.min(120, n)) : 15;
  })();
  const demoFrozenState = useMemo(
    () => (demoEnabled ? buildMealDemoFrozenState(demoMode, demoTimerSec) : null),
    [demoEnabled, demoMode, demoTimerSec]
  );
  const { state, ready } = useOverlayRemoteState(userId, {
    frozenState: demoFrozenState,
    enabled: !demoEnabled,
  });
  const effectsReady = (ready || demoEnabled) && clientReady;
  const [floatingScores, setFloatingScores] = useState<FloatingScoreBurst[]>([]);
  const lastScoresRef = useRef<Record<string, number>>({});
  const prevTotalScoreRef = useRef(0);
  const [gaugePulseKey, setGaugePulseKey] = useState(0);
  const floatingScoreIdRef = useRef(0);
  const [, setTimerTick] = useState(0);
  const [overlayMounted, setOverlayMounted] = useState(false);
  useEffect(() => setOverlayMounted(true), []);

  const timerState = state?.generalTimer || null;
  const usePreviewTimer = gaugePreview;
  const [previewRemaining, setPreviewRemaining] = useState(demoTimerSec);
  const [previewParticipants, setPreviewParticipants] = useState<
    { memberId: string; name: string; score: number; goal: number; color: string }[] | null
  >(null);
  const previewTickRef = useRef(0);

  useEffect(() => {
    if (!timerState && !usePreviewTimer) return;
    setTimerTick((v) => v + 1);
    const id = window.setInterval(() => setTimerTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [timerState, usePreviewTimer]);

  const remaining = usePreviewTimer
    ? previewRemaining
    : timerState
      ? getEffectiveRemainingTime(timerState)
      : 0;
  const paused = usePreviewTimer ? false : Boolean(timerState && !timerState.isActive);
  const timerText = `${String(Math.floor(Math.max(0, remaining) / 60)).padStart(2, "0")}:${String(Math.max(0, remaining) % 60).padStart(2, "0")}`;
  const showMealMatchTimer = state?.matchTimerEnabled?.general !== false;
  const timerSize = Math.max(16, Math.min(120, state?.mealBattle?.timerSize || 36));
  /** 데모·SSR 초기에는 URL만 사용 — localStorage 상태와 SSR searchParams 타이밍 차로 hydration 깨짐 방지 */
  const gaugeFx = useMemo(() => {
    const stateEffects =
      demoEnabled || !ready ? undefined : state?.mealBattle?.gaugeEffects;
    return resolveMealGaugeEffects(stateEffects, sp);
  }, [demoEnabled, ready, state?.mealBattle?.gaugeEffects, sp]);
  const timerTheme = useMemo(
    () => resolveMealTimerTheme(state?.mealBattle?.timerTheme, sp),
    [state?.mealBattle?.timerTheme, sp]
  );
  const timerLowTime =
    gaugeFx.timerTension && remaining < 10 && remaining > 0 && !paused;

  const defaultGoal = Math.max(1, state?.mealBattle?.totalGoal || 100);
  const baseParticipants = useMemo(() => {
    if (demoEnabled) {
      return mealDemoParticipants(demoMode);
    }
    const memberMap = new Map((state?.members || []).map((m) => [m.id, m]));
    const configured = (state?.mealBattle?.participants || [])
      .filter((p) => p.memberId && memberMap.has(p.memberId))
      .map((p) => {
        const syncedMember = memberMap.get(p.memberId);
        return {
          memberId: p.memberId,
          // 멤버 마스터 이름을 우선 사용해 이름 변경 시 즉시 동기화
          name: syncedMember?.name || p.name || "멤버",
          score: Math.max(0, Number(p.score || 0)),
          goal: Math.max(1, Math.floor(Number(p.goal) || 0) || defaultGoal),
          color: p.color || "#f472b6",
        };
      });
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

  useEffect(() => {
    if (!gaugePreview) {
      setPreviewParticipants(null);
      return;
    }
    let list = baseParticipants.map((p) => ({ ...p }));
    const fxRaw = (sp.get("fx") || sp.get("gaugeFx") || "").trim().toLowerCase();
    if (demoMode === "individual" && fxRaw === "critical") {
      list = list.map((p, i) => (i === 0 ? { ...p, score: 92 } : p));
    }
    setPreviewParticipants(list);
    setPreviewRemaining(demoTimerSec);
    previewTickRef.current = 0;

    const scoreId = window.setInterval(() => {
      previewTickRef.current += 1;
      const t = previewTickRef.current;
      setPreviewParticipants((prev) => {
        if (!prev?.length) return prev;
        const next = prev.map((p) => ({ ...p }));
        const leaderIdx = next.reduce(
          (best, p, i, arr) => (p.score > arr[best]!.score ? i : best),
          0
        );
        if (t % 2 === 0) {
          const challenger = (leaderIdx + 1) % next.length;
          next[challenger] = { ...next[challenger]!, score: next[challenger]!.score + 22 };
        } else {
          next[leaderIdx] = { ...next[leaderIdx]!, score: next[leaderIdx]!.score + 8 };
        }
        return next;
      });
    }, 3000);

    const timerId = window.setInterval(() => {
      setPreviewRemaining((r) => (r <= 0 ? demoTimerSec : r - 1));
    }, 1000);

    return () => {
      window.clearInterval(scoreId);
      window.clearInterval(timerId);
    };
  }, [gaugePreview, baseParticipants, demoTimerSec, demoMode, sp]);

  const participants =
    gaugePreview && previewParticipants ? previewParticipants : baseParticipants;

  const memberMapForMeal = useMemo(
    () => new Map((state?.members || []).map((m) => [m.id, m])),
    [state?.members]
  );
  /** 운영비 등 비대전 멤버를 제외한 실질 참가자 — 1명이면 팀 게이지 대신 1인 채움 UI */
  const coreMealParticipants = useMemo(
    () => participants.filter((p) => !isOperatingMemberLike(memberMapForMeal.get(p.memberId))),
    [participants, memberMapForMeal]
  );
  const soloMealParticipant =
    participants.length === 1 ? participants[0] : coreMealParticipants.length === 1 ? coreMealParticipants[0] : null;
  const shouldRenderMealMatchTimer = usePreviewTimer || showMealMatchTimer;
  const totalScore = participants.reduce((sum, p) => sum + p.score, 0);
  const totalGoalsSum = useMemo(
    () => Math.max(1, participants.reduce((s, p) => s + p.goal, 0)),
    [participants]
  );
  const rawOverlayTitle = state?.mealBattle?.overlayTitle?.trim() || "";
  const defaultOverlayTitle = "식사 대전";
  const overlayTitleBase = rawOverlayTitle || defaultOverlayTitle;
  const missionBubble = state?.mealBattle?.currentMission?.trim() || "";
  const mb = state?.mealBattle;
  const missionBubbleBg = mb?.missionBubbleBg || "#db2777";
  const missionBubbleTextColor = mb?.missionBubbleTextColor || "#ffffff";
  const gaugeTrackBg = mb?.gaugeTrackBg || "rgba(255,255,255,0.30)";
  const gaugeFillColor = mb?.gaugeFillColor || "#f472b6";
  const requestedFillGaugeMode = demoEnabled
    ? demoMode === "individual"
    : state?.mealMatchSettings?.mode === "individual";
  const fillGaugeMode = requestedFillGaugeMode || Boolean(soloMealParticipant);
  const overlayTitle = useMemo(() => {
    if (!soloMealParticipant) return overlayTitleBase;
    if (overlayTitleBase !== defaultOverlayTitle) return overlayTitleBase;
    return `${soloMealParticipant.name} 1인 식사 대전`;
  }, [soloMealParticipant, overlayTitleBase, defaultOverlayTitle]);
  const fillPercent = useMemo(() => {
    if (!fillGaugeMode) return 0;
    if (soloMealParticipant) {
      const g = Math.max(1, Math.floor(Number(soloMealParticipant.goal) || 0) || defaultGoal);
      return Math.min(100, (soloMealParticipant.score / g) * 100);
    }
    return Math.min(100, (totalScore / totalGoalsSum) * 100);
  }, [fillGaugeMode, soloMealParticipant, totalScore, totalGoalsSum, defaultGoal]);

  useEffect(() => {
    if (!effectsReady || !gaugeFx.gaugeMotion) {
      prevTotalScoreRef.current = totalScore;
      return;
    }
    if (totalScore > prevTotalScoreRef.current + 0.01) {
      setGaugePulseKey((k) => k + 1);
    }
    prevTotalScoreRef.current = totalScore;
  }, [totalScore, effectsReady, gaugeFx.gaugeMotion]);

  const remainingSeconds = shouldRenderMealMatchTimer ? Math.max(0, remaining) : null;
  const isCritical =
    gaugeFx.critical &&
    ((fillGaugeMode && fillPercent >= 90) ||
      (remainingSeconds !== null && remainingSeconds <= 10 && remainingSeconds > 0 && !paused));

  /** 맥동 scale은 아래 이름 줄과 겹쳐 보이므로 분할 모드에서는 막대 그림자만 사용 */
  const gaugeScaleAnim = useMemo((): number | [number, number, number] => {
    if (fillGaugeMode) {
      if (isCritical) return [1, 1.04, 1];
      if (!gaugeFx.gaugeMotion) return 1;
      return [1, 1.03, 1];
    }
    return 1;
  }, [fillGaugeMode, isCritical, gaugeFx.gaugeMotion]);

  const gaugeAnimStyle = useMemo(
    () => resolveMealGaugeAnimStyle(sp, gaugeFx.gaugeMotion),
    [sp, gaugeFx.gaugeMotion]
  );
  const showGaugeFillMotion = gaugeFx.gaugeMotion && gaugeAnimStyle !== "none" && !isCritical;

  const gaugeShadow = isCritical
    ? "0 0 35px 10px rgba(239, 68, 68, 0.55)"
    : "0 10px 15px -3px rgb(0 0 0 / 0.25)";

  const criticalFillBackground = isCritical
    ? `linear-gradient(90deg, ${gaugeFillColor}, #f87171, ${gaugeFillColor})`
    : gaugeFillColor;
  const scoreTextColor = mb?.scoreTextColor || "#ffffff";
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
      const totalGoal = Math.max(1, teamAgg.aGoal + teamAgg.bGoal);
      if (teamAgg.aScore + teamAgg.bScore <= 0) {
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
      const pA = Math.min(100, (teamAgg.aScore / totalGoal) * 100);
      const pB = Math.min(100 - pA, (teamAgg.bScore / totalGoal) * 100);
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
    const slotPercent = 100 / Math.max(1, participants.length);
    return participants.map((p, idx) => {
      const fillPercent = Math.min(100, (p.score / Math.max(1, p.goal)) * 100);
      return {
        ...p,
        // 멤버 슬롯은 고정(자리 유지), 슬롯 내부 채움만 점수에 따라 증가
        percent: slotPercent,
        fillPercent,
        center: ((idx + 0.5) / participants.length) * 100,
      };
    });
  }, [
    participants,
    fillGaugeMode,
    useTeamSplitGauge,
    teamAgg,
    teamAName,
    teamBName,
    teamAColor,
    teamBColor,
  ]);

  const sortedByScore = [...participants].sort((a, b) => b.score - a.score);
  const topMemberId = soloMealParticipant?.memberId || sortedByScore[0]?.memberId || "";
  const leaderKey = useMemo(() => {
    if (useTeamSplitGauge) {
      if (teamAgg.aScore > teamAgg.bScore) return "__teamA";
      if (teamAgg.bScore > teamAgg.aScore) return "__teamB";
      return "__teamA";
    }
    return topMemberId;
  }, [useTeamSplitGauge, teamAgg.aScore, teamAgg.bScore, topMemberId]);

  const unassignedScore = Math.max(0, totalScore - teamAgg.aScore - teamAgg.bScore);
  /** 운영비만 상대편인 1인 UI에서는 팀 색 띠 대신 단일 채움색 */
  const operatingExcludedSoloUi = Boolean(soloMealParticipant && participants.length > 1);
  const showTeamStripeInFill =
    fillGaugeMode && teamBattleEnabled && hasTeamRoster && totalScore > 0 && !operatingExcludedSoloUi;

  const showLeaderCrown = Boolean(gaugeFx.rankUp && leaderKey);

  useEffect(() => {
    if (!effectsReady) return;
    const currentScores: Record<string, number> = {};
    for (const p of participants) {
      currentScores[p.memberId] = p.score;
    }
    const prev = lastScoresRef.current;
    const hasPrev = Object.keys(prev).length > 0;

    if (hasPrev && gaugeFx.floatingScore) {
      for (const p of participants) {
        const oldScore = prev[p.memberId] ?? 0;
        const newScore = p.score;
        if (newScore <= oldScore) continue;
        const diff = newScore - oldScore;
        const seg = segments.find((s) => s.memberId === p.memberId);
        const x = fillGaugeMode
          ? Math.random() * 60 + 20
          : seg?.center ?? 50;
        const floatId = ++floatingScoreIdRef.current;
        setFloatingScores((burst) => [
          ...burst,
          {
            id: floatId,
            value: `+${Math.round(diff)}`,
            color: p.color || "#fff",
            x,
          },
        ]);
        window.setTimeout(() => {
          setFloatingScores((burst) => burst.filter((f) => f.id !== floatId));
        }, 1600);
      }
    }
    lastScoresRef.current = currentScores;
  }, [participants, segments, fillGaugeMode, effectsReady, gaugeFx.floatingScore]);

  if (!clientReady) {
    return (
      <main className="min-h-[12rem] w-full bg-transparent p-4 text-white">
        <div className="mx-auto max-w-3xl rounded-xl border border-white/10 bg-black/40 p-4 text-center text-sm text-white/70">
          식사 대전 오버레이 로딩…
        </div>
      </main>
    );
  }

  return (
    <main
      data-overlay-ui={MEAL_MATCH_OVERLAY_UI_REV}
      suppressHydrationWarning
      className={`w-full overflow-visible bg-transparent text-white ${
        compact ? "min-h-0 p-2" : "min-h-screen p-5"
      }`}
    >
      <div className="mx-auto w-full" style={overlayContainerStyle}>
        <div className={`text-center ${compact ? "mb-0" : "mb-0"}`}>
          <div className="pastel-text-outline text-4xl font-black tracking-wide text-pink-100" style={outlineStyle()}>
            {overlayTitle}
          </div>
          {!demoEnabled && devHud ? (
            <p className="mt-1 text-xs font-semibold text-pink-200/75">합산 목표 · 멤버별 채움 게이지</p>
          ) : null}
          {devHud && demoEnabled && (
            <div className="mx-auto mt-1 flex flex-col items-center gap-0.5">
              <div className="inline-flex rounded-full border border-pink-200/80 bg-pink-300/35 px-3 py-1 text-xs font-bold text-pink-100">
                DEMO · {demoMode === "team" ? "팀 모드" : demoMode === "individual" ? "개인(단일게이지) 모드" : "개인 분할 모드"}
                {gaugePreview ? " · 자동 연출" : ""}
                {demoEnabled ? ` · ${MEAL_MATCH_OVERLAY_UI_REV}` : ""}
              </div>
              {overlayMounted &&
              (sp.get("fx") || sp.get("gaugeFx") || sp.get("gaugeAnim") || sp.get("timerTheme")) ? (
                <div className="text-[10px] font-medium text-pink-200/90" suppressHydrationWarning>
                  {sp.get("fx") || sp.get("gaugeFx") ? (
                    <>
                      fx:{" "}
                      {[
                        gaugeFx.critical && "critical",
                        gaugeFx.floatingScore && "floating",
                        gaugeFx.rankUp && "rank",
                        gaugeFx.timerTension && "timer",
                        gaugeFx.gaugeMotion && "motion",
                      ]
                        .filter(Boolean)
                        .join(", ") || "none"}
                    </>
                  ) : null}
                  {sp.get("gaugeAnim") ? (
                    <span>
                      {sp.get("fx") || sp.get("gaugeFx") ? " · " : ""}
                      gaugeAnim: {sp.get("gaugeAnim")}
                    </span>
                  ) : null}
                  {sp.get("timerTheme") ? (
                    <span>
                      {sp.get("fx") || sp.get("gaugeFx") || sp.get("gaugeAnim") ? " · " : ""}
                      timerTheme: {timerTheme}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
          {shouldRenderMealMatchTimer ? (
            <div
              className={`${mealTimerShellClass(timerTheme, paused)} ${compact ? "!mt-0.5" : "!mt-1"}`}
              style={mealTimerShellStyle(timerTheme)}
            >
              <motion.span
                className={mealTimerTextClass(timerTheme, paused, timerLowTime)}
                style={{ fontSize: `${timerSize}px`, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}
                animate={{
                  scale:
                    gaugeFx.timerTension && !paused && remaining > 0 && remaining <= 5
                      ? [1, 1.14, 1]
                      : 1,
                }}
                transition={{
                  scale: {
                    duration: 0.5,
                    repeat: gaugeFx.timerTension && !paused && remaining > 0 && remaining <= 5 ? Infinity : 0,
                    ease: "easeInOut",
                  },
                }}
              >
                <span suppressHydrationWarning>{timerText}</span>
              </motion.span>
            </div>
          ) : null}
        </div>

        <div className={`overflow-visible px-4 pb-3 ${compact ? "mt-0.5" : "mt-1"}`}>
          <div className="relative mx-auto w-full">
            {missionBubble ? (
              <div
                className="pastel-text-outline mx-auto mb-2 w-max max-w-[95%] rounded-2xl border border-white/20 bg-white/35 px-4 py-1.5 text-center text-lg font-black backdrop-blur-md"
                style={{ ...outlineStyle(), backgroundColor: missionBubbleBg, color: missionBubbleTextColor }}
              >
                {missionBubble}
              </div>
            ) : null}
            {devHud ? (
              <p
                className="mb-2 text-center text-[9px] font-bold text-pink-200/90"
                data-meal-ui-features="score-in-bar-names-below"
              >
                UI {MEAL_MATCH_OVERLAY_UI_REV} · 막대 안 점수 / 아래 이름
              </p>
            ) : null}
            <div className="flex w-full flex-col">
              <div
                className={`relative z-0 mb-0 w-full shrink-0 overflow-hidden rounded-full ${
                  compact ? "h-14 sm:h-16" : "h-16 sm:h-[4.5rem]"
                }`}
                data-meal-gauge-bar="true"
              >
              <motion.div
                className="h-full w-full"
                animate={{
                  scale: gaugeScaleAnim,
                  boxShadow: isCritical
                    ? [
                        "0 0 30px 12px rgba(248, 113, 113, 0.65)",
                        "0 0 40px 14px rgba(248, 113, 113, 0.85)",
                        "0 0 30px 12px rgba(248, 113, 113, 0.65)",
                      ]
                    : gaugeShadow,
                }}
                transition={{
                  scale: {
                    duration: isCritical ? 0.7 : 0.42,
                    repeat: isCritical ? Infinity : 0,
                    repeatType: isCritical ? "reverse" : undefined,
                  },
                  boxShadow: { duration: 1.1, repeat: isCritical ? Infinity : 0 },
                }}
              >
              <div
                className={`relative h-full w-full overflow-hidden ${showGaugeTrackBorder ? "border border-inherit rounded-full" : ""}`}
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
                        <div className="relative flex h-full w-full overflow-hidden">
                          <div
                            className="h-full shrink-0"
                            style={{
                              width: `${(teamAgg.aScore / Math.max(1, totalScore)) * 100}%`,
                              backgroundColor: teamAColor,
                            }}
                          />
                          <div
                            className="h-full shrink-0"
                            style={{
                              width: `${(teamAgg.bScore / Math.max(1, totalScore)) * 100}%`,
                              backgroundColor: teamBColor,
                            }}
                          />
                          {unassignedScore > 0 ? (
                            <div
                              className="h-full min-w-0 flex-1"
                              style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
                            />
                          ) : null}
                          {isCritical ? (
                            <motion.div
                              className="pointer-events-none absolute inset-0"
                              style={{
                                background:
                                  "repeating-linear-gradient(90deg, transparent, transparent 40%, rgba(255,255,255,0.22) 40%, rgba(255,255,255,0.22) 60%)",
                                backgroundSize: "80px 100%",
                              }}
                              animate={{ backgroundPositionX: ["0px", "80px"] }}
                              transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                              aria-hidden
                            />
                          ) : null}
                        </div>
                      ) : (
                        <motion.div
                          className="relative h-full w-full overflow-hidden"
                          style={{
                            background: criticalFillBackground,
                            backgroundSize: isCritical ? "200% 100%" : undefined,
                          }}
                          animate={
                            isCritical
                              ? { backgroundPosition: ["0% 50%", "200% 50%"] }
                              : { backgroundPosition: "0% 50%" }
                          }
                          transition={{
                            backgroundPosition: {
                              duration: 2.5,
                              repeat: isCritical ? Infinity : 0,
                              ease: "linear",
                            },
                          }}
                        >
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/25 to-transparent" />
                          {showGaugeFillMotion ? (
                            <MealGaugeFillMotion style={gaugeAnimStyle} />
                          ) : null}
                        </motion.div>
                      )}
                    </motion.div>
                    <div
                      className="absolute inset-0 z-[2] flex items-center justify-center pointer-events-none px-2"
                      style={outlineStyle()}
                    >
                      <span className="text-base sm:text-lg font-black tabular-nums" style={{ color: scoreTextColor }}>
                        {soloMealParticipant ? (
                          <>
                            {showLeaderCrown ? (
                              <span className="mr-1 inline-block" aria-hidden>
                                👑
                              </span>
                            ) : null}
                            {soloMealParticipant.name} {Math.round(soloMealParticipant.score)} /{" "}
                            {Math.round(soloMealParticipant.goal)}
                          </>
                        ) : (
                          `${Math.round(totalScore)} / ${Math.round(totalGoalsSum)}`
                        )}
                      </span>
                    </div>
                  </>
                ) : (
                  <motion.div layout className="absolute inset-0 flex" transition={{ type: "spring", stiffness: 120, damping: 20 }}>
                    {segments.map((seg) => {
                      const fillW = Math.max(
                        0,
                        Math.min(100, (seg as { fillPercent?: number }).fillPercent ?? seg.percent)
                      );
                      return (
                        <motion.div
                          key={seg.memberId}
                          layout
                          animate={{ width: `${seg.percent}%` }}
                          transition={{ type: "spring", stiffness: 120, damping: 20 }}
                          className="relative h-full min-w-0"
                        >
                          <motion.div
                            className="h-full overflow-hidden"
                            animate={{ width: `${fillW}%` }}
                            transition={{ type: "spring", stiffness: 120, damping: 20 }}
                            style={segmentBarStyle(seg)}
                          >
                            {isCritical ? (
                              <motion.div
                                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-white/20 to-transparent"
                                animate={{ opacity: [0.35, 0.65, 0.35] }}
                                transition={{ duration: 0.9, repeat: Infinity }}
                                aria-hidden
                              />
                            ) : showGaugeFillMotion ? (
                              <MealGaugeFillMotion style={gaugeAnimStyle} />
                            ) : null}
                          </motion.div>
                        </motion.div>
                      );
                    })}
                    <div className="pointer-events-none absolute left-0 right-0 top-0 z-[1] h-[20%] bg-white/20" />
                  </motion.div>
                )}

                {isCritical ? (
                  <motion.div
                    className="pointer-events-none absolute inset-0 z-[3] bg-gradient-to-r from-transparent via-white/35 to-transparent"
                    animate={{ x: ["-120%", "220%"] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                    aria-hidden
                  />
                ) : null}

                {!fillGaugeMode ? (
                  <div className="pointer-events-none absolute inset-0 z-[30] flex items-center" aria-hidden>
                    {segments.map((seg) => {
                      const narrow = seg.percent < 22;
                      const lineSize = narrow
                        ? "text-[11px] leading-none sm:text-xs"
                        : seg.percent < 34
                          ? "text-xs leading-none sm:text-sm"
                          : "text-sm leading-none sm:text-base";
                      return (
                        <motion.div
                          key={`gauge-score-${seg.memberId}`}
                          className="absolute top-1/2 max-w-[92%] -translate-x-1/2 -translate-y-1/2 px-0.5 text-center"
                          style={{ left: `${seg.center}%` }}
                          animate={{ left: `${seg.center}%` }}
                          transition={{ type: "spring", stiffness: 120, damping: 20 }}
                        >
                          <span
                            className={`inline-block whitespace-nowrap font-black tabular-nums ${lineSize}`}
                            style={gaugeInBarScoreStyle(scoreTextColor)}
                          >
                            {Math.round(seg.score)}
                            <span className="font-bold opacity-90"> / {Math.round(seg.goal)}</span>
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              </motion.div>

              {overlayMounted && gaugeFx.floatingScore ? (
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 z-50 h-full overflow-visible"
                  aria-hidden
                >
                  {floatingScores.map((item) => (
                    <motion.div
                      key={item.id}
                      className="absolute -translate-x-1/2 text-2xl font-black tabular-nums drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)] sm:text-3xl"
                      style={{
                        left: `${item.x}%`,
                        top: "35%",
                        color: item.color,
                        ...outlineStyle(),
                      }}
                      initial={{ opacity: 0, y: 0, scale: 0.55 }}
                      animate={{
                        opacity: [0, 1, 1, 0],
                        y: [0, -48, -168],
                        scale: [0.55, 1.18, 1.05],
                      }}
                      transition={{ duration: 1.5, ease: "easeOut", times: [0, 0.22, 1] }}
                    >
                      {item.value}
                    </motion.div>
                  ))}
                </div>
              ) : null}
              </div>

              {!fillGaugeMode && segments.length > 0 ? (
                <div
                  className={`relative z-20 mt-16 w-full shrink-0 border-t-4 border-pink-400/70 bg-black/70 pt-5 sm:mt-20 ${
                    compact ? "!mt-14" : ""
                  }`}
                  data-meal-member-names="true"
                  data-meal-ui-rev={MEAL_MATCH_OVERLAY_UI_REV}
                  aria-label="멤버 이름"
                >
                  <div
                    className="grid w-full gap-2"
                    style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
                  >
                    {segments.map((seg) => (
                      <div key={`tag-${seg.memberId}`} className="flex justify-center px-1">
                        <span
                          className={`inline-flex max-w-full items-center whitespace-nowrap text-lg font-black pastel-text-outline sm:text-xl ${
                            showLeaderCrown && seg.memberId === leaderKey ? "text-yellow-200" : "text-pink-100"
                          }`}
                          style={outlineStyle()}
                        >
                          {showLeaderCrown && seg.memberId === leaderKey ? (
                            <span className="mr-1 inline-block leading-none" aria-hidden>
                              👑
                            </span>
                          ) : null}
                          {seg.name}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

      </div>
    </main>
  );
}

