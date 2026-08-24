"use client";

import type { CSSProperties } from "react";
import {
  buildLedMatrixGhostText,
  buildLedMatrixTimerText,
  LED_MATRIX_COLORS,
  LED_SEGMENT_FONT_FAMILY,
} from "@/lib/timer-design";
import { applyTimerBackgroundOpacity, isTimerBackgroundHidden } from "@/lib/overlay-params";

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
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`;
}

function activeGlowStyle(digitColor: string): CSSProperties {
  const rgb = hexToRgb(digitColor);
  if (!rgb) {
    return {
      color: digitColor,
      textShadow: `0 0 4px ${digitColor}, 0 0 10px ${digitColor}, 0 0 20px rgba(255,255,255,0.35)`,
    };
  }
  return {
    color: digitColor,
    textShadow: [
      `0 0 4px rgba(${rgb.r},${rgb.g},${rgb.b},0.95)`,
      `0 0 10px rgba(${rgb.r},${rgb.g},${rgb.b},0.75)`,
      `0 0 20px rgba(${rgb.r},${rgb.g},${rgb.b},0.45)`,
      `0 0 32px rgba(255,255,255,0.18)`,
    ].join(", "),
  };
}

/**
 * LED 7-segment 타이머 — 검은 패널 · 흰 발광 숫자 · 고스트 88:88 · 레드 테두리·코너.
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
  const text = buildLedMatrixTimerText(seconds, showHours);
  if (!text) return null;

  const ghostText = buildLedMatrixGhostText(showHours || text.length > 5);
  const digitSize = Math.max(22, Math.round(fontSize));
  const padX = Math.max(16, Math.round(digitSize * 0.42));
  const padY = Math.max(12, Math.round(digitSize * 0.24));
  const cornerSize = Math.max(4, Math.round(digitSize * 0.09));
  const customColor = (fontColor || "").trim();
  const useTokenGlow = !customColor;
  const digitColor = customColor || LED_MATRIX_COLORS.digit;
  const ghostColor = customColor ? ghostColorFromDigit(digitColor) : LED_MATRIX_COLORS.ghost;
  const frameColor = (borderColor || "").trim() || LED_MATRIX_COLORS.border;
  const cornerColor = frameColor;
  const opacity = Math.max(0, Math.min(100, bgOpacity ?? 100));
  const noBackground = isTimerBackgroundHidden(bgColor, opacity);
  const panelBg = noBackground
    ? LED_MATRIX_COLORS.panel
    : applyTimerBackgroundOpacity((bgColor || "").trim() || LED_MATRIX_COLORS.panel, opacity);

  const digitStyle: CSSProperties = {
    fontFamily: LED_SEGMENT_FONT_FAMILY,
    fontSize: digitSize,
    lineHeight: 1,
    letterSpacing: "0.06em",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 400,
  };

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{
        backgroundColor: panelBg,
        border: `2px solid ${frameColor}`,
        boxShadow: `inset 0 0 24px rgba(0,0,0,0.65), 0 0 12px rgba(239,68,68,0.12)`,
        padding: `${padY}px ${padX}px`,
      }}
      data-timer-design="led-matrix"
      suppressHydrationWarning
    >
      <span
        className="pointer-events-none absolute left-0 top-0"
        style={{
          width: cornerSize,
          height: cornerSize,
          backgroundColor: cornerColor,
          boxShadow: `0 0 6px ${cornerColor}`,
        }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute right-0 top-0"
        style={{
          width: cornerSize,
          height: cornerSize,
          backgroundColor: cornerColor,
          boxShadow: `0 0 6px ${cornerColor}`,
        }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute bottom-0 left-0"
        style={{
          width: cornerSize,
          height: cornerSize,
          backgroundColor: cornerColor,
          boxShadow: `0 0 6px ${cornerColor}`,
        }}
        aria-hidden
      />
      <span
        className="pointer-events-none absolute bottom-0 right-0"
        style={{
          width: cornerSize,
          height: cornerSize,
          backgroundColor: cornerColor,
          boxShadow: `0 0 6px ${cornerColor}`,
        }}
        aria-hidden
      />

      <div className="relative inline-grid leading-none" style={digitStyle}>
        <span className="invisible col-start-1 row-start-1 select-none" aria-hidden>
          {ghostText}
        </span>
        <span
          className="col-start-1 row-start-1 select-none"
          style={{ color: ghostColor }}
          aria-hidden
        >
          {ghostText}
        </span>
        <span
          className={`col-start-1 row-start-1 select-none ${useTokenGlow ? "led-segment-glow" : ""}`}
          style={useTokenGlow ? undefined : activeGlowStyle(digitColor)}
        >
          {text}
        </span>
      </div>
    </div>
  );
}
