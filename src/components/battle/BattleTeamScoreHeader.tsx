"use client";

import type { CSSProperties } from "react";

function leaderScoreStyle(leading: boolean): CSSProperties {
  if (!leading) {
    return {
      color: "rgba(255,255,255,0.88)",
      textShadow: "0 2px 8px rgba(0,0,0,0.85), -1px 0 0 #000, 1px 0 0 #000",
    };
  }
  return {
    color: "#fef08a",
    textShadow:
      "0 0 16px rgba(250,204,21,0.9), 0 2px 10px rgba(0,0,0,0.95), -1px 0 0 #000, 1px 0 0 #000",
  };
}

function leaderNameClass(leading: boolean): string {
  return leading
    ? "rounded-md bg-amber-400/25 px-2 py-0.5 font-black text-amber-100 ring-1 ring-amber-300/50"
    : "font-bold text-white/85";
}

export default function BattleTeamScoreHeader({
  leftName,
  leftScore,
  rightName,
  rightScore,
  compact = false,
  formatScore = (n) => Math.round(n).toLocaleString("ko-KR"),
}: {
  leftName: string;
  rightName: string;
  leftScore: number;
  rightScore: number;
  compact?: boolean;
  formatScore?: (n: number) => string;
}) {
  const leftLeading = leftScore > rightScore;
  const rightLeading = rightScore > leftScore;
  const scoreSize = compact ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl md:text-5xl";
  const nameSize = compact ? "text-sm sm:text-base" : "text-base sm:text-lg";

  return (
    <div
      className="grid grid-cols-[1fr_auto_1fr] items-end gap-2 sm:gap-4"
      data-battle-team-score-header="true"
    >
      <div className="flex flex-col items-start gap-1 min-w-0">
        <span
          className={`font-black tabular-nums leading-none ${scoreSize}`}
          style={leaderScoreStyle(leftLeading || (!leftLeading && !rightLeading && leftScore >= rightScore))}
        >
          {formatScore(leftScore)}
        </span>
        <span className={`truncate max-w-full ${nameSize} ${leaderNameClass(leftLeading)}`}>{leftName}</span>
      </div>
      <span
        className={`pb-1 font-black tracking-[0.25em] text-amber-300 ${compact ? "text-lg" : "text-xl sm:text-2xl"}`}
        style={{ textShadow: "0 0 10px rgba(251,191,36,0.75), 0 2px 6px rgba(0,0,0,0.9)" }}
      >
        VS
      </span>
      <div className="flex flex-col items-end gap-1 min-w-0">
        <span
          className={`font-black tabular-nums leading-none ${scoreSize}`}
          style={leaderScoreStyle(rightLeading)}
        >
          {formatScore(rightScore)}
        </span>
        <span className={`truncate max-w-full text-right ${nameSize} ${leaderNameClass(rightLeading)}`}>
          {rightName}
        </span>
      </div>
    </div>
  );
}
