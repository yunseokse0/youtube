"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import type { AppState } from "@/lib/state";
import { defaultState } from "@/lib/state";
import { snapshotToSigMatchState } from "@/lib/sig-match-snapshot";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { readDonationListsOverlayPollMs } from "@/lib/overlay-pull-policy";
import { getEffectiveRemainingTime } from "@/lib/timer-utils";
import { SIG_MATCH_OVERLAY_UI_REV } from "@/lib/overlay-ui-revision";
import { showOverlayDevHud, useOverlayHubCompactLayout } from "@/lib/overlay-dev-hud";
import { buildBattleOverlayContainerStyle, clampBattleOverlayContentWidthPct, clampBattleOverlayScalePct } from "@/lib/overlay-battle-scale";
import {
  formatSigMatchGapLabel,
  formatSigMatchScoreLabel,
  formatSigMatchStat,
  getSigMatchRankings,
  type SigMatchRankingItem,
} from "@/lib/settlement-utils";
import BattleRulesBox from "@/components/battle/BattleRulesBox";
import BattleTeamColumnBoard from "@/components/battle/BattleTeamColumnBoard";
import BattleGaugeFitScore from "@/components/battle/BattleGaugeFitScore";
import { VsCenterBadge } from "@/components/battle/VsCenterBadge";

type SigMatchSide = { ids: string[]; label: string; score: number; teamLabel?: string };

/** 흰 글씨 + 검은 외곽선 — OBS·밝은 배경 위 가독성 */
const sigOutlinedWhiteTextStyle: CSSProperties = {
  color: "#ffffff",
  WebkitTextStroke: "0.65px rgba(0,0,0,0.95)",
  paintOrder: "stroke fill",
  textShadow:
    "0 0 2px rgba(0,0,0,1), 0 1px 4px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.85), -1px 0 2px rgba(0,0,0,0.85)",
};

/** 멤버명 — 엑셀표 수준으로 더 굵은 외곽선 */
const sigMemberNameOutlineStyle: CSSProperties = {
  color: "#ffffff",
  WebkitTextStroke: "0.85px rgba(0,0,0,0.98)",
  paintOrder: "stroke fill",
  textShadow:
    "0 0 2px rgba(0,0,0,1), 0 2px 4px rgba(0,0,0,0.95), 1px 0 2px rgba(0,0,0,0.9), -1px 0 2px rgba(0,0,0,0.9), 0 -1px 2px rgba(0,0,0,0.9)",
};

function sigGaugeInBarScoreStyle(leading: boolean): CSSProperties {
  return {
    ...sigOutlinedWhiteTextStyle,
    ...(leading ? { filter: "brightness(1.05)" } : {}),
  };
}

function SigVsBarSegmentLabel({
  score,
  scoringMode,
  leading = false,
  compact = false,
  align = "center",
}: {
  score: number;
  scoringMode: "count" | "amount";
  narrow?: boolean;
  leading?: boolean;
  compact?: boolean;
  align?: "start" | "center" | "end";
}) {
  const label = formatSigMatchScoreLabel(score, scoringMode);
  const justify =
    align === "start" ? "justify-start pl-2.5 sm:pl-3" : align === "end" ? "justify-end pr-2.5 sm:pr-3" : "justify-center px-2";
  const textAlign = align === "end" ? "text-right" : align === "start" ? "text-left" : "text-center";
  return (
    <div
      className={`pointer-events-none absolute inset-0 z-[5] flex items-center ${justify} text-center`}
      data-sig-vs-segment-label="true"
      data-sig-leading={leading ? "true" : "false"}
    >
      <BattleGaugeFitScore
        label={label}
        maxFontPx={compact ? 16 : 20}
        className={`block max-w-[calc(100%-0.5rem)] font-black tabular-nums ${textAlign}`}
        style={sigGaugeInBarScoreStyle(leading)}
      />
    </div>
  );
}
type SigMatchDuelLayout =
  | { mode: "dual"; left: SigMatchSide; right: SigMatchSide }
  | { mode: "triple"; sides: [SigMatchSide, SigMatchSide, SigMatchSide] };

function sigVsBarHeightClass(hubPreview: boolean): string {
  return hubPreview
    ? "h-16 w-full min-h-[4rem] overflow-hidden rounded-xl bg-black/35 ring-1 ring-white/15 sm:h-20"
    : "h-12 w-full overflow-hidden rounded-xl bg-black/30 ring-1 ring-white/12 sm:h-14";
}

