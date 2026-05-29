"use client";

import { useEffect, useRef, useState } from "react";
import { formatDonorsAmount, formatManThousand } from "@/lib/state";
import { buildTextOutlineStyle } from "@/lib/text-outline-style";

function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    prevValueRef.current = to;
    startRef.current = performance.now();
    const loop = (t: number) => {
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round((from + (to - from) * eased) * 10) / 10);
      if (p < 1) rafRef.current = requestAnimationFrame(loop);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return display;
}

export function GoalBar({
  current,
  goal,
  label,
  width,
  compactLabel = false,
  opacityPercent = 100,
  opacityAffectsText = false,
  textColor = "#fff7fb",
  fontSizePx,
  textOutlineColor,
  textOutlineWidthPx,
  amountFormat = "short",
  locale = "ko-KR",
}: {
  current: number;
  goal: number;
  label: string;
  width: number;
  compactLabel?: boolean;
  opacityPercent?: number;
  opacityAffectsText?: boolean;
  textColor?: string;
  /** 지정 시 막대 너비 비례 자동 크기 대신 px 고정 */
  fontSizePx?: number;
  /** 비우면 기본 진한 외곽선. hex/rgba */
  textOutlineColor?: string;
  /** 0이면 외곽선 없음. 미지정 시 글자 크기에 비례 */
  textOutlineWidthPx?: number;
  /** `short` = 만원 축약, `full` = 입력한 원 그대로(쉼표만) */
  amountFormat?: "full" | "short";
  locale?: string;
}) {
  const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
  const displayPct = useCountUp(Math.round(pct * 10) / 10, 600);
  const barH = Math.max(26, Math.round(width * 0.055));
  const normalizedLabel = (() => {
    const raw = (label || "").trim();
    if (!raw) return "후원";
    const compact = raw.replace(/\s+/g, "");
    if (compact.includes("목표")) return "후원";
    return raw;
  })();
  const formatAmount = (n: number) => {
    if (amountFormat === "full") {
      return formatDonorsAmount(n, "full", locale || "ko-KR");
    }
    const safe = Math.max(0, Number(n) || 0);
    return `${formatManThousand(safe)}만원`;
  };
  /** 막대 본체는 항상 불투명 — goalOpacity는 「텍스트도 투명화」 체크 시에만 전체 위젯에만 적용 */
  const fadeWholeWidget =
    opacityAffectsText && Math.max(0, Math.min(100, opacityPercent)) < 100;
  const containerOpacity = fadeWholeWidget
    ? Math.max(0, Math.min(100, opacityPercent)) / 100
    : 1;
  const fillWidthPct = pct <= 0 ? 0 : Math.min(100, Math.max(pct, 2));
  const GOAL_TRACK_BG = "#2a1528";
  const GOAL_TRACK_BORDER = "#ffc4dc";
  const textFontPx = (() => {
    if (fontSizePx != null && Number.isFinite(fontSizePx) && fontSizePx > 0) {
      return Math.max(10, Math.min(48, Math.round(fontSizePx)));
    }
    return Math.max(12, Math.round(width * 0.028));
  })();
  const ambientPulse = "goalbar-ambient-pulse 4.8s ease-in-out infinite";
  const ambientSweep = "goalbar-ambient-sweep 5.2s linear infinite";
  const goalTextOutline = buildTextOutlineStyle({
    fontSizePx: textFontPx,
    outlineColor: textOutlineColor,
    outlineWidthPx: textOutlineWidthPx,
  });

  return (
    <div
      style={{
        width,
        padding: "0.12rem",
        borderRadius: 8,
        border: `1px solid ${GOAL_TRACK_BORDER}`,
        opacity: containerOpacity,
        boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
      }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          height: barH,
          borderRadius: 7,
          background: GOAL_TRACK_BG,
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.45)",
        }}
      >
        <div
          className="goalbar-fill absolute inset-y-0 left-0 transition-all duration-700 ease-out"
          style={{
            width: `${fillWidthPct}%`,
            borderRadius: 7,
            zIndex: 1,
            background:
              "linear-gradient(90deg, #ff9ec8 0%, #ff6eb5 42%, #ffc4e3 100%)",
            boxShadow:
              "inset 0 1px 0 rgba(255,255,255,0.45), 0 0 12px rgba(255, 110, 180, 0.55)",
            animation: ambientPulse,
          }}
        />
        <div
          aria-hidden
          className="goalbar-sweep pointer-events-none absolute top-0 bottom-0 left-0 rounded-full"
          style={{
            width: `${Math.min(100, fillWidthPct + 8)}%`,
            maxWidth: "100%",
            opacity: 0.28,
            zIndex: 2,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 100%)",
            filter: "blur(1px)",
            animation: ambientSweep,
          }}
        />
        <div
          className="absolute inset-0 z-[3] flex items-center justify-between px-2"
          style={{ fontSize: textFontPx, letterSpacing: "-0.01em" }}
        >
          <span
            className="inline-flex items-center"
            style={{
              color: textColor,
              fontWeight: 900,
              lineHeight: 1,
              ...goalTextOutline,
            }}
          >
            {normalizedLabel}
          </span>
          <span style={{ color: textColor, fontWeight: 700, lineHeight: 1, ...goalTextOutline }}>
            {compactLabel ? "후원 " : ""}
            {formatAmount(current)} / {formatAmount(goal)}{" "}
            <span style={{ color: pct <= 0 ? "#e5e7eb" : textColor }}>({displayPct}%)</span>
          </span>
        </div>
      </div>
      <style jsx>{`
        @keyframes goalbar-ambient-pulse {
          0%,
          100% {
            filter: drop-shadow(0 0 0 rgba(255, 192, 222, 0.08));
          }
          50% {
            filter: drop-shadow(0 0 7px rgba(255, 192, 222, 0.22));
          }
        }
        @keyframes goalbar-ambient-sweep {
          0% {
            transform: translateX(-34%);
          }
          100% {
            transform: translateX(320%);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .goalbar-fill,
          .goalbar-sweep {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
