"use client";

import type { CSSProperties } from "react";
import {
  buildLedMatrixTimerText,
  LED_MATRIX_COLORS,
  ledSevenSegmentIsOn,
} from "@/lib/timer-design";
import {
  applyTimerBackgroundOpacity,
  isTimerBackgroundHidden,
  isTimerBorderVisuallyHidden,
} from "@/lib/overlay-params";

type SegId = "a" | "b" | "c" | "d" | "e" | "f" | "g";

/** 모서리 깎인 7-seg (viewBox 88×144) — 웹폰트 없이 LED 시계 형태 */
const SEGMENT_PATHS: Record<SegId, string> = {
  a: "M24 8 L64 8 L72 16 L64 24 L24 24 L16 16 Z",
  b: "M74 18 L82 26 L82 62 L74 70 L66 62 L66 26 Z",
  c: "M74 78 L82 86 L82 122 L74 130 L66 122 L66 86 Z",
  d: "M24 124 L64 124 L72 132 L64 140 L24 140 L16 132 Z",
  e: "M14 78 L22 86 L22 122 L14 130 L6 122 L6 86 Z",
  f: "M14 18 L22 26 L22 62 L14 70 L6 62 L6 26 Z",
  g: "M24 66 L64 66 L72 74 L64 82 L24 82 L16 74 Z",
};

const SEG_ORDER: SegId[] = ["a", "b", "c", "d", "e", "f", "g"];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/);
  if (!m) return null;
  const h = m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function ghostColorFromDigit(digitColor: string): string {
  const rgb = hexToRgb(digitColor);
  if (!rgb) return LED_MATRIX_COLORS.ghost;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.1)`;
}

function LedDigit({
  digit,
  height,
  onColor,
  offColor,
}: {
  digit: string;
  height: number;
  onColor: string;
  offColor: string;
}) {
  return (
    <svg
      height={height}
      viewBox="0 0 88 144"
      className="block shrink-0"
      aria-hidden
      style={{ width: "auto" }}
    >
      {SEG_ORDER.map((id) => (
        <path
          key={id}
          d={SEGMENT_PATHS[id]}
          fill={ledSevenSegmentIsOn(digit, id) ? onColor : offColor}
        />
      ))}
    </svg>
  );
}

function LedColon({
  height,
  color,
}: {
  height: number;
  color: string;
}) {
  return (
    <svg
      height={height}
      viewBox="0 0 28 144"
      className="block shrink-0"
      aria-hidden
      style={{ width: "auto" }}
    >
      <rect x="9" y="40" width="10" height="10" rx="1.2" fill={color} />
      <rect x="9" y="94" width="10" height="10" rx="1.2" fill={color} />
    </svg>
  );
}

/**
 * LED 7-segment 타이머 — SVG 세그먼트(검은 패널 · 흰 점등 · 옅은 비점등 · 레드 코너).
 * 웹폰트/텍스트 그림자를 쓰지 않아 OBS에서 뒤에 숫자가 겹치지 않는다.
 */
export function LedMatrixTimer({
  remainingSeconds,
  remainingSec,
  showHours = false,
  fontSize = 48,
  fontColor,
  bgColor,
  borderColor,
  bgOpacity = 100,
  className = "",
}: {
  remainingSeconds?: number | null;
  remainingSec?: number | null;
  showHours?: boolean;
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
  borderColor?: string;
  bgOpacity?: number;
  className?: string;
}) {
  const seconds = remainingSeconds ?? remainingSec;
  const text = buildLedMatrixTimerText(seconds ?? 0, showHours);
  if (!text) return null;

  const digitSize = Math.max(28, Math.round(fontSize * 1.35));
  const padX = Math.max(14, Math.round(digitSize * 0.22));
  const padY = Math.max(10, Math.round(digitSize * 0.14));
  const cornerSize = Math.max(4, Math.round(digitSize * 0.08));
  const customColor = (fontColor || "").trim();
  const digitColor = customColor || LED_MATRIX_COLORS.digit;
  const ghostColor = customColor ? ghostColorFromDigit(digitColor) : LED_MATRIX_COLORS.ghost;
  const opacity = Math.max(0, Math.min(100, bgOpacity ?? 100));
  const noBackground = isTimerBackgroundHidden(bgColor, opacity);
  const hideBorder = noBackground || isTimerBorderVisuallyHidden(bgColor, borderColor, opacity);
  const panelBg = noBackground
    ? "transparent"
    : applyTimerBackgroundOpacity((bgColor || "").trim() || LED_MATRIX_COLORS.panel, opacity);
  const frameColor = hideBorder
    ? "transparent"
    : (borderColor || "").trim() || LED_MATRIX_COLORS.border;
  const cornerColor = frameColor;
  const showChrome = !noBackground;

  const cornerStyle = (extra: CSSProperties): CSSProperties => ({
    width: cornerSize,
    height: cornerSize,
    backgroundColor: cornerColor,
    boxShadow: `0 0 6px ${cornerColor}`,
    ...extra,
  });

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{
        backgroundColor: panelBg,
        border: hideBorder ? "none" : `2px solid ${frameColor}`,
        boxShadow: showChrome
          ? `inset 0 0 24px rgba(0,0,0,0.65), 0 0 12px ${frameColor}`
          : "none",
        padding: `${padY}px ${padX}px`,
        isolation: "isolate",
      }}
      data-timer-design="led-matrix"
      data-timer-bg={noBackground ? "off" : "on"}
      suppressHydrationWarning
    >
      {hideBorder ? null : (
        <>
          <span className="pointer-events-none absolute left-0 top-0" style={cornerStyle({})} aria-hidden />
          <span className="pointer-events-none absolute right-0 top-0" style={cornerStyle({})} aria-hidden />
          <span className="pointer-events-none absolute bottom-0 left-0" style={cornerStyle({})} aria-hidden />
          <span className="pointer-events-none absolute bottom-0 right-0" style={cornerStyle({})} aria-hidden />
        </>
      )}

      <div className="relative z-[1] flex items-center gap-[0.08em] leading-none" style={{ fontSize: digitSize }}>
        {text.split("").map((ch, idx) =>
          ch === ":" ? (
            <LedColon key={`colon-${idx}`} height={digitSize} color={digitColor} />
          ) : (
            <LedDigit
              key={`d-${idx}`}
              digit={ch}
              height={digitSize}
              onColor={digitColor}
              offColor={ghostColor}
            />
          )
        )}
      </div>
    </div>
  );
}
