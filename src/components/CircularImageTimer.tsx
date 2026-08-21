"use client";

import {
  buildCircularImageTimerDisplay,
  computeCountdownRingFilledTicks,
  computeSpeedometerFillRatio,
  COUNTDOWN_RING_COLORS,
  COUNTDOWN_RING_TICK_COUNT,
  SPEEDOMETER_COLORS,
  SPEEDOMETER_LAYOUT,
  type TimerDesignId,
} from "@/lib/timer-design";
import { resolveTimerFontFamilyCss } from "@/lib/timer-font-style";

function polar(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

type TimerLabelProps = {
  cx: number;
  cy: number;
  primary: string;
  secondary?: string;
  primaryPx: number;
  secondaryPx: number;
  fontFamilyCss: string;
  primaryColor: string;
  secondaryColor: string;
  letterSpacing?: string;
  shadow: string;
};

/** 게이지와 동일 SVG 좌표계 — CSS transform 중첩(OBS 스케일)과 무관하게 중앙 고정 */
function TimerCenterLabels({
  cx,
  cy,
  primary,
  secondary,
  primaryPx,
  secondaryPx,
  fontFamilyCss,
  primaryColor,
  secondaryColor,
  letterSpacing = "-0.02em",
  shadow,
}: TimerLabelProps) {
  const secondaryGap = secondary ? primaryPx * 0.22 + secondaryPx * 0.55 : 0;
  const primaryY = secondary ? cy - secondaryGap * 0.35 : cy;
  const secondaryY = cy + secondaryGap * 0.75;

  return (
    <g style={{ pointerEvents: "none" }}>
      <text
        x={cx}
        y={primaryY}
        textAnchor="middle"
        dominantBaseline="central"
        fill={primaryColor}
        fontFamily={fontFamilyCss}
        fontSize={primaryPx}
        fontWeight={700}
        letterSpacing={letterSpacing}
        style={{ fontVariantNumeric: "tabular-nums", textShadow: shadow }}
      >
        {primary}
      </text>
      {secondary ? (
        <text
          x={cx}
          y={secondaryY}
          textAnchor="middle"
          dominantBaseline="central"
          fill={secondaryColor}
          fontFamily={fontFamilyCss}
          fontSize={secondaryPx}
          fontWeight={600}
          letterSpacing="0.08em"
          style={{ textTransform: "lowercase", textShadow: "0 1px 1px rgba(255,255,255,0.25)" }}
        >
          {secondary}
        </text>
      ) : null}
    </g>
  );
}

function CountdownRingSvg({
  size,
  filledTicks,
  label,
}: {
  size: number;
  filledTicks: number;
  label: TimerLabelProps;
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
      className="block"
      role="img"
      aria-label={label.primary}
    >
      {ticks}
      <TimerCenterLabels {...label} cx={cx} cy={cy} />
    </svg>
  );
}

function SpeedometerSvg({
  size,
  fillRatio,
  label,
}: {
  size: number;
  fillRatio: number;
  label: TimerLabelProps;
}) {
  const cx = size / 2;
  const cy = size * SPEEDOMETER_LAYOUT.centerYRatio;
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
      className="block"
      role="img"
      aria-label={label.primary}
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
      <TimerCenterLabels
        {...label}
        cx={cx}
        cy={cy}
        letterSpacing="0.04em"
        shadow="0 1px 3px rgba(0,0,0,0.65)"
      />
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
  const primaryPx = Math.max(14, Math.round(fontSize * display.primaryScale));
  const secondaryPx = Math.max(8, Math.round(fontSize * display.secondaryScale));

  const label: TimerLabelProps = {
    cx: size / 2,
    cy: size / 2,
    primary: display.primary,
    secondary: display.secondary,
    primaryPx,
    secondaryPx,
    fontFamilyCss,
    primaryColor,
    secondaryColor,
    shadow:
      design === "speedometer"
        ? "0 1px 3px rgba(0,0,0,0.65)"
        : "0 1px 2px rgba(255,255,255,0.35)",
  };

  const filledTicks =
    design === "countdown-ring" ? computeCountdownRingFilledTicks(remainingSeconds) : 0;
  const speedoFill =
    design === "speedometer" ? computeSpeedometerFillRatio(remainingSeconds) : 0;

  return (
    <div
      className="relative inline-flex select-none"
      style={{ width: size, height: size }}
      suppressHydrationWarning
    >
      {design === "countdown-ring" ? (
        <CountdownRingSvg size={size} filledTicks={filledTicks} label={label} />
      ) : (
        <SpeedometerSvg size={size} fillRatio={speedoFill} label={label} />
      )}
    </div>
  );
}
