"use client";

import type { CSSProperties, ReactNode } from "react";
import BattleGaugeFitScore from "@/components/battle/BattleGaugeFitScore";
import { VsCenterBadge } from "@/components/battle/VsCenterBadge";
import {
  clampSigMatchGaugeDisplayPct,
  getSigMatchGaugeTheme,
  type SigMatchGaugeThemeId,
} from "@/lib/sig-match-gauge-theme";
import { isGlowVsDesign, normalizeVsDesign } from "@/lib/vs-design";

function scoreTextStyle(): CSSProperties {
  return {
    color: "#ffffff",
    textShadow: "0 1px 3px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.95)",
    WebkitTextStroke: "0.5px rgba(0,0,0,0.65)",
    paintOrder: "stroke fill",
  };
}

/** 엑셀 멤버명 수준 — 굵기 + 외곽선으로 OBS 가독성 */
function memberNameTextStyle(): CSSProperties {
  return {
    color: "#ffffff",
    WebkitTextStroke: "0.65px rgba(0,0,0,0.95)",
    paintOrder: "stroke fill",
    textShadow:
      "0 0 1px rgba(0,0,0,1), 0 1px 3px rgba(0,0,0,0.95), 1px 0 1px rgba(0,0,0,0.8), -1px 0 1px rgba(0,0,0,0.8)",
  };
}

