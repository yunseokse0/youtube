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
import {
  buildBattleOverlayContainerStyle,
  clampBattleOverlayContentWidthPct,
  clampBattleOverlayScalePct,
} from "@/lib/overlay-battle-scale";
import BattleRulesBox from "@/components/battle/BattleRulesBox";
import BattleTeamColumnBoard from "@/components/battle/BattleTeamColumnBoard";
import BattleGaugeFitScore from "@/components/battle/BattleGaugeFitScore";
import { mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { recalculateMealParticipantScoresFromDonors } from "@/lib/battle-donation-sync";
import { getSigMatchGaugeTheme } from "@/lib/sig-match-gauge-theme";

function outlineStyle(): React.CSSProperties {
  return { textShadow: "0 1px 0 #000, 1px 0 0 #000, -1px 0 0 #000, 0 -1px 0 #000, 0 0 8px rgba(0,0,0,.55)" };
}

/** 시그 대전과 통일된 esports 골드 글로우 & 스트로크 타이틀 */
const sigMatchTitleStyle: React.CSSProperties = {
  color: "#fffbeb",
  textShadow:
    "0 2px 10px rgba(0,0,0,0.95), 0 0 28px rgba(251,191,36,0.4), -1px 0 0 rgba(0,0,0,0.85), 1px 0 0 rgba(0,0,0,0.85)",
};

/** 멤버명 — 엑셀표 및 시그 대전과 동일한 굵은 외곽선 */
const sigMemberNameStyle: React.CSSProperties = {
  color: "#ffffff",
  WebkitTextStroke: "0.85px rgba(0,0,0,0.98)",
  paintOrder: "stroke fill",
  textShadow:
    "0 0 2px rgba(0,0,0,1), 0 2px 4px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.9), -1px 0 2px rgba(0,0,0,0.9), 0 -1px 2px rgba(0,0,0,0.9)",
};

const sigMemberAmountStyle: React.CSSProperties = {
  color: "#ffffff",
  WebkitTextStroke: "0.65px rgba(0,0,0,0.95)",
  paintOrder: "stroke fill",
  textShadow:
    "0 0 2px rgba(0,0,0,1), 0 1px 4px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.85), -1px 0 2px rgba(0,0,0,0.85)",
};

function sigGaugeInBarScoreStyle(leading: boolean): React.CSSProperties {
  return {
    color: "#ffffff",
    WebkitTextStroke: "0.65px rgba(0,0,0,0.95)",
    paintOrder: "stroke fill",
    textShadow:
      "0 0 2px rgba(0,0,0,1), 0 1px 4px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.85), -1px 0 2px rgba(0,0,0,0.85)",
    ...(leading ? { filter: "brightness(1.08)" } : {}),
  };
}

/** 시그 대전과 통일된 esports 다크 글래스 타이머 알약 */
function SigCleanTimerPill({
  timerPaused,
  timerText,
  compact,
}: {
  timerPaused: boolean;
  timerText: string;
  compact: boolean;
}) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-md px-2.5 py-0.5 font-black tabular-nums text-white ring-1 ring-white/15 ${
        timerPaused ? "bg-neutral-700/90" : "bg-neutral-950/85"
      } ${compact ? "text-base sm:text-lg" : "text-lg sm:text-xl"}`}
      style={{
        textShadow:
          "-0.8px 0 0 rgba(6, 12, 24, 0.95), 0.8px 0 0 rgba(6, 12, 24, 0.95), 0 -0.8px 0 rgba(6, 12, 24, 0.95), 0 0.8px 0 rgba(6, 12, 24, 0.95), 0 0 1px rgba(6, 12, 24, 0.95)",
        WebkitTextStroke: "0.8px rgba(6, 12, 24, 0.95)",
        paintOrder: "stroke fill",
      }}
      data-sig-clean-timer="true"
    >
      <span suppressHydrationWarning>{timerText}</span>
    </div>
  );
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
    matchTimer: {
      remainingTime: demoTimerSec,
      isActive: true,
      lastUpdated: 1,
    },
    matchTimerEnabled: {
      ...(base.matchTimerEnabled || {}),
      general: true,
      match: true,
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
  const overlayScalePct = clampBattleOverlayScalePct(sp.get("scalePct") || sp.get("zoomPct") || "100");
  const contentWidthPct = clampBattleOverlayContentWidthPct(
    sp.get("contentWidthPct") || sp.get("maxWidthPct") || "100"
  );
  const overlayContainerStyle = buildBattleOverlayContainerStyle(overlayScalePct, contentWidthPct);
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
    storageDebounceMs: 0,
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

  const timerState = state?.matchTimer ?? state?.generalTimer ?? null;
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
  const showMealMatchTimer = state?.matchTimerEnabled?.match !== false;
  const timerSize = Math.max(16, Math.min(120, state?.mealBattle?.timerSize || 36));

  const theme = useMemo(() => getSigMatchGaugeTheme(sp.get("theme")), [sp]);

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
    const rawParticipants = state?.mealBattle?.participants || [];
    const hasLinkedParticipant = rawParticipants.some((p) => p.donationLinkActive);
    const resolvedMealBattle = hasLinkedParticipant && state?.donors
      ? {
          ...state.mealBattle,
          participants: recalculateMealParticipantScoresFromDonors(
            state.mealBattle,
            state.donors
          ),
        }
      : state?.mealBattle;
    const configured = (resolvedMealBattle?.participants || [])
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
  }, [demoEnabled, demoMode, state?.mealBattle, state?.donors, state?.members, defaultGoal]);

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
  const mealPositions = state?.memberPositions || {};
  /** 운영비 등 비대전 멤버를 제외한 실질 참가자 — 1명이면 팀 게이지 대신 1인 채움 UI */
  const coreMealParticipants = useMemo(
    () =>
      participants.filter((p) => {
        const m = memberMapForMeal.get(p.memberId);
        if (!m) return false;
        return !isOperatingSettlementMember(m, mealPositions);
      }),
    [participants, memberMapForMeal, mealPositions]
  );
  const soloMealParticipant =
    coreMealParticipants.length === 1
      ? coreMealParticipants[0]
      : participants.length === 1
        ? (() => {
            const only = participants[0];
            const m = memberMapForMeal.get(only.memberId);
            if (!m || isOperatingSettlementMember(m, mealPositions)) return null;
            return only;
          })()
        : null;
  const shouldRenderMealMatchTimer = usePreviewTimer || showMealMatchTimer;
  const totalScore = coreMealParticipants.reduce((sum, p) => sum + p.score, 0);
  const totalGoalsSum = useMemo(
    () => Math.max(1, coreMealParticipants.reduce((s, p) => s + p.goal, 0)),
    [coreMealParticipants]
  );
  const rawOverlayTitle = state?.mealBattle?.overlayTitle?.trim() || "";
  const defaultOverlayTitle = "식사 대전";
  const overlayTitleBase = rawOverlayTitle || defaultOverlayTitle;
  const missionBubble = state?.mealBattle?.currentMission?.trim() || "";
  const mb = state?.mealBattle;
  const missionBubbleBg = mb?.missionBubbleBg || "#db2777";
  const missionBubbleTextColor = mb?.missionBubbleTextColor || "#ffffff";
  const gaugeTrackBg = mb?.gaugeTrackBg || theme.trackBg;
  const gaugeFillColor = mb?.gaugeFillColor || theme.leftAccent;
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
    : theme.trackShadow;

  const criticalFillBackground = isCritical
    ? `linear-gradient(90deg, ${gaugeFillColor}, #f87171, ${gaugeFillColor})`
    : gaugeFillColor;

  const teamBattleEnabled = demoEnabled
    ? demoMode === "team"
    : Boolean(mb?.teamBattleEnabled);
  const teamAName = mb?.teamAName?.trim() || "A팀";
  const teamBName = mb?.teamBName?.trim() || "B팀";
  const teamAGoalSetting = Math.max(0, Math.floor(Number(mb?.teamAGoal || 0) || 0));
  const teamBGoalSetting = Math.max(0, Math.floor(Number(mb?.teamBGoal || 0) || 0));
  const teamAColor = mb?.teamAColor || theme.leftAccent;
  const teamBColor = mb?.teamBColor || theme.rightAccent;
  const teamAIds = useMemo(() => {
    if (demoEnabled && demoMode === "team") return new Set(["demo-a1", "demo-a2"]);
    return new Set(mb?.teamAMemberIds || []);
  }, [demoEnabled, demoMode, mb?.teamAMemberIds]);
  const teamBIds = useMemo(() => {
    if (demoEnabled && demoMode === "team") return new Set(["demo-b1", "demo-b2"]);
    return new Set(mb?.teamBMemberIds || []);
  }, [demoEnabled, demoMode, mb?.teamBMemberIds]);

  const hasTeamRoster = useMemo(
    () => coreMealParticipants.some((p) => teamAIds.has(p.memberId) || teamBIds.has(p.memberId)),
    [coreMealParticipants, teamAIds, teamBIds]
  );

  const isTwoMemberDuel = !fillGaugeMode && !teamBattleEnabled && coreMealParticipants.length === 2;
  const useTeamSplitGauge = (teamBattleEnabled && !fillGaugeMode && hasTeamRoster) || isTwoMemberDuel;

  const resolvedTeamAName = isTwoMemberDuel
    ? coreMealParticipants[0]?.name || "1번"
    : teamAName;
  const resolvedTeamBName = isTwoMemberDuel
    ? coreMealParticipants[1]?.name || "2번"
    : teamBName;
  const resolvedTeamAColor = isTwoMemberDuel
    ? coreMealParticipants[0]?.color || teamAColor
    : teamAColor;
  const resolvedTeamBColor = isTwoMemberDuel
    ? coreMealParticipants[1]?.color || teamBColor
    : teamBColor;

  const teamAgg = useMemo(() => {
    if (isTwoMemberDuel && coreMealParticipants.length === 2) {
      const pA = coreMealParticipants[0]!;
      const pB = coreMealParticipants[1]!;
      return {
        aScore: pA.score,
        bScore: pB.score,
        aGoal: Math.max(1, pA.goal),
        bGoal: Math.max(1, pB.goal),
      };
    }
    let aScore = 0;
    let aGoal = 0;
    let bScore = 0;
    let bGoal = 0;
    for (const p of coreMealParticipants) {
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
  }, [coreMealParticipants, isTwoMemberDuel, teamAIds, teamBIds, teamAGoalSetting, teamBGoalSetting]);

  const teamAMemberLabel = useMemo(
    () => {
      if (isTwoMemberDuel && coreMealParticipants.length === 2) {
        return coreMealParticipants[0]?.name || "";
      }
      return coreMealParticipants
        .filter((p) => teamAIds.has(p.memberId))
        .map((p) => p.name)
        .filter(Boolean)
        .join(",");
    },
    [coreMealParticipants, isTwoMemberDuel, teamAIds]
  );
  const teamBMemberLabel = useMemo(
    () => {
      if (isTwoMemberDuel && coreMealParticipants.length === 2) {
        return coreMealParticipants[1]?.name || "";
      }
      return coreMealParticipants
        .filter((p) => teamBIds.has(p.memberId))
        .map((p) => p.name)
        .filter(Boolean)
        .join(",");
    },
    [coreMealParticipants, isTwoMemberDuel, teamBIds]
  );
  const mealBattleUseRawScore = mealBattleUsesRawDonationScore(mb);

  const overlayRulesText = String(mb?.overlayRulesText || "").trim();
  const overlayRulesFontSize = Number(mb?.overlayRulesFontSize);

  const segments = useMemo(() => {
    if (!coreMealParticipants.length || fillGaugeMode) return [];
    if (useTeamSplitGauge) {
      const totalGoal = Math.max(1, teamAgg.aGoal + teamAgg.bGoal);
      if (teamAgg.aScore + teamAgg.bScore <= 0) {
        return [
          {
            memberId: "__teamA",
            name: resolvedTeamAName,
            score: teamAgg.aScore,
            goal: teamAgg.aGoal,
            color: resolvedTeamAColor,
            percent: 0,
            center: 25,
          },
          {
            memberId: "__teamB",
            name: resolvedTeamBName,
            score: teamAgg.bScore,
            goal: teamAgg.bGoal,
            color: resolvedTeamBColor,
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
    const slotPercent = 100 / Math.max(1, coreMealParticipants.length);
    return coreMealParticipants.map((p, idx) => {
      const fillPercent = Math.min(100, (p.score / Math.max(1, p.goal)) * 100);
      return {
        ...p,
        percent: slotPercent,
        fillPercent,
        center: ((idx + 0.5) / coreMealParticipants.length) * 100,
      };
    });
  }, [
    coreMealParticipants,
    fillGaugeMode,
    useTeamSplitGauge,
    teamAgg,
    teamAName,
    teamBName,
    teamAColor,
    teamBColor,
  ]);

  const sortedByScore = [...coreMealParticipants].sort((a, b) => b.score - a.score);
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
  const operatingExcludedSoloUi = Boolean(
    soloMealParticipant && participants.length > coreMealParticipants.length
  );
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
        <div className={`relative text-center ${compact ? "mb-0" : "mb-1"}`}>
          <BattleRulesBox
            text={overlayRulesText}
            compact={compact}
            fontSizePx={overlayRulesFontSize}
            className="right-0 top-0 max-sm:left-0 max-sm:right-0 max-sm:mx-auto sm:right-1"
          />
          {/* 시그 대전과 완벽히 통일된 방송용 골드 글로우 타이틀 */}
          <div
            className="text-center font-black tracking-wider text-2xl sm:text-3xl"
            style={sigMatchTitleStyle}
          >
            {overlayTitle}
          </div>
          {!demoEnabled && devHud ? (
            <p className="mt-0.5 text-xs font-semibold text-neutral-400">합산 목표 · 멤버별 채움 게이지</p>
          ) : null}
          {devHud && demoEnabled && (
            <div className="mx-auto mt-1 flex flex-col items-center gap-0.5">
              <div className="inline-flex rounded-full border border-amber-300/40 bg-amber-400/10 px-3 py-0.5 text-xs font-bold text-amber-200">
                DEMO · {demoMode === "team" ? "팀 모드" : demoMode === "individual" ? "개인(단일게이지) 모드" : "개인 분할 모드"}
                {gaugePreview ? " · 자동 연출" : ""}
                {demoEnabled ? ` · ${MEAL_MATCH_OVERLAY_UI_REV}` : ""}
              </div>
              {overlayMounted &&
              (sp.get("fx") || sp.get("gaugeFx") || sp.get("gaugeAnim") || sp.get("timerTheme")) ? (
                <div className="text-[10px] font-medium text-amber-200/90" suppressHydrationWarning>
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
          {/* 시그 대전과 완벽히 통일된 esports 다크 글래스 타이머 */}
          {shouldRenderMealMatchTimer && !useTeamSplitGauge ? (
            <div className="mt-1 flex justify-center">
              <SigCleanTimerPill
                timerPaused={paused}
                timerText={timerText}
                compact={compact}
              />
            </div>
          ) : null}
        </div>

        <div className={`overflow-visible px-4 pb-3 ${compact ? "mt-0.5" : "mt-1"}`}>
          <div className="relative mx-auto w-full">
            {missionBubble ? (
              <div
                className="studio-text-shadow mx-auto mb-2 w-max max-w-[95%] rounded-studio border border-white/12 bg-[rgba(15,20,30,0.7)] px-4 py-1.5 text-center text-lg font-black backdrop-blur-studio shadow-glass"
                style={{ ...outlineStyle(), backgroundColor: missionBubbleBg, color: missionBubbleTextColor }}
              >
                {missionBubble}
              </div>
            ) : null}
            {useTeamSplitGauge ? (
              <div className="mb-1 px-1">
                <BattleTeamColumnBoard
                  leftScore={teamAgg.aScore}
                  rightScore={teamAgg.bScore}
                  leftMemberLabel={teamAMemberLabel}
                  rightMemberLabel={teamBMemberLabel}
                  compact={compact}
                  theme={sp.get("theme")}
                  vsDesign={sp.get("vsDesign")}
                  formatScore={(n) => mealBattleUseRawScore ? `${Math.round(n).toLocaleString("ko-KR")}원` : `${Math.round(n)}점`}
                  gapSuffix={mealBattleUseRawScore ? "" : "점"}
                  timerSlot={
                    shouldRenderMealMatchTimer ? (
                      <SigCleanTimerPill
                        timerPaused={paused}
                        timerText={timerText}
                        compact={compact}
                      />
                    ) : null
                  }
                />
              </div>
            ) : null}
            {devHud && !useTeamSplitGauge ? (
              <p
                className="mb-1.5 text-center text-[9px] font-bold text-neutral-400"
                data-meal-ui-features="score-in-bar-names-below"
              >
                UI {MEAL_MATCH_OVERLAY_UI_REV} · 테마: {theme.label}
              </p>
            ) : null}
            {!useTeamSplitGauge ? (
            <div className="flex w-full flex-col">
              {/* 테마가 적용된 세련된 e스포츠 네온/글래스 게이지 바 */}
              <div
                className={`relative z-0 mb-0 w-full shrink-0 overflow-hidden rounded-xl ring-1 ring-white/15 ${
                  compact ? "h-12 sm:h-14" : "h-14 sm:h-16"
                }`}
                style={{
                  background: theme.trackBg,
                  border: `1px solid ${theme.trackBorder}`,
                  boxShadow: theme.trackShadow,
                }}
                data-meal-gauge-bar="true"
                data-gauge-theme={theme.id}
              >
                {/* 상단 은은한 글래스 하이라이트 광택 */}
                <div className="pointer-events-none absolute inset-x-0 top-0 z-[15] h-1/2 bg-gradient-to-b from-white/20 to-transparent" />

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
                      : undefined,
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
                  <div className="relative h-full w-full overflow-hidden">
                    {fillGaugeMode ? (
                      <>
                        <motion.div
                          className="absolute left-0 top-0 bottom-0 z-[1] rounded-xl overflow-hidden"
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
                                  background: theme.leftFill,
                                }}
                              />
                              <div
                                className="h-full shrink-0"
                                style={{
                                  width: `${(teamAgg.bScore / Math.max(1, totalScore)) * 100}%`,
                                  background: theme.rightFill,
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
                                background: isCritical ? criticalFillBackground : theme.leftFill,
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
                        >
                          <span
                            className="text-base sm:text-lg font-black tabular-nums"
                            style={sigMemberAmountStyle}
                          >
                            {soloMealParticipant ? (
                              <>
                                {showLeaderCrown ? (
                                  <span className="mr-1 inline-block" aria-hidden>
                                    👑
                                  </span>
                                ) : null}
                                {soloMealParticipant.name} {Math.round(soloMealParticipant.score).toLocaleString("ko-KR")} /{" "}
                                {Math.round(soloMealParticipant.goal).toLocaleString("ko-KR")}
                                <span className="ml-0.5 text-xs opacity-90">
                                  {mealBattleUseRawScore ? "원" : "점"}
                                </span>
                              </>
                            ) : (
                              `${Math.round(totalScore).toLocaleString("ko-KR")} / ${Math.round(totalGoalsSum).toLocaleString("ko-KR")}${mealBattleUseRawScore ? "원" : "점"}`
                            )}
                          </span>
                        </div>
                      </>
                    ) : (
                      <motion.div layout className="absolute inset-0 flex" transition={{ type: "spring", stiffness: 120, damping: 20 }}>
                        {segments.map((seg, segIdx) => {
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
                              className={`relative h-full min-w-0 ${segIdx > 0 ? "border-l border-white/15" : ""}`}
                            >
                              {/* 슬롯 배경 — 반투명 글래스 */}
                              <div className="absolute inset-0 bg-black/25" />
                              <motion.div
                                className="relative h-full overflow-hidden"
                                animate={{ width: `${fillW}%` }}
                                transition={{ type: "spring", stiffness: 120, damping: 20 }}
                                style={{
                                  background: seg.color
                                    ? `linear-gradient(180deg, ${seg.color}ff 0%, ${seg.color} 50%, ${seg.color}cc 100%)`
                                    : theme.leftFill,
                                }}
                              >
                                <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
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
                      </motion.div>
                    )}

                    {isCritical ? (
                      <motion.div
                        className="pointer-events-none absolute inset-0 z-[16] bg-gradient-to-r from-transparent via-white/35 to-transparent"
                        animate={{ x: ["-120%", "220%"] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
                        aria-hidden
                      />
                    ) : null}

                    {!fillGaugeMode ? (
                      <div className="pointer-events-none absolute inset-0 z-[20]" aria-hidden>
                        {segments.map((seg) => {
                          const label = `${Math.round(seg.score).toLocaleString("ko-KR")} / ${Math.round(seg.goal).toLocaleString("ko-KR")}`;
                          const leftPct = Math.max(0, seg.center - seg.percent / 2);
                          const isLeader = showLeaderCrown && seg.memberId === leaderKey && seg.score > 0;
                          return (
                            <div
                              key={`gauge-score-${seg.memberId}`}
                              className="absolute top-0 bottom-0 flex items-center justify-center px-1 text-center"
                              style={{
                                left: `${leftPct}%`,
                                width: `${Math.max(1, seg.percent)}%`,
                              }}
                            >
                              <BattleGaugeFitScore
                                label={label}
                                className="inline-block max-w-full whitespace-nowrap font-black tabular-nums tracking-tight"
                                style={sigGaugeInBarScoreStyle(isLeader)}
                              >
                                {Math.round(seg.score).toLocaleString("ko-KR")}
                                <span className="font-bold opacity-80 text-[0.85em]"> / {Math.round(seg.goal).toLocaleString("ko-KR")}</span>
                              </BattleGaugeFitScore>
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              </div>

              {/* 시그 대전과 통일된 하단 다크 글래스 멤버 카드 */}
              {!fillGaugeMode && segments.length > 0 ? (
                <div
                  className={`relative z-20 mt-2.5 w-full shrink-0 ${compact ? "mt-1.5" : "sm:mt-3"}`}
                  data-meal-member-names="true"
                  data-meal-ui-rev={MEAL_MATCH_OVERLAY_UI_REV}
                  aria-label="멤버 이름"
                >
                  <div
                    className="grid w-full gap-1.5 sm:gap-2"
                    style={{ gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))` }}
                  >
                    {segments.map((seg) => {
                      const isLeader = showLeaderCrown && seg.memberId === leaderKey && seg.score > 0;
                      return (
                        <div
                          key={`tag-${seg.memberId}`}
                          className={`flex flex-col items-center justify-center rounded-xl px-2 py-1.5 backdrop-blur-md transition-all ${
                            isLeader
                              ? "bg-amber-950/60 ring-1 ring-amber-400/70 shadow-[0_0_14px_rgba(251,191,36,0.3)]"
                              : "bg-black/55 ring-1 ring-white/12 shadow-[0_4px_16px_rgba(0,0,0,0.45)]"
                          }`}
                          style={
                            isLeader
                              ? { borderLeft: `3px solid ${seg.color || "#fbbf24"}` }
                              : { borderLeft: `3px solid ${seg.color || "rgba(255,255,255,0.4)"}` }
                          }
                        >
                          <div className="flex items-center gap-1 max-w-full">
                            {isLeader ? (
                              <span className="text-xs sm:text-sm text-yellow-300 drop-shadow" aria-hidden>
                                👑
                              </span>
                            ) : null}
                            <span
                              className="truncate text-xs sm:text-sm font-bold text-white tracking-wide"
                              style={sigMemberNameStyle}
                            >
                              {seg.name}
                            </span>
                          </div>
                          <span
                            className="text-xs sm:text-sm font-black tabular-nums text-white/95"
                            style={sigMemberAmountStyle}
                          >
                            {Math.round(seg.score).toLocaleString("ko-KR")}
                            <span className="text-[10px] sm:text-xs font-semibold text-neutral-300">
                              {mealBattleUseRawScore ? "원" : "점"}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            ) : null}
          </div>
        </div>

      </div>
    </main>
  );
}
