"use client";

import {
  buildLedMatrixTimerText,
  LED_MATRIX_COLORS,
} from "@/lib/timer-design";
import { applyTimerBackgroundOpacity, isTimerBackgroundHidden } from "@/lib/overlay-params";

/**
 * LED 도트매트릭스 타이머 — 블랙 패널 · 실버 프레임 · 시안 숫자 · 코너 레드 LED.
 * 도트 텍스처는 radial-gradient mask로 표현 (PNG 프레임 없음).
 */
export function LedMatrixTimer({
  remainingSeconds,
  showHours = false,
  fontSize = 48,
  fontColor,
  bgColor,
  bgOpacity = 100,
}: {
  remainingSeconds: number | null | undefined;
  showHours?: boolean;
  fontSize?: number;
  fontColor?: string;
  bgColor?: string;
  bgOpacity?: number;
}) {
  const text = buildLedMatrixTimerText(remainingSeconds, showHours);
  if (!text) return null;

  const digitSize = Math.max(18, Math.round(fontSize));
  const padX = Math.max(14, Math.round(digitSize * 0.45));
  const padY = Math.max(10, Math.round(digitSize * 0.28));
  const corner = Math.max(4, Math.round(digitSize * 0.12));
  const digitColor = (fontColor || "").trim() || LED_MATRIX_COLORS.digit;
  const opacity = Math.max(0, Math.min(100, bgOpacity ?? 100));
  const noBackground = isTimerBackgroundHidden(bgColor, opacity);
  const panelBg = noBackground
    ? LED_MATRIX_COLORS.panel
    : applyTimerBackgroundOpacity((bgColor || "").trim() || LED_MATRIX_COLORS.panel, opacity);

  return (
    <div
      className="relative inline-flex items-center justify-center"
      style={{
        background: panelBg,
        border: `2px solid ${LED_MATRIX_COLORS.border}`,
        borderRadius: 4,
        boxShadow: `0 0 10px rgba(192,192,192,0.35), inset 0 0 18px rgba(0,0,0,0.85)`,
        padding: `${padY}px ${padX}px`,
      }}
      data-timer-design="led-matrix"
      suppressHydrationWarning
    >
      {(["tl", "tr", "bl", "br"] as const).map((pos) => (
        <span
          key={pos}
          aria-hidden
          className="pointer-events-none absolute rounded-full"
          style={{
            width: corner,
            height: corner,
            background: LED_MATRIX_COLORS.corner,
            boxShadow: `0 0 ${corner * 2}px ${LED_MATRIX_COLORS.corner}, 0 0 ${corner * 4}px rgba(255,0,0,0.55)`,
            top: pos.startsWith("t") ? 5 : undefined,
            bottom: pos.startsWith("b") ? 5 : undefined,
            left: pos.endsWith("l") ? 5 : undefined,
            right: pos.endsWith("r") ? 5 : undefined,
          }}
        />
      ))}

      <span
        className="relative font-black tabular-nums tracking-[0.08em]"
        style={{
          fontFamily: '"Share Tech Mono", "DS-Digital", "Courier New", monospace',
          fontSize: digitSize,
          lineHeight: 1,
          color: digitColor,
          textShadow: `
            0 0 2px ${LED_MATRIX_COLORS.digitHot},
            0 0 8px ${digitColor},
            0 0 16px rgba(125, 211, 252, 0.75),
            0 0 28px rgba(56, 189, 248, 0.45)
          `,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {text}
      </span>
    </div>
  );
}