function ThemeVsBadge({
  themeId,
  compact,
  vsDesign,
}: {
  themeId: SigMatchGaugeThemeId;
  compact?: boolean;
  vsDesign?: unknown;
}) {
  const design = normalizeVsDesign(vsDesign);
  if (isGlowVsDesign(design)) {
    return <VsCenterBadge design={vsDesign} compact={compact} />;
  }
  const theme = getSigMatchGaugeTheme(themeId);
  const size = compact ? "h-9 w-9 text-xs" : "h-11 w-11 text-sm sm:h-12 sm:w-12 sm:text-base";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-black tracking-[0.14em] ${size}`}
      style={{
        background: theme.vsBg,
        color: theme.vsText,
        border: `2px solid ${theme.vsBorder}`,
        boxShadow: theme.vsGlow,
      }}
      data-vs-design="theme-metal"
      data-gauge-theme={theme.id}
    >
      VS
    </span>
  );
}

/**
 * 대전 합산 게이지 — 테마별 네온/글래스 바 + 사선 경계 + 중앙 VS.
 * 타이머는 바 위, 선두 차액은 바 아래(0이어도 표시), 멤버명은 좌·우 하단.
 */
export default function BattleTeamColumnBoard({
  leftScore,
  rightScore,
  leftMemberLabel,
  rightMemberLabel,
  compact = false,
  formatScore = (n) => Math.round(n).toLocaleString("ko-KR"),
  gapLabel,
  gapSuffix = "",
  timerSlot,
  vsDesign,
  theme: themeRaw,
}: {
  leftScore: number;
  rightScore: number;
  /** 팀 멤버 이름 (쉼표 구분 문자열) */
  leftMemberLabel: string;
  rightMemberLabel: string;
  compact?: boolean;
  formatScore?: (n: number) => string;
  /** 중앙 아래 차액. 미지정 시 |좌-우| 자동 계산. 동점(0)도 표시 */
  gapLabel?: string | null;
  /** 차액 뒤 단위 (예: "원") — gapLabel에 이미 단위가 있으면 비움 */
  gapSuffix?: string;
  timerSlot?: ReactNode;
  vsDesign?: unknown;
  /** URL `theme` — 시각만 변경 */
  theme?: unknown;
}) {
  const theme = getSigMatchGaugeTheme(themeRaw);
  const total = Math.max(0, leftScore) + Math.max(0, rightScore);
  const rawLeftPct = total > 0 ? (Math.max(0, leftScore) / total) * 100 : 50;
  const { leftPct, rightPct } = clampSigMatchGaugeDisplayPct(rawLeftPct);

  const scoreGap = Math.abs(leftScore - rightScore);
  const computedGap =
    typeof gapLabel === "string" && gapLabel.trim()
      ? gapLabel.trim()
      : formatScore(scoreGap);

  const leftLeading = leftScore > rightScore;
  const rightLeading = rightScore > leftScore;

  const barH = compact ? "h-12 sm:h-14" : "h-14 sm:h-16";
  const nameSize = compact ? "text-sm sm:text-base" : "text-base sm:text-lg";
  const gapSize = compact ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm";
  const gaugeMaxFontPx = compact ? 18 : 22;
  const leftLabel = formatScore(leftScore);
  const rightLabel = formatScore(rightScore);

  return (
    <div
      className="w-full overflow-visible bg-transparent p-0"
      data-battle-team-column-board="true"
      data-battle-vs-style="attached"
      data-gauge-theme={theme.id}
    >
      {timerSlot ? <div className="mb-1 flex justify-center">{timerSlot}</div> : null}

      <div className="relative">
        <div
          className={`relative flex w-full overflow-hidden rounded-xl backdrop-blur-md ${barH}`}
          data-battle-vs-bar="true"
          style={{
            background: theme.trackBg,
            border: `1px solid ${theme.trackBorder}`,
            boxShadow: theme.trackShadow,
          }}
        >
          {/* 상단 하이라이트 */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[2] h-[2px] bg-white/30" />

          <div
            className={`relative z-[1] h-full min-w-0 overflow-hidden transition-[width] duration-500 ease-out ${
              leftLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              width: `${leftPct}%`,
              background: theme.leftFill,
              clipPath: "polygon(0 0, 100% 0, calc(100% - 14px) 100%, 0 100%)",
              marginRight: "-10px",
            }}
            data-battle-team-box="left"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-start pl-2.5 sm:pl-3">
              <BattleGaugeFitScore
                label={leftLabel}
                maxFontPx={gaugeMaxFontPx}
                className="block max-w-[calc(100%-0.5rem)] font-black tabular-nums tracking-tight"
                style={scoreTextStyle()}
              />
            </div>
          </div>

          <div
            className={`relative z-[1] h-full min-w-0 overflow-hidden transition-[width] duration-500 ease-out ${
              rightLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              width: `${rightPct}%`,
              background: theme.rightFill,
              clipPath: "polygon(14px 0, 100% 0, 100% 100%, 0 100%)",
            }}
            data-battle-team-box="right"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/30 to-transparent" />
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-end pr-2.5 sm:pr-3">
              <BattleGaugeFitScore
                label={rightLabel}
                maxFontPx={gaugeMaxFontPx}
                className="block max-w-[calc(100%-0.5rem)] text-right font-black tabular-nums tracking-tight"
                style={scoreTextStyle()}
              />
            </div>
          </div>
        </div>

        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center"
          data-battle-vs-center="true"
        >
          <ThemeVsBadge themeId={theme.id} compact={compact} vsDesign={vsDesign} />
        </div>
      </div>

      <div className="relative z-20 flex justify-center py-1" data-battle-team-gap-row="true">
        <span
          className={`inline-flex items-center rounded-full px-3 py-0.5 font-black tabular-nums shadow-md backdrop-blur-sm ${gapSize}`}
          style={{
            background: theme.gapBg,
            color: theme.gapText,
            border: `1px solid ${theme.gapBorder}`,
            boxShadow: `0 0 12px ${theme.gapBorder}`,
          }}
          data-battle-team-gap="true"
          title="선두 차액"
        >
          ! {computedGap}
          {gapSuffix} !
        </span>
      </div>

      <div className={`mt-1 grid grid-cols-2 gap-2 px-0.5`}>
        <div className="flex justify-start">
          {leftMemberLabel ? (
            <span
              className={`inline-flex max-w-full truncate px-0.5 py-0.5 font-black tracking-tight ${nameSize} ${
                leftLeading ? "text-emerald-100" : "text-white"
              }`}
              style={memberNameTextStyle()}
              data-battle-team-names="left"
            >
              {leftMemberLabel}
            </span>
          ) : null}
        </div>
        <div className="flex justify-end">
          {rightMemberLabel ? (
            <span
              className={`inline-flex max-w-full truncate px-0.5 py-0.5 font-black tracking-tight ${nameSize} ${
                rightLeading ? "text-emerald-100" : "text-white"
              }`}
              style={memberNameTextStyle()}
              data-battle-team-names="right"
            >
              {rightMemberLabel}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
