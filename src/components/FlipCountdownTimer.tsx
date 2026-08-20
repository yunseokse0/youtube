"use client";

import {
  buildFlipCountdownSegments,
  type FlipCountdownSegment,
} from "@/lib/timer-design";
import { applyTimerBackgroundOpacity, isTimerBackgroundHidden } from "@/lib/overlay-params";
import { resolveTimerFontFamilyCss } from "@/lib/timer-font-style";

const FLIP_LABEL_COLOR = "#d4a017";
const FLIP_CARD_BG = "#3a3a3a";
const FLIP_DIGIT_COLOR = "#ececec";
/** MINUTES / SECONDS 등 하단 라벨 — digit 대비 크기 */
const FLIP_LABEL_SIZE_RATIO = 0.22;

function FlipCard({
  segment,
  digitSize,
  fontFamilyCss,
  digitColor,
  cardBg,
}: {
  segment: FlipCountdownSegment;
  digitSize: number;
  fontFamilyCss: string;
  digitColor: string;
  cardBg: string;
}) {
  const cardW = Math.round(digitSize * 1.55);
  const cardH = Math.round(digitSize * 1.35);
  const splitY = Math.round(cardH / 2);
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative overflow-hidden rounded-xl shadow-[0_8px_18px_rgba(0,0,0,0.45)]"
        style={{
          width: cardW,
          height: cardH,
          background: cardBg,
        }}
      >
        <div
          className="absolute inset-0 flex items-center justify-center font-bold tabular-nums"
          style={{
            fontFamily: fontFamilyCss,
            fontSize: digitSize,
            lineHeight: 1,
            color: digitColor,
            textShadow: "0 1px 0 rgba(255,255,255,0.12), 0 -1px 0 rgba(0,0,0,0.35)",
          }}
        >
          {segment.value}
        </div>
        <div
          className="pointer-events-none absolute left-0 right-0"
          style={{
            top: splitY - 1,
            height: 2,
            background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(255,255,255,0.08) 100%)",
            boxShadow: "0 1px 0 rgba(255,255,255,0.06)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 top-0"
          style={{
            height: splitY,
            background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)",
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0"
          style={{
            height: splitY,
            background: "linear-gradient(0deg, rgba(0,0,0,0.18) 0%, transparent 100%)",
          }}
        />
      </div>
      <span
        className="max-w-full truncate text-center font-semibold uppercase leading-none"
        style={{
          color: FLIP_LABEL_COLOR,
          fontSize: Math.max(7, Math.round(digitSize * FLIP_LABEL_SIZE_RATIO)),
          letterSpacing: "0.08em",
          width: cardW,
        }}
      >
        {segment.label}
      </span>
    </div>
  );
}

export function FlipCountdownTimer({
  remainingSeconds,
  showHours = false,
  fontSize = 48,
  fontFamily,
  fontColor,
  bgColor,
  bgOpacity = 40,
}: {
  remainingSeconds: number | null | undefined;
  showHours?: boolean;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  bgColor?: string;
  bgOpacity?: number;
}) {
  if (remainingSeconds == null || !Number.isFinite(remainingSeconds)) return null;
  const segments = buildFlipCountdownSegments(remainingSeconds, showHours);
  if (segments.length === 0) return null;

  const digitColor = (fontColor || "").trim() || FLIP_DIGIT_COLOR;
  const opacity = Math.max(0, Math.min(100, bgOpacity ?? 40));
  const noBackground = isTimerBackgroundHidden(bgColor, opacity);
  const cardBg = noBackground
    ? FLIP_CARD_BG
    : applyTimerBackgroundOpacity((bgColor || "").trim() || FLIP_CARD_BG, opacity);
  const fontFamilyCss = resolveTimerFontFamilyCss(fontFamily);
  const gap = Math.max(6, Math.round(fontSize * 0.22));

  return (
    <div
      className="inline-flex items-end justify-center"
      style={{ gap }}
      suppressHydrationWarning
    >
      {segments.map((segment) => (
        <FlipCard
          key={segment.label}
          segment={segment}
          digitSize={fontSize}
          fontFamilyCss={fontFamilyCss}
          digitColor={digitColor}
          cardBg={cardBg}
        />
      ))}
    </div>
  );
}
