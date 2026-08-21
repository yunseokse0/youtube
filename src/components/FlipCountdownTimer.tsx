"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  buildFlipCountdownSegments,
  type FlipCountdownSegment,
} from "@/lib/timer-design";
import { applyTimerBackgroundOpacity, isTimerBackgroundHidden } from "@/lib/overlay-params";
import { resolveTimerFontFamilyCss } from "@/lib/timer-font-style";

const FLIP_LABEL_COLOR = "#d4a017";
const FLIP_CARD_BG = "#3a3a3a";
const FLIP_DIGIT_COLOR = "#ececec";
const FLIP_LABEL_SIZE_RATIO = 0.22;
const FLIP_MS = 480;
/** OBS 브라우저 소스 업스케일 시 글자·카드 가장자리 선명도 */
const SHARP_RENDER_SCALE = 2;

function FlipDigit({
  digit,
  digitSize,
  fontFamilyCss,
  digitColor,
  cardBg,
}: {
  digit: string;
  digitSize: number;
  fontFamilyCss: string;
  digitColor: string;
  cardBg: string;
}) {
  const cardW = Math.round(digitSize * 0.82);
  const cardH = Math.round(digitSize * 1.35);
  const halfH = Math.round(cardH / 2);
  const [display, setDisplay] = useState(digit);
  const [flipFrom, setFlipFrom] = useState<string | null>(null);
  const prevRef = useRef(digit);

  useEffect(() => {
    if (digit === prevRef.current) return;
    setFlipFrom(prevRef.current);
    prevRef.current = digit;
    const t = window.setTimeout(() => {
      setDisplay(digit);
      setFlipFrom(null);
    }, FLIP_MS);
    return () => window.clearTimeout(t);
  }, [digit]);

  const digitStyle: CSSProperties = {
    fontFamily: fontFamilyCss,
    fontSize: digitSize,
    lineHeight: 1,
    color: digitColor,
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
    textShadow: "0 1px 0 rgba(255,255,255,0.12), 0 -1px 0 rgba(0,0,0,0.35)",
  };

  return (
    <div
      className="relative overflow-hidden rounded-xl shadow-[0_8px_18px_rgba(0,0,0,0.45)]"
      style={{ width: cardW, height: cardH, background: cardBg, perspective: "640px" }}
    >
      {/* 정지 — 플립 중이 아닐 때 */}
      {!flipFrom ? (
        <>
          <div
            className="absolute inset-x-0 top-0 overflow-hidden"
            style={{ height: halfH, background: cardBg }}
          >
            <div
              className="flex h-full items-end justify-center"
              style={{ ...digitStyle, paddingBottom: 1 }}
            >
              {display}
            </div>
          </div>
          <div
            className="absolute inset-x-0 bottom-0 overflow-hidden"
            style={{ height: halfH, background: cardBg }}
          >
            <div
              className="flex h-full items-start justify-center"
              style={{ ...digitStyle, paddingTop: 1 }}
            >
              {display}
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            className="absolute inset-x-0 bottom-0 overflow-hidden"
            style={{ height: halfH, background: cardBg, zIndex: 1 }}
          >
            <div
              className="flex h-full items-start justify-center"
              style={{ ...digitStyle, paddingTop: 1 }}
            >
              {digit}
            </div>
          </div>
          <div
            className="fct-flip-top absolute inset-x-0 top-0 overflow-hidden"
            style={{
              height: halfH,
              background: cardBg,
              transformOrigin: "center bottom",
              backfaceVisibility: "hidden",
            }}
          >
            <div
              className="flex h-full items-end justify-center"
              style={{ ...digitStyle, paddingBottom: 1 }}
            >
              {flipFrom}
            </div>
          </div>
          <div
            className="fct-flip-bottom absolute inset-x-0 top-0 overflow-hidden"
            style={{
              height: halfH,
              background: cardBg,
              transformOrigin: "center bottom",
              backfaceVisibility: "hidden",
            }}
          >
            <div
              className="flex h-full items-end justify-center"
              style={{ ...digitStyle, paddingBottom: 1 }}
            >
              {digit}
            </div>
          </div>
        </>
      )}

      <div
        className="pointer-events-none absolute left-0 right-0"
        style={{
          top: halfH - 1,
          height: 2,
          background: "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(255,255,255,0.08) 100%)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.06)",
          zIndex: 4,
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0"
        style={{
          height: halfH,
          background: "linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 100%)",
          zIndex: 1,
        }}
      />
    </div>
  );
}

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
  const digits = segment.value.padStart(2, "0").slice(-2).split("");
  const cardW = Math.round(digitSize * 1.55);
  const digitGap = Math.max(2, Math.round(digitSize * 0.06));

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="flex items-end" style={{ gap: digitGap }}>
        {digits.map((d, i) => (
          <FlipDigit
            key={`${segment.label}-${i}`}
            digit={d}
            digitSize={digitSize}
            fontFamilyCss={fontFamilyCss}
            digitColor={digitColor}
            cardBg={cardBg}
          />
        ))}
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
  sharpRender = true,
}: {
  remainingSeconds: number | null | undefined;
  showHours?: boolean;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
  bgColor?: string;
  bgOpacity?: number;
  /** OBS 업스케일 선명도 — 2× 렌더 후 축소 */
  sharpRender?: boolean;
}) {
  const styleId = useId().replace(/:/g, "");
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
  const hiDpi = sharpRender ? SHARP_RENDER_SCALE : 1;
  const renderFontSize = Math.round(fontSize * hiDpi);
  const gap = Math.max(6, Math.round(renderFontSize * 0.22));

  const inner = (
    <div
      className="inline-flex items-end justify-center"
      style={{
        gap,
        WebkitFontSmoothing: "antialiased",
        MozOsxFontSmoothing: "grayscale",
        textRendering: sharpRender ? "geometricPrecision" : "optimizeLegibility",
      }}
      suppressHydrationWarning
    >
      {segments.map((segment) => (
        <FlipCard
          key={segment.label}
          segment={segment}
          digitSize={renderFontSize}
          fontFamilyCss={fontFamilyCss}
          digitColor={digitColor}
          cardBg={cardBg}
        />
      ))}
    </div>
  );

  return (
    <>
      <style>{`
        @keyframes fct-flip-top-${styleId} {
          0% { transform: rotateX(0deg); }
          100% { transform: rotateX(-90deg); }
        }
        @keyframes fct-flip-bottom-${styleId} {
          0% { transform: rotateX(90deg); }
          100% { transform: rotateX(0deg); }
        }
        .fct-flip-top { animation: fct-flip-top-${styleId} ${FLIP_MS}ms ease-in forwards; z-index: 3; }
        .fct-flip-bottom { animation: fct-flip-bottom-${styleId} ${FLIP_MS}ms ease-out forwards; z-index: 2; }
      `}</style>
      {hiDpi > 1 ? (
        <div
          className="inline-block"
          style={{
            transform: `scale(${1 / hiDpi})`,
            transformOrigin: "top left",
          }}
        >
          {inner}
        </div>
      ) : (
        inner
      )}
    </>
  );
}
