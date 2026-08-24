"use client";

import type { CSSProperties, ReactNode } from "react";
import BattleGaugeFitScore from "@/components/battle/BattleGaugeFitScore";
import { VsCenterBadge } from "@/components/battle/VsCenterBadge";

function scoreTextStyle(): CSSProperties {
  return {
    color: "#ffffff",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
  };
}

/**
 * 대전 합산 게이지 — 빨강|파랑 한 줄로 붙이고 중앙 VS.
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
}) {
  const total = Math.max(0, leftScore) + Math.max(0, rightScore);
  let leftPct = total > 0 ? (Math.max(0, leftScore) / total) * 100 : 50;
  let rightPct = 100 - leftPct;
  leftPct = Math.max(18, Math.min(82, leftPct));
  rightPct = Math.max(18, Math.min(82, rightPct));
  const sum = leftPct + rightPct;
  if (sum > 0 && Math.abs(sum - 100) > 0.01) {
    leftPct = (leftPct / sum) * 100;
    rightPct = 100 - leftPct;
  }

  const scoreGap = Math.abs(leftScore - rightScore);
  const computedGap =
    typeof gapLabel === "string" && gapLabel.trim()
      ? gapLabel.trim()
      : formatScore(scoreGap);

  const leftLeading = leftScore > rightScore;
  const rightLeading = rightScore > leftScore;

  const barH = compact ? "h-12 sm:h-14" : "h-14 sm:h-16";
  const nameSize = compact ? "text-xs sm:text-sm" : "text-sm sm:text-base";
  const gapSize = compact ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm";
  const gaugeMaxFontPx = compact ? 16 : 20;
  const leftLabel = formatScore(leftScore);
  const rightLabel = formatScore(rightScore);

  return (
    <div className="studio-glass-panel w-full overflow-hidden p-1.5" data-battle-team-column-board="true" data-battle-vs-style="attached">
      {timerSlot ? <div className="mb-1 flex justify-center">{timerSlot}</div> : null}

      <div className="relative">
        <div
          className={`relative flex w-full overflow-hidden rounded-studio shadow-glass ring-1 ring-white/12 backdrop-blur-studio ${barH}`}
          data-battle-vs-bar="true"
        >
          <div
            className={`relative h-full min-w-0 overflow-hidden transition-[width] duration-500 ease-out ${
              leftLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              width: `${leftPct}%`,
              background: "linear-gradient(180deg, #f87171 0%, #dc2626 48%, #b91c1c 100%)",
            }}
            data-battle-team-box="left"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-2">
              <BattleGaugeFitScore
                label={leftLabel}
                maxFontPx={gaugeMaxFontPx}
                className="block max-w-full font-black tabular-nums tracking-tight"
                style={scoreTextStyle()}
              />
            </div>
          </div>

          <div
            className={`relative h-full min-w-0 overflow-hidden transition-[width] duration-500 ease-out ${
              rightLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              width: `${rightPct}%`,
              background: "linear-gradient(180deg, #60a5fa 0%, #2563eb 48%, #1d4ed8 100%)",
            }}
            data-battle-team-box="right"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center px-2">
              <BattleGaugeFitScore
                label={rightLabel}
                maxFontPx={gaugeMaxFontPx}
                className="block max-w-full font-black tabular-nums tracking-tight"
                style={scoreTextStyle()}
              />
            </div>
          </div>
        </div>

        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center"
          data-battle-vs-center="true"
        >
          <VsCenterBadge design={vsDesign} compact={compact} />
        </div>
      </div>

      <div className="relative z-20 flex justify-center py-0.5" data-battle-team-gap-row="true">
        <span
          className={`rounded-md bg-neutral-950/90 px-1.5 py-0.5 font-black tabular-nums text-amber-100 ring-1 ring-amber-300/40 ${gapSize}`}
          data-battle-team-gap="true"
          title="선두 차액"
        >
          +{computedGap}
          {gapSuffix}
        </span>
      </div>

      <div className={`grid grid-cols-2 gap-2 px-0.5 mt-1`}>
        <div className="flex justify-start">
          {leftMemberLabel ? (
            <span
              className={`inline-flex max-w-full truncate rounded-md px-2.5 py-0.5 font-bold text-white shadow-sm ${nameSize} ${
                leftLeading ? "bg-emerald-600/95 ring-1 ring-white/20" : "bg-neutral-800/90 ring-1 ring-white/10"
              }`}
              data-battle-team-names="left"
            >
              {leftMemberLabel}
            </span>
          ) : null}
        </div>
        <div className="flex justify-end">
          {rightMemberLabel ? (
            <span
              className={`inline-flex max-w-full truncate rounded-md px-2.5 py-0.5 font-bold text-white shadow-sm ${nameSize} ${
                rightLeading ? "bg-emerald-600/95 ring-1 ring-white/20" : "bg-neutral-800/90 ring-1 ring-white/10"
              }`}
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
