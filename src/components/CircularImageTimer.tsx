"use client";

import {
  buildCircularImageTimerDisplay,
  computeCountdownRingFilledTicks,
  computeSpeedometerFillRatio,
  COUNTDOWN_RING_COLORS,
  COUNTDOWN_RING_TICK_COUNT,
  SPEEDOMETER_COLORS,
  type TimerDesignId,
} from "@/lib/timer-design";
import { resolveTimerFontFamilyCss } from "@/lib/timer-font-style";

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function CountdownRingSvg({
  size,
  filledTicks,
}: {
  size: number;
  filledTicks: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.46;
  const innerR = size * 0.38;
  const tickLen = outerR - innerR;

  const ticks = Array.from({ length: COUNTDOWN_RING_TICK_COUNT }, (_, i) => {
    const deg = (i / COUNTDOWN_RING_TICK_COUNT) * 360;
    const outer = polar(cx, cy, outerR, deg);
    const inner = polar(cx, cy, outerR - tickLen, deg);
    const active = i < filledTicks;
    return (
      <line
        key={i}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke={active ? COUNTDOWN_RING_COLORS.active : COUNTDOWN_RING_COLORS.inactive}
        strokeWidth={Math.max(1.5, size * 0.014)}
        strokeLinecap="round"
      />
    );
  });

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      {ticks}
    </svg>
  );
}

function SpeedometerSvg({
  size,
  fillRatio,
}: {
  size: number;
  fillRatio: number;
}) {
  const cx = size / 2;
  const cy = size * 0.54;
  const r = size * 0.42;
  const startDeg = 135;
  const sweepDeg = 270;
  const endDeg = startDeg + sweepDeg * fillRatio;

  const arcPoint = (deg: number, radius: number) => polar(cx, cy, radius, deg);

  const describeArc = (fromDeg: number, toDeg: number, radius: number) => {
    const start = arcPoint(fromDeg, radius);
    const end = arcPoint(toDeg, radius);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;
  };

  const tickMarks = Array.from({ length: 13 }, (_, i) => {
    const deg = startDeg + (i / 12) * sweepDeg;
    const outer = arcPoint(deg, r);
    const inner = arcPoint(deg, r - size * 0.06);
    return (
      <line
        key={i}
        x1={inner.x}
        y1={inner.y}
        x2={outer.x}
        y2={outer.y}
        stroke={SPEEDOMETER_COLORS.tick}
        strokeWidth={Math.max(1, size * 0.008)}
        strokeLinecap="round"
      />
    );
  });

  const needleDeg = startDeg + sweepDeg * fillRatio;
  const needleTip = arcPoint(needleDeg, r - size * 0.04);
  const needleBaseL = arcPoint(needleDeg - 90, size * 0.04);
  const needleBaseR = arcPoint(needleDeg + 90, size * 0.04);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className="pointer-events-none absolute inset-0"
      aria-hidden
    >
      <path
        d={describeArc(startDeg, startDeg + sweepDeg, r)}
        fill="none"
        stroke={SPEEDOMETER_COLORS.track}
        strokeWidth={size * 0.055}
        strokeLinecap="round"
      />
      {fillRatio > 0.01 ? (
        <path
          d={describeArc(startDeg, endDeg, r)}
          fill="none"
          stroke={SPEEDOMETER_COLORS.fill}
          strokeWidth={size * 0.055}
          strokeLinecap="round"
        />
      ) : null}
      {tickMarks}
      {fillRatio > 0 ? (
        <polygon
          points={`${needleTip.x},${needleTip.y} ${needleBaseL.x},${needleBaseL.y} ${needleBaseR.x},${needleBaseR.y}`}
          fill={SPEEDOMETER_COLORS.needle}
          opacity={0.95}
        />
      ) : null}
      <circle cx={cx} cy={cy} r={size * 0.045} fill={SPEEDOMETER_COLORS.needle} />
    </svg>
  );
}

export function CircularImageTimer({
  remainingSeconds,
  showHours = false,
  design,
  fontSize = 48,
  fontFamily,
  fontColor,
}: {
  remainingSeconds: number | null | undefined;
  showHours?: boolean;
  design: Extract<TimerDesignId, "countdown-ring" | "speedometer">;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
}) {
  if (remainingSeconds == null || !Number.isFinite(remainingSeconds)) return null;

  const display = buildCircularImageTimerDisplay(remainingSeconds, showHours, design);
  if (!display) return null;

  const size = Math.max(120, Math.round(fontSize * 5.2));
  const fontFamilyCss = resolveTimerFontFamilyCss(fontFamily);
  const primaryColor = (fontColor || "").trim() || display.defaultPrimaryColor;
  const secondaryColor = (fontColor || "").trim() || display.defaultSecondaryColor;

  const filledTicks =
    design === "countdown-ring" ? computeCountdownRingFilledTicks(remainingSeconds) : 0;
  const speedoFill =
    design === "speedometer" ? computeSpeedometerFillRatio(remainingSeconds) : 0;

  return (
    <div
      className="relative inline-flex items-center justify-center select-none"
      style={{ width: size, height: size }}
      suppressHydrationWarning
    >
      {design === "countdown-ring" ? (
        <CountdownRingSvg size={size} filledTicks={filledTicks} />
      ) : (
        <SpeedometerSvg size={size} fillRatio={speedoFill} />
      )}
      <div
        className="relative z-[1] flex flex-col items-center justify-center text-center leading-none"
        style={{
          width: design === "speedometer" ? "42%" : "38%",
          minWidth: "3.5ch",
        }}
      >
        <span
          className="font-bold tabular-nums"
          style={{
            fontFamily: fontFamilyCss,
            fontSize: Math.max(14, Math.round(fontSize * display.primaryScale)),
            color: primaryColor,
            letterSpacing: design === "speedometer" ? "0.04em" : "-0.02em",
            textShadow:
              design === "speedometer"
                ? "0 1px 3px rgba(0,0,0,0.65)"
                : "0 1px 2px rgba(255,255,255,0.35)",
          }}
        >
          {display.primary}
        </span>
        {display.secondary ? (
          <span
            className="mt-0.5 font-semibold lowercase"
            style={{
              fontFamily: fontFamilyCss,
              fontSize: Math.max(8, Math.round(fontSize * display.secondaryScale)),
              color: secondaryColor,
              letterSpacing: "0.08em",
              textShadow: "0 1px 1px rgba(255,255,255,0.25)",
            }}
          >
            {display.secondary}
          </span>
        ) : null}
      </div>
    </div>
  );
}
