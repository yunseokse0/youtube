"use client";

import type { CSSProperties, ReactNode } from "react";

function scoreTextStyle(): CSSProperties {
  return {
    color: "#ffffff",
    textShadow: "0 1px 2px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.8)",
    WebkitTextStroke: "0.4px rgba(0,0,0,0.35)",
    paintOrder: "stroke fill",
  };
}

export default function BattleTeamScoreHeader({
  leftName,
  leftScore,
  rightName,
  rightScore,
  compact = false,
  formatScore = (n) => Math.round(n).toLocaleString("ko-KR"),
  leftRatio,
  rightRatio,
  gapLabel,
  centerSlot,
  timerSlot,
}: {
  leftName: string;
  rightName: string;
  leftScore: number;
  rightScore: number;
  compact?: boolean;
  formatScore?: (n: number) => string;
  /** 0–100. 미지정 시 점수 비율(합 0이면 50:50) */
  leftRatio?: number;
  rightRatio?: number;
  /** VS 아래 선두 차액 라벨 (예: "12,000"). 동점(0)도 표시 */
  gapLabel?: string | null;
  /** VS 자리 — 기본은 VS 뱃지 (+ gapLabel) */
  centerSlot?: ReactNode;
  /** VS 위 타이머 등 */
  timerSlot?: ReactNode;
}) {
  const total = Math.max(0, leftScore) + Math.max(0, rightScore);
  let leftPct =
    typeof leftRatio === "number" && Number.isFinite(leftRatio)
      ? leftRatio
      : total > 0
        ? (Math.max(0, leftScore) / total) * 100
        : 50;
  let rightPct =
    typeof rightRatio === "number" && Number.isFinite(rightRatio)
      ? rightRatio
      : 100 - leftPct;
  leftPct = Math.max(18, Math.min(82, leftPct));
  rightPct = Math.max(18, Math.min(82, rightPct));
  const sum = leftPct + rightPct;
  if (sum > 0 && Math.abs(sum - 100) > 0.01) {
    leftPct = (leftPct / sum) * 100;
    rightPct = 100 - leftPct;
  }

  const leftLeading = leftScore > rightScore;
  const rightLeading = rightScore > leftScore;
  const scoreGap = Math.abs(leftScore - rightScore);
  const computedGap =
    typeof gapLabel === "string" && gapLabel.trim()
      ? gapLabel.trim()
      : formatScore(scoreGap);
  const barH = compact ? "h-12 sm:h-14" : "h-14 sm:h-16";
  const scoreSize = compact
    ? "text-xl sm:text-2xl md:text-3xl"
    : "text-2xl sm:text-3xl md:text-4xl";
  const nameSize = compact ? "text-xs sm:text-sm" : "text-sm sm:text-base";
  const gapSize = compact ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm";

  const vsBadge = (
    <span
      className={`flex items-center justify-center rounded-lg font-black tracking-[0.12em] text-white shadow-md ring-1 ring-white/25 ${
        compact ? "h-8 min-w-[2.25rem] px-1.5 text-sm" : "h-9 min-w-[2.5rem] px-2 text-base sm:text-lg"
      }`}
      style={{
        background:
          "linear-gradient(135deg, rgba(220,38,38,0.95) 0%, rgba(23,23,23,0.96) 48%, rgba(37,99,235,0.95) 100%)",
      }}
    >
      VS
    </span>
  );

  const defaultCenter = (
    <div className="flex items-center justify-center" data-battle-vs-center="true">
      {vsBadge}
    </div>
  );

  const gapRow =
    !centerSlot ? (
      <div className="relative z-20 flex justify-center py-0.5" data-battle-vs-gap-row="true">
        <span
          className={`rounded-md bg-neutral-950/90 px-1.5 py-0.5 font-black tabular-nums text-amber-100 ring-1 ring-amber-300/40 ${gapSize}`}
          data-battle-vs-gap="true"
          title="선두 차액"
        >
          +{computedGap}
        </span>
      </div>
    ) : null;

  return (
    <div className="w-full" data-battle-team-score-header="true" data-battle-vs-style="clean">
      {timerSlot ? <div className="mb-1 flex justify-center">{timerSlot}</div> : null}

      <div className="relative">
        <div
          className={`relative flex w-full overflow-hidden rounded-xl shadow-[0_4px_18px_rgba(0,0,0,0.35)] ring-1 ring-white/15 ${barH}`}
        >
          <div
            className={`relative flex h-full min-w-0 items-center justify-center overflow-hidden transition-[width] duration-500 ease-out ${
              leftLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              width: `${leftPct}%`,
              background: "linear-gradient(180deg, #f87171 0%, #dc2626 48%, #b91c1c 100%)",
            }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            <span
              className={`relative z-[1] px-2 font-black tabular-nums leading-none tracking-tight ${scoreSize}`}
              style={scoreTextStyle()}
            >
              {formatScore(leftScore)}
            </span>
          </div>

          <div
            className={`relative flex h-full min-w-0 items-center justify-center overflow-hidden transition-[width] duration-500 ease-out ${
              rightLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              width: `${rightPct}%`,
              background: "linear-gradient(180deg, #60a5fa 0%, #2563eb 48%, #1d4ed8 100%)",
            }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/25 to-transparent" />
            <span
              className={`relative z-[1] px-2 font-black tabular-nums leading-none tracking-tight ${scoreSize}`}
              style={scoreTextStyle()}
            >
              {formatScore(rightScore)}
            </span>
          </div>
        </div>

        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center">
          {centerSlot ?? defaultCenter}
        </div>
      </div>

      {gapRow}

      <div className={`grid grid-cols-2 gap-2 px-0.5 ${gapRow ? "mt-1" : "mt-1.5"}`}>
        <div className="flex justify-start">
          <span
            className={`inline-flex max-w-full truncate rounded-md px-2.5 py-0.5 font-bold text-white shadow-sm ${nameSize} ${
              leftLeading ? "bg-emerald-600/95 ring-1 ring-white/20" : "bg-neutral-800/90 ring-1 ring-white/10"
            }`}
          >
            {leftName}
          </span>
        </div>
        <div className="flex justify-end">
          <span
            className={`inline-flex max-w-full truncate rounded-md px-2.5 py-0.5 font-bold text-white shadow-sm ${nameSize} ${
              rightLeading ? "bg-emerald-600/95 ring-1 ring-white/20" : "bg-neutral-800/90 ring-1 ring-white/10"
            }`}
          >
            {rightName}
          </span>
        </div>
      </div>
    </div>
  );
}
