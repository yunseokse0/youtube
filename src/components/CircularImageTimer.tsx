"use client";

import {
  buildCircularImageTimerDisplay,
  resolveTimerFrameAssetUrl,
  type TimerDesignId,
} from "@/lib/timer-design";
import { resolveTimerFontFamilyCss } from "@/lib/timer-font-style";

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
  const frameUrl = resolveTimerFrameAssetUrl(design);
  if (!frameUrl) return null;

  const display = buildCircularImageTimerDisplay(remainingSeconds, showHours, design);
  if (!display) return null;

  const size = Math.max(120, Math.round(fontSize * 5.2));
  const fontFamilyCss = resolveTimerFontFamilyCss(fontFamily);
  const primaryColor = (fontColor || "").trim() || display.defaultPrimaryColor;
  const secondaryColor = (fontColor || "").trim() || display.defaultSecondaryColor;

  return (
    <div
      className="relative inline-flex items-center justify-center select-none"
      style={{ width: size, height: size }}
      suppressHydrationWarning
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={frameUrl}
        alt=""
        className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        loading="eager"
        decoding="async"
      />
      <div
        className="relative z-[1] flex flex-col items-center justify-center text-center leading-none"
        style={{ width: "38%", minWidth: "3.5ch" }}
      >
        <span
          className="font-bold tabular-nums"
          style={{
            fontFamily: fontFamilyCss,
            fontSize: Math.max(14, Math.round(fontSize * display.primaryScale)),
            color: primaryColor,
            letterSpacing: design === "speedometer" ? "0.02em" : "-0.02em",
            textShadow: "0 1px 2px rgba(0,0,0,0.45)",
          }}
        >
          {display.primary}
        </span>
        {display.secondary ? (
          <span
            className="mt-0.5 font-semibold uppercase"
            style={{
              fontFamily: fontFamilyCss,
              fontSize: Math.max(8, Math.round(fontSize * display.secondaryScale)),
              color: secondaryColor,
              letterSpacing: "0.06em",
              textShadow: "0 1px 1px rgba(0,0,0,0.35)",
            }}
          >
            {display.secondary}
          </span>
        ) : null}
      </div>
    </div>
  );
}
