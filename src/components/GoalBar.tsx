"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { formatDonorsAmount, formatManThousand } from "@/lib/state";
import { buildOverlayCellOutlineStyle } from "@/lib/text-outline-style";
import { resolveAnimatedSourceForEmbed } from "@/lib/gif-url";
import {
  GOAL_BAR_DEFAULT_TRACK_BG,
  GOAL_BAR_DEFAULT_TRACK_BORDER,
  buildGoalBarFillBackground,
  darkenHexColor,
  goalBarFillGlowRgba,
  type GoalBarAnimationMode,
} from "@/lib/goal-bar-style";

function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    prevValueRef.current = to;
    if (Math.abs(to - from) < 1) {
      setDisplay(to);
      return;
    }
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
  textColor = "#6b2d4a",
  fontSizePx,
  textOutlineColor,
  textOutlineWidthPx,
  barBgColor = GOAL_BAR_DEFAULT_TRACK_BG,
  barFillColor,
  barGifUrl,
  barGifOpacity = 45,
  barGifBrightness = 100,
  fontFamilyCss,
  animationMode = "both",
  fontWeight,
  sharpRender = false,
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
  /** 막대 트랙(배경)색 */
  barBgColor?: string;
  /** 게이지(채움) 기준색 — 그라데이션 자동 생성 */
  barFillColor?: string;
  /** 막대 트랙 배경 GIF/JPG URL */
  barGifUrl?: string;
  /** GIF/JPG 불투명도(0~100) */
  barGifOpacity?: number;
  /** GIF/JPG 밝기(40~200%) */
  barGifBrightness?: number;
  /** CSS font-family (null/undefined면 기본) */
  fontFamilyCss?: string | null;
  /** 게이지 애니메이션 */
  animationMode?: GoalBarAnimationMode;
  /** 400~900. 미지정 시 라벨 900·금액 700 */
  fontWeight?: number;
  /** 선명 렌더링 — blur 없는 외곽선 + geometricPrecision */
  sharpRender?: boolean;
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
  const trackBg = barBgColor || GOAL_BAR_DEFAULT_TRACK_BG;
  const trackBorder =
    trackBg === GOAL_BAR_DEFAULT_TRACK_BG ? GOAL_BAR_DEFAULT_TRACK_BORDER : darkenHexColor(trackBg, 0.14);
  const fillBackground = buildGoalBarFillBackground(barFillColor || "");
  const fillGlowWeak = goalBarFillGlowRgba(barFillColor || "", 0.08);
  const fillGlowStrong = goalBarFillGlowRgba(barFillColor || "", 0.22);
  const fillShadowGlow = goalBarFillGlowRgba(barFillColor || "", 0.55);
  const ambientPulse = "goalbar-ambient-pulse 4.8s ease-in-out infinite";
  const ambientSweep = "goalbar-ambient-sweep 5.2s linear infinite";
  const fillAnimation =
    animationMode === "pulse" || animationMode === "both" ? ambientPulse : undefined;
  const sweepAnimation =
    animationMode === "sweep" || animationMode === "both" ? ambientSweep : undefined;
  const textFontPx = (() => {
    if (fontSizePx != null && Number.isFinite(fontSizePx) && fontSizePx > 0) {
      return Math.max(10, Math.min(48, Math.round(fontSizePx)));
    }
    return Math.max(12, Math.round(width * 0.028));
  })();
  /** 후원순위·엑셀표와 동일 — stroke + shadow 링 (fill 색은 goalTextPaint로 고정) */
  const goalTextOutline: CSSProperties =
    textOutlineWidthPx === 0
      ? {}
      : buildOverlayCellOutlineStyle({
          fontSizePx: textFontPx,
          outlineColor: textOutlineColor,
          outlineWidthPx: textOutlineWidthPx,
          sharp: sharpRender,
        });
  const resolvedFontWeight =
    fontWeight != null && Number.isFinite(fontWeight)
      ? Math.max(400, Math.min(900, Math.round(fontWeight)))
      : undefined;
  const labelFontWeight = resolvedFontWeight ?? 900;
  const amountFontWeight = resolvedFontWeight ?? 700;
  const goalTextRender: CSSProperties = {
    display: "inline-block",
    WebkitFontSmoothing: "antialiased",
    textRendering: sharpRender ? "geometricPrecision" : "optimizeLegibility",
  };
  /** 밝은 트랙 기본 — 미설정·구버전 밝은 글자만 진한 로즈로 */
  const effectiveTextColor = (() => {
    const c = String(textColor || "").trim();
    if (!c) return "#6b2d4a";
    if (c.toLowerCase() === "#fff7fb") return "#6b2d4a";
    return c;
  })();
  const goalTextPaint: CSSProperties = {
    color: effectiveTextColor,
    WebkitTextFillColor: effectiveTextColor,
  };
  const showBarGif = Boolean((barGifUrl || "").trim());
  const barGifAnimated = useMemo(
    () => resolveAnimatedSourceForEmbed(barGifUrl || ""),
    [barGifUrl]
  );
  const barGifMediaStyle: CSSProperties = {
    opacity: Math.max(0, Math.min(100, barGifOpacity)) / 100,
    filter: `brightness(${Math.max(40, Math.min(200, barGifBrightness))}%)`,
  };

  return (
    <div
      className="overlay-goal-bar-widget"
      style={{
        width,
        padding: "0.12rem",
        borderRadius: 8,
        border: `1px solid ${trackBorder}`,
        opacity: containerOpacity,
        boxShadow: "0 2px 10px rgba(255, 140, 190, 0.22)",
        ["--overlay-goal-text-color" as string]: effectiveTextColor,
        fontFamily: fontFamilyCss || undefined,
      }}
    >
      <div
        className="relative overflow-hidden"
        style={{
          height: barH,
          borderRadius: 7,
          background: trackBg,
          boxShadow: "inset 0 1px 2px rgba(255, 160, 200, 0.28)",
        }}
      >
        {showBarGif && barGifAnimated.src ? (
          barGifAnimated.kind === "video" ? (
            <video
              src={barGifAnimated.src}
              className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
              style={barGifMediaStyle}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={barGifAnimated.src}
              alt=""
              className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover"
              style={barGifMediaStyle}
              loading="eager"
              decoding="async"
            />
          )
        ) : null}
        <div
          className="goalbar-fill absolute inset-y-0 left-0 transition-all duration-700 ease-out"
          style={{
            width: `${fillWidthPct}%`,
            borderRadius: 7,
            zIndex: 1,
            background: fillBackground,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.45), 0 0 12px ${fillShadowGlow}`,
            animation: fillAnimation,
            ["--goalbar-fill-glow-weak" as string]: fillGlowWeak,
            ["--goalbar-fill-glow-strong" as string]: fillGlowStrong,
          }}
        />
        <div
          aria-hidden
          className="goalbar-sweep pointer-events-none absolute top-0 bottom-0 left-0 rounded-full"
          style={{
            width: `${Math.min(100, fillWidthPct + 8)}%`,
            maxWidth: "100%",
            opacity: sweepAnimation ? 0.28 : 0,
            zIndex: 2,
            background:
              "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.5) 50%, rgba(255,255,255,0) 100%)",
            filter: "blur(1px)",
            animation: sweepAnimation,
          }}
        />
        <div
          className="absolute inset-0 z-[3] flex items-center justify-between px-2"
          style={{
            fontSize: textFontPx,
            letterSpacing: "-0.01em",
            transform: "translateZ(0)",
          }}
        >
          <span
            className="overlay-goal-bar-text inline-flex items-center"
            style={{
              ...goalTextPaint,
              ...goalTextRender,
              fontWeight: labelFontWeight,
              lineHeight: 1,
              ...goalTextOutline,
            }}
          >
            {normalizedLabel}
          </span>
          <span
            className="overlay-goal-bar-text"
            style={{
              ...goalTextPaint,
              ...goalTextRender,
              fontWeight: amountFontWeight,
              lineHeight: 1,
              ...goalTextOutline,
            }}
          >
            {compactLabel ? "후원 " : ""}
            {formatAmount(current)} / {formatAmount(goal)} ({displayPct}%)
          </span>
        </div>
      </div>
      <style jsx>{`
        @keyframes goalbar-ambient-pulse {
          0%,
          100% {
            filter: drop-shadow(0 0 0 var(--goalbar-fill-glow-weak, rgba(255, 192, 222, 0.08)));
          }
          50% {
            filter: drop-shadow(0 0 7px var(--goalbar-fill-glow-strong, rgba(255, 192, 222, 0.22)));
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
