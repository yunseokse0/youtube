"use client";

import type { CSSProperties, ReactNode } from "react";

function scoreBoxStyle(): CSSProperties {
  return {
    color: "#ffffff",
    textShadow: "0 1px 3px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.85)",
    WebkitTextStroke: "0.35px rgba(0,0,0,0.35)",
    paintOrder: "stroke fill",
  };
}

/** 대전 3열 보드 — 좌 빨강 / 중앙 타이머+차액 / 우 파랑 (방송 스크린샷형) */
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
}: {
  leftScore: number;
  rightScore: number;
  /** 팀 멤버 이름 (쉼표 구분 문자열) */
  leftMemberLabel: string;
  rightMemberLabel: string;
  compact?: boolean;
  formatScore?: (n: number) => string;
  /** 중앙 금색 차액. 미지정 시 |좌-우| 자동 계산. 동점이면 숨김 */
  gapLabel?: string | null;
  /** 차액 뒤 단위 (예: "원") */
  gapSuffix?: string;
  timerSlot?: ReactNode;
}) {
  const scoreGap = Math.abs(leftScore - rightScore);
  const computedGap =
    scoreGap > 0
      ? typeof gapLabel === "string" && gapLabel.trim()
        ? gapLabel.trim()
        : formatScore(scoreGap)
      : null;

  const scoreSize = compact
    ? "text-xl sm:text-2xl"
    : "text-2xl sm:text-3xl md:text-[2rem]";
  const nameSize = compact ? "text-[10px] sm:text-xs" : "text-xs sm:text-sm";
  const gapSize = compact ? "text-sm sm:text-base" : "text-base sm:text-lg md:text-xl";
  const timerWrapClass = compact ? "min-w-[5.5rem]" : "min-w-[6.5rem] sm:min-w-[7rem]";
  const teamBoxClass = compact
    ? "min-w-[7rem] px-3 py-2 sm:min-w-[7.5rem]"
    : "min-w-[8rem] px-4 py-2.5 sm:min-w-[9rem] md:min-w-[10rem]";

  const leftLeading = leftScore > rightScore;
  const rightLeading = rightScore > leftScore;

  return (
    <div
      className="mx-auto w-full max-w-3xl"
      data-battle-team-column-board="true"
    >
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-x-2 sm:gap-x-3">
        <div className="flex flex-col items-center">
          <div
            className={`flex w-full items-center justify-center rounded-lg shadow-[0_3px_14px_rgba(0,0,0,0.35)] ring-1 ring-white/20 ${teamBoxClass} ${
              leftLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              background: "linear-gradient(180deg, #f87171 0%, #dc2626 52%, #b91c1c 100%)",
            }}
            data-battle-team-box="left"
          >
            <span
              className={`font-black tabular-nums leading-none tracking-tight ${scoreSize}`}
              style={scoreBoxStyle()}
            >
              {formatScore(leftScore)}
            </span>
          </div>
          {leftMemberLabel ? (
            <p
              className={`mt-1 max-w-full truncate px-1 text-center font-semibold text-white/85 ${nameSize}`}
              data-battle-team-names="left"
            >
              {leftMemberLabel}
            </p>
          ) : null}
        </div>

        <div className={`flex flex-col items-center gap-1.5 ${timerWrapClass}`}>
          {timerSlot ? (
            <div className="flex w-full justify-center" data-battle-team-timer="true">
              {timerSlot}
            </div>
          ) : null}
          {computedGap ? (
            <div
              className={`w-full rounded-md border-2 border-amber-950/70 bg-gradient-to-b from-amber-200 via-amber-300 to-amber-400 px-2 py-1 text-center font-black tabular-nums text-amber-950 shadow-[0_2px_8px_rgba(0,0,0,0.35)] ${gapSize}`}
              data-battle-team-gap="true"
              title="금액 차"
            >
              {computedGap}
              {gapSuffix}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-center">
          <div
            className={`flex w-full items-center justify-center rounded-lg shadow-[0_3px_14px_rgba(0,0,0,0.35)] ring-1 ring-white/20 ${teamBoxClass} ${
              rightLeading ? "brightness-110" : "brightness-95"
            }`}
            style={{
              background: "linear-gradient(180deg, #60a5fa 0%, #2563eb 52%, #1d4ed8 100%)",
            }}
            data-battle-team-box="right"
          >
            <span
              className={`font-black tabular-nums leading-none tracking-tight ${scoreSize}`}
              style={scoreBoxStyle()}
            >
              {formatScore(rightScore)}
            </span>
          </div>
          {rightMemberLabel ? (
            <p
              className={`mt-1 max-w-full truncate px-1 text-center font-semibold text-white/85 ${nameSize}`}
              data-battle-team-names="right"
            >
              {rightMemberLabel}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
