"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RankImprovementEvent } from "@/lib/excel-member-rank-change";
import {
  DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE,
  excelMemberRankChangeStyleToCssVars,
  type ExcelMemberRankChangeStyle,
} from "@/lib/excel-member-rank-change-style";

const FX_CSS = `
.excel-rank-change-root {
  font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
}
.excel-rank-change-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: var(--excel-rank-fx-card-w, 250px);
  padding: 20px;
  background: var(--excel-rank-fx-card-bg, rgba(26, 32, 44, 0.92));
  border-radius: 20px;
  border: 2px solid var(--excel-rank-fx-card-border, rgba(77, 166, 255, 0.25));
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  color: var(--excel-rank-fx-name-color, #fff);
  text-align: center;
  opacity: 0;
  transform: translateY(100px);
  transition: all 0.4s ease-out;
}
.excel-rank-change-card.animate-in {
  opacity: 1;
  transform: translateY(0);
}
.excel-rank-change-card.celebrate {
  border-color: var(--excel-rank-fx-accent-color, #ffd700);
  box-shadow: 0 0 20px var(--excel-rank-fx-accent-color, #ffd700), 0 0 40px rgba(255, 215, 0, 0.45);
  animation: excel-rank-change-pulse 1s infinite alternate;
}
@keyframes excel-rank-change-pulse {
  from { box-shadow: 0 0 10px var(--excel-rank-fx-accent-color, #ffd700); }
  to { box-shadow: 0 0 25px var(--excel-rank-fx-accent-color, #ffd700), 0 0 45px rgba(255, 215, 0, 0.55); }
}
.excel-rank-change-name {
  font-size: var(--excel-rank-fx-name-size, 28px);
  font-weight: bold;
  margin-bottom: 10px;
  line-height: 1.2;
  word-break: keep-all;
  color: var(--excel-rank-fx-name-color, #fff);
}
.excel-rank-change-number-box {
  position: relative;
  width: var(--excel-rank-fx-rank-box-w, 80px);
  height: var(--excel-rank-fx-rank-box-h, 100px);
  overflow: hidden;
}
.excel-rank-change-num {
  position: absolute;
  left: 0;
  width: 100%;
  text-align: center;
  font-size: var(--excel-rank-fx-rank-size, 80px);
  font-weight: 900;
  line-height: 1;
  color: var(--excel-rank-fx-rank-color, #ffd700);
  text-shadow: 0 0 15px rgba(255, 215, 0, 0.7);
  transition: transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), opacity 0.2s;
}
.excel-rank-change-num.old-num {
  transform: translateY(0);
  opacity: 1;
}
.excel-rank-change-container.rank-up .excel-rank-change-num.old-num {
  transform: translateY(-100%);
  opacity: 0;
}
.excel-rank-change-num.new-num {
  transform: translateY(100%);
  opacity: 0;
}
.excel-rank-change-container.rank-up .excel-rank-change-num.new-num {
  transform: translateY(0);
  opacity: 1;
}
.excel-rank-change-icon {
  font-size: var(--excel-rank-fx-icon-size, 30px);
  color: var(--excel-rank-fx-rank-color, #ffd700);
  opacity: 0;
  transform: translateY(10px);
  transition: all 0.3s ease-out 0.2s;
  margin-top: 4px;
}
.excel-rank-change-container.rank-up .excel-rank-change-icon {
  opacity: 1;
  transform: translateY(0);
}
`;

type Phase = "idle" | "in" | "rank" | "celebrate";

type Props = {
  event: RankImprovementEvent | null;
  onDone: () => void;
  style?: ExcelMemberRankChangeStyle;
};

export function ExcelMemberRankChangeOverlay({
  event,
  onDone,
  style = DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE,
}: Props) {
  const [active, setActive] = useState<RankImprovementEvent | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const timersRef = useRef<number[]>([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const styleRef = useRef(style);
  styleRef.current = style;

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (!event) return;
    clearTimers();
    setActive(event);
    setPhase("idle");

    const schedule = (fn: () => void, ms: number) => {
      timersRef.current.push(window.setTimeout(fn, ms));
    };

    schedule(() => setPhase("in"), 100);
    schedule(() => setPhase("rank"), 500);
    schedule(() => {
      setPhase("celebrate");
      void import("canvas-confetti").then(({ default: confetti }) => {
        confetti({
          particleCount: 100,
          spread: 70,
          origin: { y: 0.6 },
          zIndex: 9999,
          colors: styleRef.current.confettiColors,
        });
      });
    }, 900);
    schedule(() => {
      setPhase("idle");
      setActive(null);
      onDoneRef.current();
    }, 1600);

    return clearTimers;
  }, [event, clearTimers]);

  if (!active) return null;

  const cardIn = phase === "in" || phase === "rank" || phase === "celebrate";
  const rankUp = phase === "rank" || phase === "celebrate";
  const cssVars = excelMemberRankChangeStyleToCssVars(style);

  return (
    <>
      <style>{FX_CSS}</style>
      <div
        className="excel-rank-change-root pointer-events-none fixed inset-0 z-[9995] flex items-center justify-center"
        style={cssVars}
        aria-hidden
      >
        <div className={`excel-rank-change-container${rankUp ? " rank-up" : ""}`}>
          <div
            className={`excel-rank-change-card${cardIn ? " animate-in" : ""}${
              phase === "celebrate" ? " celebrate" : ""
            }`}
          >
            <div className="excel-rank-change-name">{active.memberName}</div>
            <div className="excel-rank-change-number-box">
              <span className="excel-rank-change-num old-num">{active.oldRank}</span>
              <span className="excel-rank-change-num new-num">{active.newRank}</span>
            </div>
            <div className="excel-rank-change-icon">▲</div>
          </div>
        </div>
      </div>
    </>
  );
}