/** 게이지 정중앙 — VS + 선두 차이 (차액은 바 아래 별도 행) */
function SigVsBarCenterLabel({
  compact,
  gapLabel,
  variant = "inline",
  vsDesign,
}: {
  compact?: boolean;
  gapLabel?: string | null;
  /** inline: 막대 위 VS만 · belowBar: 바 아래 차액 행 */
  variant?: "inline" | "belowBar";
  vsDesign?: unknown;
}) {
  const gapSize = compact ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm";

  if (variant === "belowBar") {
    const label = gapLabel == null ? null : String(gapLabel).trim();
    if (label == null || label === "") return null;
    return (
      <div className="relative z-20 flex justify-center py-0.5" data-sig-vs-gap-row="true">
        <span
          className={`rounded-md bg-neutral-950/90 px-1.5 py-0.5 font-black tabular-nums text-amber-100 ring-1 ring-amber-300/40 ${gapSize}`}
          data-sig-vs-gap="true"
          title="선두 차액"
        >
          +{label}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center" data-sig-vs-center="true">
      <VsCenterBadge design={vsDesign} compact={compact} />
    </div>
  );
}

function sigTeamBoxLeadingClasses(_tint: "pink" | "sky" | "amber", leading: boolean): string {
  /** 회색 패널 없음 — 선두만 얇은 링 */
  return leading
    ? "border-transparent bg-transparent ring-1 ring-emerald-400/55"
    : "border-transparent bg-transparent ring-0";
}

const sigMemberNameStyle = sigMemberNameOutlineStyle;
const sigMemberAmountStyle = sigOutlinedWhiteTextStyle;

function SigCleanTimerPill({
  timerPaused,
  timerText,
  compact,
  timerTextStyle,
}: {
  timerPaused: boolean;
  timerText: string;
  compact: boolean;
  timerTextStyle: React.CSSProperties;
}) {
  return (
    <div
      className={`inline-flex items-center justify-center rounded-md px-2.5 py-0.5 font-black tabular-nums text-white ring-1 ring-white/15 ${
        timerPaused ? "bg-neutral-700/90" : "bg-neutral-950/85"
      } ${compact ? "text-base sm:text-lg" : "text-lg sm:text-xl"}`}
      style={timerTextStyle}
      data-sig-clean-timer="true"
    >
      <span suppressHydrationWarning>{timerText}</span>
    </div>
  );
}

type SigMemberScoreLine = { memberId: string; name: string; score: number };

type SigFloatingBurst = {
  id: number;
  value: string;
  color: string;
  x: number;
};

function memberScoresForSide(
  side: SigMatchSide,
  ranking: SigMatchRankingItem[],
  memberMap: Map<string, string>,
  sigMatch?: Record<string, number>
): SigMemberScoreLine[] {
  return side.ids.map((id) => {
    const row = ranking.find((r) => r.memberId === id);
    return {
      memberId: id,
      name: row?.name || memberMap.get(id) || id,
      score: row?.score ?? sigMatch?.[id] ?? 0,
    };
  });
}

function memberFloatX(
  memberId: string,
  duel: SigMatchDuelLayout,
  dualBar: { leftPct: number; rightPct: number } | null,
  tripleBar: { pcts: [number, number, number] } | null
): number {
  if (duel.mode === "dual" && dualBar) {
    if (duel.left.ids.includes(memberId)) return Math.max(10, dualBar.leftPct * 0.42);
    if (duel.right.ids.includes(memberId)) return Math.min(90, 100 - dualBar.rightPct * 0.42);
  }
  if (duel.mode === "triple" && tripleBar) {
    const i = duel.sides.findIndex((s) => s.ids.includes(memberId));
    if (i >= 0) {
      let start = 0;
      for (let j = 0; j < i; j++) start += tripleBar.pcts[j] ?? 0;
      return start + (tripleBar.pcts[i] ?? 33) * 0.5;
    }
  }
  return 50;
}

/** 팀 단위 한 박스 — 멤버 세로 나열 (선두만 얇은 링) */
function SigTeamMemberBox({
  members,
  scoringMode,
  align,
  nameClass,
  scoreClass = "text-white/95",
  borderClass = "",
  teamLeading = false,
  teamTint = "pink",
}: {
  members: SigMemberScoreLine[];
  scoringMode: "count" | "amount";
  align: "left" | "center" | "right";
  nameClass: string;
  scoreClass?: string;
  borderClass?: string;
  teamLeading?: boolean;
  teamTint?: "pink" | "sky" | "amber";
}) {
  if (members.length === 0) return <div className="min-h-[2px]" aria-hidden />;
  const boxPos =
    align === "right" ? "ml-auto" : align === "center" ? "mx-auto" : "mr-auto";
  const rowDir = align === "right" ? "flex-row-reverse" : "flex-row";
  const rowJustify = align === "right" ? "justify-end" : "justify-between";

  return (
    <div
      data-sig-team-box="true"
      data-sig-team-leading={teamLeading ? "true" : "false"}
      aria-label={teamLeading ? "선두 팀" : undefined}
      className={`w-full min-w-[9.5rem] max-w-[15rem] rounded-lg bg-neutral-950/80 px-2 py-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.45)] ring-1 ring-white/20 backdrop-blur-sm sm:min-w-[10.5rem] sm:max-w-[16rem] sm:px-2.5 sm:py-2 ${borderClass} ${sigTeamBoxLeadingClasses(teamTint, teamLeading)} ${boxPos}`}
    >
      <ul className="flex flex-col gap-1.5 sm:gap-2">
        {members.map((m, idx) => {
          const amountLabel = formatSigMatchScoreLabel(m.score, scoringMode);
          return (
            <li
              key={m.memberId}
              className={`flex min-w-0 ${rowDir} items-center gap-2.5 ${rowJustify} ${
                idx > 0 ? "border-t border-white/25 pt-1.5 sm:pt-2" : ""
              }`}
            >
              <span
                className={`min-w-0 flex-1 truncate text-lg font-black leading-snug tracking-tight sm:text-xl ${nameClass}`}
                style={sigMemberNameStyle}
              >
                {m.name}
              </span>
              <span
                className={`max-w-[8rem] shrink-0 truncate whitespace-nowrap rounded-md bg-black/45 px-1.5 py-0.5 text-base font-black tabular-nums ring-1 ring-white/15 sm:max-w-[8.5rem] sm:text-lg ${scoreClass}`}
                style={sigMemberAmountStyle}
              >
                {amountLabel}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 1인·단일 행용 (팀 박스 없이 한 줄) */
function SigMemberVerticalList({
  members,
  scoringMode,
  align,
  nameClass,
  scoreClass = "text-amber-100",
  teamLeading = false,
  teamTint = "pink",
}: {
  members: SigMemberScoreLine[];
  scoringMode: "count" | "amount";
  align: "left" | "center" | "right";
  nameClass: string;
  scoreClass?: string;
  teamLeading?: boolean;
  teamTint?: "pink" | "sky" | "amber";
}) {
  return (
    <SigTeamMemberBox
      members={members}
      scoringMode={scoringMode}
      align={align}
      nameClass={nameClass}
      scoreClass={scoreClass}
      teamLeading={teamLeading}
      teamTint={teamTint}
    />
  );
}

function SigFloatingScores({ bursts }: { bursts: SigFloatingBurst[] }) {
  if (bursts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-visible" aria-hidden>
      {bursts.map((item) => (
        <motion.div
          key={item.id}
          className="absolute -translate-x-1/2 text-xl font-black tabular-nums drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)] sm:text-2xl"
          style={{ left: `${item.x}%`, top: "42%", color: item.color }}
          initial={{ opacity: 0, y: 0, scale: 0.55 }}
          animate={{ opacity: [0, 1, 1, 0], y: [0, -32, -118], scale: [0.55, 1.18, 1.05] }}
          transition={{ duration: 1.45, ease: "easeOut", times: [0, 0.22, 1] }}
        >
          {item.value}
        </motion.div>
      ))}
    </div>
  );
}

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
    let json: string;
    if (typeof Buffer !== "undefined") {
      json = decodeURIComponent(Buffer.from(b64, "base64").toString("utf8"));
    } else {
      json = decodeURIComponent(atob(b64));
    }
    const obj = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseSigMatchSnapshot(sp: URLSearchParams): AppState | null {
  const key = (sp.get("snapKey") || "").trim();
  const fromKey = tryReadSnapshotFromStorage(key || null);
  const fromB64 = tryDecodeSnapshotB64(sp.get("snap"));
  return snapshotToSigMatchState(fromKey || fromB64);
}

function useSigMatchState(userId: string | undefined, lockedSnapshot: AppState | null): { state: AppState | null; ready: boolean } {
  return useOverlayRemoteState(userId, {
    statePick: "overlay-donors",
    frozenState: lockedSnapshot ?? undefined,
    enabled: !lockedSnapshot,
    storageDebounceMs: 0,
    /** host=obs 없어도 후원·점수 실시간 반영 (OBS CEF·admin iframe) */
    adminPreviewAllowPoll: true,
    overlayPollMs: readDonationListsOverlayPollMs() || 2500,
  });
}

export type SigMatchEmbeddedDemoConfig = {
  frozenState: AppState;
  hubPreview?: boolean;
  sigPreview?: boolean;
  previewGuide?: boolean;
  scalePct?: number;
  contentWidthPct?: number;
};

export default function SigMatchDuelOverlay({
  embeddedDemo,
}: {
  embeddedDemo?: SigMatchEmbeddedDemoConfig;
} = {}) {
  const [clientReady, setClientReady] = useState(false);
  useEffect(() => {
    setClientReady(true);
  }, []);

  const sp = useSearchParams();
  const userId = embeddedDemo ? undefined : getOverlayUserIdFromSearchParams(sp);
  const previewGuide = embeddedDemo?.previewGuide ?? sp.get("previewGuide") === "true";
  const hubPreview = embeddedDemo?.hubPreview ?? sp.get("hubPreview") === "1";
  const compact = useOverlayHubCompactLayout(hubPreview);
  const overlayScalePct = (() => {
    if (embeddedDemo?.scalePct != null) {
      return clampBattleOverlayScalePct(embeddedDemo.scalePct);
    }
    return clampBattleOverlayScalePct(sp.get("scalePct") || sp.get("zoomPct") || "100");
  })();
  const contentWidthPct = (() => {
    if (embeddedDemo?.contentWidthPct != null) {
      return clampBattleOverlayContentWidthPct(embeddedDemo.contentWidthPct);
    }
    return clampBattleOverlayContentWidthPct(sp.get("contentWidthPct") || sp.get("maxWidthPct") || "100");
  })();
  const overlayContainerStyle = buildBattleOverlayContainerStyle(overlayScalePct, contentWidthPct);

  const lockedSnapshot = useMemo(
    () => embeddedDemo?.frozenState ?? parseSigMatchSnapshot(sp),
    [embeddedDemo, sp]
  );
  const snapLocked = Boolean(embeddedDemo?.frozenState || ((sp.get("snap") || sp.get("snapKey")) && lockedSnapshot));
  const sigPreview = embeddedDemo
    ? Boolean(embeddedDemo.sigPreview)
    : Boolean(lockedSnapshot) && sp.get("sigPreview") === "1";

  const devHud = showOverlayDevHud({
    hubPreview: Boolean(embeddedDemo?.hubPreview) || sp.get("hubPreview") === "1",
    sigPreview,
  });

  useEffect(() => {
    if (!hubPreview || typeof document === "undefined") return;
    document.documentElement.classList.add("overlay-hub-preview");
    return () => document.documentElement.classList.remove("overlay-hub-preview");
  }, [hubPreview]);

  const { state, ready } = useSigMatchState(userId, snapLocked ? lockedSnapshot : null);

  const [previewSigMatch, setPreviewSigMatch] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!sigPreview || !state?.sigMatch) return;
    const amountMode = state.sigMatchSettings?.scoringMode === "amount";
    const base = { ...state.sigMatch };
    setPreviewSigMatch(base);
    const bump = () => {
      setPreviewSigMatch((prev) => {
        const keys = Object.keys(prev);
        if (keys.length === 0) return prev;
        const pick = keys[Math.floor(Math.random() * keys.length)]!;
        const delta = amountMode
          ? Math.floor(3_000 + Math.random() * 12_000)
          : Math.floor(3 + Math.random() * 15);
        return { ...prev, [pick]: (prev[pick] ?? 0) + delta };
      });
    };
    bump();
    const id = window.setInterval(bump, 3000);
    return () => window.clearInterval(id);
  }, [sigPreview, state?.sigMatch, state?.sigMatchSettings?.scoringMode]);

  const displayState = useMemo(() => {
    if (!state) return null;
    if (!sigPreview || Object.keys(previewSigMatch).length === 0) return state;
    return { ...state, sigMatch: previewSigMatch, updatedAt: Date.now() };
  }, [state, sigPreview, previewSigMatch]);

  const overlayState = displayState ?? state;

  const sigSettings = overlayState?.sigMatchSettings || defaultState().sigMatchSettings;
  const title = sigSettings.title || "시그 대전";
  const scoringMode: "count" | "amount" = sigSettings.scoringMode === "amount" ? "amount" : "count";
  /** 집계 필터(donationLinks·startedAt)는 getSigMatchRankings 에 맡김 — 타이머만 켠 경우에도 donors 전달 */
  const sigMatchDonors = overlayState?.donors || [];

  const ranking = useMemo(
    () =>
      getSigMatchRankings(
        sigMatchDonors,
        overlayState?.members || [],
        overlayState?.sigMatchSettings || defaultState().sigMatchSettings,
        overlayState?.sigMatch || {},
        overlayState?.memberPositions || {}
      ),
    [sigMatchDonors, overlayState?.members, overlayState?.sigMatchSettings, overlayState?.sigMatch, overlayState?.memberPositions]
  );
  const memberMap = useMemo(() => new Map((overlayState?.members || []).map((m) => [m.id, m.name])), [overlayState?.members]);
  const blockedMemberIds = useMemo(
    () =>
      new Set(
        (overlayState?.members || [])
          .filter(
            (m) =>
              Boolean(m.operating) ||
              /운영비/i.test(String(m.name || "")) ||
              /운영비/i.test(String(overlayState?.memberPositions?.[m.id] || ""))
          )
          .map((m) => m.id)
      ),
    [overlayState?.members, overlayState?.memberPositions]
  );
  const duelData = useMemo((): SigMatchDuelLayout => {
    const pools = (overlayState?.sigMatchSettings?.sigMatchPools || []).filter(
      (p) => Array.isArray(p.memberIds) && p.memberIds.length >= 1
    );
    const scoreMap = new Map(ranking.map((r) => [r.memberId, r.score]));
    /** 집계(ranking)에 올라온 멤버만 대결 표시 — 운영비 등 집계 제외 멤버가 풀에 있어도 VS 상대로 나오지 않게 함 */
    const playableIdSet = new Set(ranking.map((r) => r.memberId));
    const makeSide = (
      memberIds: string[],
      fallbackLabel: string,
      teamLabel?: string
    ): SigMatchSide => {
      const ids = [
        ...new Set(
          memberIds.filter(
            (id) => Boolean(id) && playableIdSet.has(id) && !blockedMemberIds.has(id)
          )
        ),
      ];
      const label = ids.map((id) => memberMap.get(id) || id).join(" · ") || fallbackLabel;
      const score = ids.reduce((sum, id) => sum + (scoreMap.get(id) || 0), 0);
      return { ids, label, score, teamLabel };
    };

    /** 풀 3개 이상: 상위 3개 풀 → 삼자 막대 (1:1:1·혼합 팀 등) */
    if (pools.length >= 3) {
      const sides: [SigMatchSide, SigMatchSide, SigMatchSide] = [
        makeSide(pools[0]!.memberIds, "1", "A팀"),
        makeSide(pools[1]!.memberIds, "2", "B팀"),
        makeSide(pools[2]!.memberIds, "3", "C팀"),
      ];
      return { mode: "triple", sides };
    }
    /** 풀 2개 → 좌·우만 (1:2, 2:1, 2:2 …) — 막대는 팀 합산 금액 */
    if (pools.length >= 2) {
      return {
        mode: "dual",
        left: makeSide(pools[0]!.memberIds, "LEFT", "A팀"),
        right: makeSide(pools[1]!.memberIds, "RIGHT", "B팀"),
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
    const pack = (items: typeof list, teamLabel: string): SigMatchSide => ({
      ids: items.map((x) => x.memberId),
      label: items.map((x) => x.name).join(" · ") || "—",
      score: items.reduce((s, x) => s + x.score, 0),
      teamLabel,
    });
    return { mode: "dual", left: pack(leftList, "A팀"), right: pack(rightList, "B팀") };
  }, [ranking, overlayState?.sigMatchSettings?.sigMatchPools, memberMap, blockedMemberIds]);
  /** 식사대전(/overlay/meal-match)과 동일하게 matchTimer + 서버 동기화(lastUpdated) 기준 */
  const timerState = overlayState?.matchTimer ?? overlayState?.generalTimer ?? null;
  const [, setTimerTick] = useState(0);
  useEffect(() => {
    if (!timerState) return;
    setTimerTick((v) => v + 1);
    const id = window.setInterval(() => setTimerTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, [timerState]);
  const showSigMatchTimer = overlayState?.matchTimerEnabled?.match !== false;
  const remainingSec = timerState ? getEffectiveRemainingTime(timerState) : 0;
  const timerPaused = Boolean(timerState && !timerState.isActive);
  const timerVisible = showSigMatchTimer;
  const timerText = `${String(Math.floor(Math.max(0, remainingSec) / 60)).padStart(2, "0")}:${String(Math.max(0, remainingSec) % 60).padStart(2, "0")}`;
  const timerStyleFromState = overlayState?.timerDisplayStyles?.general;
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
  const sigMatchTitleStyle: React.CSSProperties = {
    color: "#fffbeb",
    textShadow:
      "0 2px 10px rgba(0,0,0,0.95), 0 0 28px rgba(251,191,36,0.4), -1px 0 0 rgba(0,0,0,0.85), 1px 0 0 rgba(0,0,0,0.85)",
  };
  const dualBar =
    duelData.mode === "dual"
      ? (() => {
          const t = duelData.left.score + duelData.right.score;
          const noRight = duelData.right.ids.length === 0 || duelData.right.label === "—";
          const noLeft = duelData.left.ids.length === 0 || duelData.left.label === "—";
          let leftPct: number;
          let rightPct: number;
          if (t > 0) {
            leftPct = Math.max(0, Math.min(100, (duelData.left.score / t) * 100));
            rightPct = 100 - leftPct;
          } else if (noRight && !noLeft) {
            /** 1인(또는 한쪽만): 점수 0이어도 막대는 참가 쪽 100% — 50/50 은 '대결' 오해 유발 */
            leftPct = 100;
            rightPct = 0;
          } else if (noLeft && !noRight) {
            leftPct = 0;
            rightPct = 100;
          } else {
            leftPct = 50;
            rightPct = 50;
          }
          return {
            leftPct,
            rightPct,
            leftLeading: duelData.left.score > duelData.right.score,
            rightLeading: duelData.right.score > duelData.left.score,
          };
        })()
      : null;

  /** 한쪽만 참가자가 있을 때(관리자 미리보기·1인 방송): VS 2열이 아니라 단일 축으로 표시 */
  const soloDualSide =
    duelData.mode === "dual" && dualBar
      ? duelData.left.ids.length > 0
        ? duelData.left
        : duelData.right.ids.length > 0
          ? duelData.right
          : null
      : null;
  const totalDualMemberIds =
    duelData.mode === "dual" ? duelData.left.ids.length + duelData.right.ids.length : 0;
  const isSoloDualLayout =
    duelData.mode === "dual" &&
    totalDualMemberIds === 1 &&
    duelData.left.ids.length === 0 !== (duelData.right.ids.length === 0);

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
            leading: [lead && a.score === maxS, lead && b.score === maxS, lead && c.score === maxS] as [
              boolean,
              boolean,
              boolean,
            ],
          };
        })()
      : null;

  const aggregateDuelScore = useMemo(() => {
    if (duelData.mode === "dual") return duelData.left.score + duelData.right.score;
    if (duelData.mode === "triple") return duelData.sides.reduce((sum, s) => sum + s.score, 0);
    return ranking.reduce((sum, r) => sum + r.score, 0);
  }, [duelData, ranking]);

  const vsCenterGapLabel = useMemo(() => {
    if (duelData.mode === "dual") {
      const gap = Math.abs(duelData.left.score - duelData.right.score);
      return formatSigMatchGapLabel(gap, scoringMode);
    }
    if (duelData.mode === "triple") {
      const scores = duelData.sides.map((s) => s.score);
      const sorted = [...scores].sort((a, b) => b - a);
      const gap = Math.max(0, (sorted[0] ?? 0) - (sorted[1] ?? 0));
      return formatSigMatchGapLabel(gap, scoringMode);
    }
    return null;
  }, [duelData, scoringMode]);

  const vsBarSpring = { type: "spring" as const, stiffness: 170, damping: 26, mass: 0.85 };
  const [barPulseKey, setBarPulseKey] = useState(0);
  const prevAggregateRef = useRef(0);
  const lastMemberScoresRef = useRef<Record<string, number>>({});
  const [floatingBursts, setFloatingBursts] = useState<SigFloatingBurst[]>([]);
  const floatingIdRef = useRef(0);

  useEffect(() => {
    if (aggregateDuelScore > prevAggregateRef.current + 0.01) {
      setBarPulseKey((k) => k + 1);
    }
    prevAggregateRef.current = aggregateDuelScore;
  }, [aggregateDuelScore]);

  useEffect(() => {
    const prev = lastMemberScoresRef.current;
    const hasPrev = Object.keys(prev).length > 0;
    for (const r of ranking) {
      const old = prev[r.memberId] ?? 0;
      if (hasPrev && r.score > old + 0.01) {
        const diff = r.score - old;
        const recentDrop = Number(prev[`__dropAt_${r.memberId}`] || 0);
        const peak = Number(prev[`__peak_${r.memberId}`] || 0);
        /** 동기화로 점수↓ 직후 같은 수준으로 복구될 때 플로트 반복 방지 */
        const skipFloat =
          recentDrop > 0 && Date.now() - recentDrop < 1200 && r.score <= peak + 0.01;
        if (!skipFloat) {
          const floatId = ++floatingIdRef.current;
          const onLeft = duelData.mode === "dual" && duelData.left.ids.includes(r.memberId);
          const onRight = duelData.mode === "dual" && duelData.right.ids.includes(r.memberId);
          const color = onLeft ? "#fbcfe8" : onRight ? "#bae6fd" : "#fde68a";
          const x = memberFloatX(r.memberId, duelData, dualBar, tripleBar) + (Math.random() * 8 - 4);
          setFloatingBursts((b) => [
            ...b,
            {
              id: floatId,
              value: `+${formatSigMatchStat(diff)}${scoringMode === "amount" ? "원" : ""}`,
              color,
              x: Math.max(6, Math.min(94, x)),
            },
          ]);
          window.setTimeout(() => {
            setFloatingBursts((b) => b.filter((f) => f.id !== floatId));
          }, 1500);
        }
      } else if (hasPrev && r.score + 0.01 < old) {
        prev[`__dropAt_${r.memberId}`] = Date.now();
        prev[`__peak_${r.memberId}`] = Math.max(Number(prev[`__peak_${r.memberId}`] || 0), old);
        /** 점수↓(동기화로 0 등) 직후 +금액 플로트가 0원 위에 남지 않게 */
        setFloatingBursts([]);
      }
      prev[r.memberId] = r.score;
    }
    lastMemberScoresRef.current = { ...prev };
  }, [ranking, duelData, dualBar, tripleBar, scoringMode]);

  const sigScores = useMemo(() => overlayState?.sigMatch ?? {}, [overlayState?.sigMatch]);

  const leftMemberLines = useMemo(
    () =>
      duelData.mode === "dual"
        ? memberScoresForSide(duelData.left, ranking, memberMap, sigScores)
        : [],
    [duelData, ranking, memberMap, sigScores]
  );
  const rightMemberLines = useMemo(
    () =>
      duelData.mode === "dual"
        ? memberScoresForSide(duelData.right, ranking, memberMap, sigScores)
        : [],
    [duelData, ranking, memberMap, sigScores]
  );
  const tripleMemberLines = useMemo(
    () =>
      duelData.mode === "triple"
        ? duelData.sides.map((side) => memberScoresForSide(side, ranking, memberMap, sigScores))
        : [],
    [duelData, ranking, memberMap, sigScores]
  );

  const rulesText = String(sigSettings.rulesText || "").trim();

  if (!clientReady || !ready || !overlayState) {
    return (
      <main className="min-h-[8rem] w-full bg-transparent p-4 text-white/50">
        <p className="text-center text-xs">시그 대전 로딩…</p>
      </main>
    );
  }

  return (
    <main
      data-overlay-ui={SIG_MATCH_OVERLAY_UI_REV}
      suppressHydrationWarning
      className={`w-full text-white ${
        compact ? "min-h-0 p-2" : "min-h-screen p-4"
      } ${previewGuide && devHud ? "bg-transparent md:bg-[#111827]" : "bg-transparent"}`}
    >
      <div
        className={compact ? "mx-auto w-full p-0" : "mx-auto p-4"}
        style={overlayContainerStyle}
      >
        <div className={compact ? "relative w-full" : "relative mb-4 p-2"}>
          <BattleRulesBox
            text={rulesText}
            compact={compact}
            fontSizePx={sigSettings.rulesFontSize}
            className="right-0 top-0 max-sm:left-0 max-sm:right-0 max-sm:mx-auto sm:right-1"
          />
          {devHud && sigPreview ? (
            <div className="pointer-events-none absolute right-2 top-2 z-10 rounded-full border border-amber-300/60 bg-amber-950/90 px-2 py-0.5 text-[10px] font-bold text-amber-100">
              DEMO · 자동 연출 · {SIG_MATCH_OVERLAY_UI_REV}
            </div>
          ) : null}
          {devHud ? (
            <div
              className={`mb-2 rounded border-2 border-lime-400/80 bg-lime-950/80 px-2 py-1 text-center ${compact ? "text-[9px]" : "text-[10px]"}`}
              data-sig-ui-features="team-box-vs-bar"
            >
              <span className="font-black text-lime-200">
                SIG DUEL {SIG_MATCH_OVERLAY_UI_REV}
              </span>
              <span className="text-lime-100/90"> · 클린 VS 바 · 타이머 상단 · 멤버별 금액</span>
              <span className="mt-0.5 block text-red-300">
                「멤버1·멤버2」 pill만 보이면 구 JS → dev:clean + 새로고침
              </span>
            </div>
          ) : null}

          {dualBar && duelData.mode === "dual" && isSoloDualLayout && soloDualSide ? (
            <div className={`flex flex-col ${compact ? "gap-2 pt-0" : "gap-2.5 pt-1"}`}>
              <h1
                className={`text-center font-black tracking-wide ${compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"}`}
                style={sigMatchTitleStyle}
              >
                {title}
              </h1>
              {timerVisible ? (
                <div className="flex justify-center">
                  <SigCleanTimerPill
                    timerPaused={timerPaused}
                    timerText={timerText}
                    compact={compact}
                    timerTextStyle={timerTextOutlineStyle}
                  />
                </div>
              ) : null}
              <div className="relative mt-0.5" data-sig-vs-bar="true">
                <div
                  className={`relative flex items-center justify-center overflow-hidden rounded-xl ring-1 ring-white/15 ${
                    compact ? "h-12 sm:h-14" : "h-14 sm:h-16"
                  }`}
                  style={{
                    background:
                      soloDualSide === duelData.left
                        ? "linear-gradient(180deg, #f87171 0%, #dc2626 48%, #b91c1c 100%)"
                        : "linear-gradient(180deg, #60a5fa 0%, #2563eb 48%, #1d4ed8 100%)",
                  }}
                >
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
                  <SigVsBarSegmentLabel
                    score={soloDualSide.score}
                    scoringMode={scoringMode}
                    leading
                    compact={compact}
                  />
                </div>
                <div className="mt-1.5 flex justify-center">
                  <span className="inline-flex rounded-md bg-neutral-800/90 px-2.5 py-0.5 text-sm font-bold text-white ring-1 ring-white/10">
                    {soloDualSide.label}
                  </span>
                </div>
                <SigFloatingScores bursts={floatingBursts} />
              </div>
              <div className="flex justify-center">
                <SigMemberVerticalList
                  members={memberScoresForSide(soloDualSide, ranking, memberMap, sigScores)}
                  scoringMode={scoringMode}
                  align="center"
                  nameClass={soloDualSide === duelData.left ? "text-rose-100" : "text-sky-100"}
                  scoreClass="text-white/85"
                  teamLeading
                  teamTint={soloDualSide === duelData.left ? "pink" : "sky"}
                />
              </div>
            </div>
          ) : null}
          {dualBar && duelData.mode === "dual" && !isSoloDualLayout ? (
            <div className={`flex w-full flex-col ${compact ? "gap-2 pt-0" : "gap-2.5 pt-1"}`}>
              <h1
                className={`text-center font-black tracking-wide ${compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"}`}
                style={sigMatchTitleStyle}
              >
                {title}
              </h1>
              <motion.div
                className="relative shrink-0"
                data-sig-vs-bar="true"
                animate={{ scale: barPulseKey > 0 ? [1, 1.015, 1] : 1 }}
                transition={{ duration: 0.4 }}
              >
                <BattleTeamColumnBoard
                  leftScore={duelData.left.score}
                  rightScore={duelData.right.score}
                  leftMemberLabel=""
                  rightMemberLabel=""
                  compact={compact}
                  gapLabel={vsCenterGapLabel}
                  vsDesign={sigSettings.vsDesign}
                  formatScore={(n) => formatSigMatchScoreLabel(n, scoringMode)}
                  timerSlot={
                    timerVisible ? (
                      <SigCleanTimerPill
                        timerPaused={timerPaused}
                        timerText={timerText}
                        compact={compact}
                        timerTextStyle={timerTextOutlineStyle}
                      />
                    ) : null
                  }
                />
                <SigFloatingScores bursts={floatingBursts} />
              </motion.div>
              <div className={`mt-1 grid grid-cols-2 gap-2 px-0.5 sm:gap-3 ${compact ? "gap-1.5" : ""}`}>
                <SigTeamMemberBox
                  members={leftMemberLines}
                  scoringMode={scoringMode}
                  align="left"
                  nameClass={dualBar?.leftLeading ? "text-emerald-100" : "text-rose-100"}
                  scoreClass="text-amber-50"
                  teamLeading={Boolean(dualBar?.leftLeading)}
                  teamTint="pink"
                />
                <SigTeamMemberBox
                  members={rightMemberLines}
                  scoringMode={scoringMode}
                  align="right"
                  nameClass={dualBar?.rightLeading ? "text-emerald-100" : "text-sky-100"}
                  scoreClass="text-amber-50"
                  teamLeading={Boolean(dualBar?.rightLeading)}
                  teamTint="sky"
                />
              </div>
            </div>
          ) : null}
          {tripleBar && duelData.mode === "triple" ? (
            <div className={`flex flex-col ${compact ? "gap-2 pt-0" : "gap-2.5 pt-1"}`}>
              <h1
                className={`text-center font-black tracking-wide ${compact ? "text-lg sm:text-xl" : "text-xl sm:text-2xl"}`}
                style={sigMatchTitleStyle}
              >
                {title}
              </h1>
              {timerVisible ? (
                <div className="flex justify-center">
                  <SigCleanTimerPill
                    timerPaused={timerPaused}
                    timerText={timerText}
                    compact={compact}
                    timerTextStyle={timerTextOutlineStyle}
                  />
                </div>
              ) : null}
              <div className="flex w-full items-end">
                {duelData.sides.map((side, i) => (
                  <div
                    key={`sig-triple-members-${i}-${side.ids.join("-") || "x"}`}
                    className="flex min-w-0 flex-col items-center justify-end px-0.5"
                    style={{ width: `${tripleBar.pcts[i]}%` }}
                  >
                    <SigTeamMemberBox
                      members={tripleMemberLines[i] ?? []}
                      scoringMode={scoringMode}
                      align="center"
                      nameClass={
                        i === 0 ? "text-rose-100" : i === 1 ? "text-amber-100" : "text-sky-100"
                      }
                      scoreClass="text-white/85"
                      teamLeading={Boolean(tripleBar.leading[i])}
                      teamTint={i === 0 ? "pink" : i === 1 ? "amber" : "sky"}
                    />
                  </div>
                ))}
              </div>
              <motion.div
                className="relative shrink-0"
                animate={{ scale: barPulseKey > 0 ? [1, 1.015, 1] : 1 }}
                transition={{ duration: 0.4 }}
              >
                <div className={`relative ${sigVsBarHeightClass(compact)}`} data-sig-vs-bar="true">
                  <div className="flex h-full w-full">
                    {duelData.sides.map((side, i) => (
                      <motion.div
                        key={`sig-triple-seg-${i}-${side.ids.join("-")}`}
                        className="relative h-full overflow-hidden"
                        style={{
                          background:
                            i === 0
                              ? "linear-gradient(180deg, #f87171 0%, #dc2626 55%, #b91c1c 100%)"
                              : i === 1
                                ? "linear-gradient(180deg, #fbbf24 0%, #d97706 55%, #b45309 100%)"
                                : "linear-gradient(180deg, #60a5fa 0%, #2563eb 55%, #1d4ed8 100%)",
                        }}
                        title={side.label}
                        initial={false}
                        animate={{ width: `${tripleBar.pcts[i]}%` }}
                        transition={vsBarSpring}
                      >
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent" />
                        <SigVsBarSegmentLabel
                          score={side.score}
                          scoringMode={scoringMode}
                          narrow={(tripleBar.pcts[i] ?? 0) < 24}
                          leading={Boolean(tripleBar.leading[i])}
                          compact={compact}
                          align={i === 0 ? "start" : i === 2 ? "end" : "center"}
                        />
                      </motion.div>
                    ))}
                  </div>
                  <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
                    <SigVsBarCenterLabel
                      compact={compact}
                      gapLabel={vsCenterGapLabel}
                      variant="inline"
                      vsDesign={sigSettings.vsDesign}
                    />
                  </div>
                </div>
                <SigVsBarCenterLabel
                  compact={compact}
                  gapLabel={vsCenterGapLabel}
                  variant="belowBar"
                  vsDesign={sigSettings.vsDesign}
                />
                <SigFloatingScores bursts={floatingBursts} />
              </motion.div>
            </div>
          ) : null}

          </div>

      </div>
    </main>
  );
}

