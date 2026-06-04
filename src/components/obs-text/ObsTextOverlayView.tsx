"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ObsTextEffectStyles } from "@/components/obs-text/ObsTextEffectStyles";
import {
  buildTextOutlineShadow,
  positionToFlexStyle,
  type ObsTextBlock,
  type ObsTextOverlayConfig,
  type ObsTextSegment,
} from "@/lib/obs-text-overlay";
import {
  obsTextEffectClass,
  obsTextEffectDurationSec,
  obsTextEffectUsesCharSpans,
  obsTextEffectWaveCharDelaySec,
  type ObsTextEffectId,
} from "@/lib/obs-text-effects";

export function ObsTextOverlayView({
  config,
  preview = false,
}: {
  config: ObsTextOverlayConfig;
  preview?: boolean;
}) {
  const flex = positionToFlexStyle(
    config.position,
    config.paddingPx,
    config.offsetX,
    config.offsetY
  );
  const outlineShadow = buildTextOutlineShadow(
    config.outlineEnabled,
    config.outlineColor,
    config.outlineWidthPx
  );
  const scale = config.scalePct / 100;

  const rootStyle: CSSProperties = {
    position: preview ? "relative" : "fixed",
    inset: preview ? undefined : 0,
    minHeight: preview ? 280 : "100vh",
    minWidth: preview ? "100%" : "100vw",
    display: "flex",
    justifyContent: flex.justifyContent,
    alignItems: flex.alignItems,
    padding: flex.padding,
    pointerEvents: "none",
    background: "transparent",
    fontFamily: config.fontFamily,
    fontWeight: config.fontWeight,
    boxSizing: "border-box",
  };

  const stackStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: config.lineGapPx,
    transform: `${flex.transform} scale(${scale})`,
    transformOrigin:
      config.position.includes("bottom")
        ? config.position.includes("center")
          ? "bottom center"
          : config.position.includes("right")
            ? "bottom right"
            : "bottom left"
        : config.position.includes("top")
          ? config.position.includes("center")
            ? "top center"
            : config.position.includes("right")
              ? "top right"
              : "top left"
          : "center center",
    maxWidth: "min(96vw, 1400px)",
  };

  const visibleBlocks = config.blocks.filter((b) => b.visible !== false);

  return (
    <div className="obs-text-overlay-root" style={rootStyle} aria-hidden={!preview}>
      <ObsTextEffectStyles />
      <div style={stackStyle}>
        {visibleBlocks.map((block) => (
          <ObsTextBlockLine
            key={block.id}
            block={block}
            config={config}
            outlineShadow={outlineShadow}
          />
        ))}
      </div>
    </div>
  );
}

function ObsTextBlockLine({
  block,
  config,
  outlineShadow,
}: {
  block: ObsTextBlock;
  config: ObsTextOverlayConfig;
  outlineShadow?: string;
}) {
  const fontSize = block.fontSizePx ?? config.defaultFontSizePx;
  const align = block.align ?? "center";
  const effect = block.effect ?? "none";
  const effectSpeed = block.effectSpeed ?? 1;
  const fxClass = obsTextEffectClass(effect);
  const useWave = obsTextEffectUsesCharSpans(effect);

  const lineStyle: CSSProperties = {
    fontSize,
    lineHeight: 1.15,
    textAlign: align,
    whiteSpace: "pre-wrap",
    wordBreak: "keep-all",
    textShadow: effect === "neon" || effect === "gradient" ? undefined : outlineShadow,
    margin: 0,
  };

  const fxWrapStyle: CSSProperties | undefined =
    effect !== "none"
      ? ({
          ["--obs-tx-dur" as string]: obsTextEffectDurationSec(effect, effectSpeed),
        } as CSSProperties)
      : undefined;

  const content = useWave ? (
    <WaveCharSegments
      blockId={block.id}
      segments={block.segments}
      effectSpeed={effectSpeed}
    />
  ) : (
    block.segments.map((seg, i) => (
      <ColoredSegment key={`${block.id}-seg-${i}`} seg={seg} effect={effect} />
    ))
  );

  if (effect === "none") {
    return <p style={lineStyle}>{content}</p>;
  }

  return (
    <p style={lineStyle}>
      <ObsTextFxWrap
        effect={effect}
        className={`${fxClass}${useWave ? " obs-text-fx-wave" : ""}`.trim()}
        style={fxWrapStyle}
      >
        {content}
      </ObsTextFxWrap>
    </p>
  );
}

/** 효과 변경 시 짧은 페이드로 끊김 완화 */
function ObsTextFxWrap({
  effect,
  className,
  style,
  children,
}: {
  effect: ObsTextEffectId;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [opacity, setOpacity] = useState(1);
  const prevEffect = useRef(effect);

  useEffect(() => {
    if (prevEffect.current === effect) return;
    prevEffect.current = effect;
    setOpacity(0);
    const tid = window.setTimeout(() => setOpacity(1), 80);
    return () => window.clearTimeout(tid);
  }, [effect]);

  return (
    <span
      className={className}
      style={{
        ...style,
        opacity,
        transition: "opacity 0.45s ease-in-out",
      }}
    >
      {children}
    </span>
  );
}

function ColoredSegment({
  seg,
  effect,
}: {
  seg: ObsTextSegment;
  effect: ObsTextBlock["effect"];
}) {
  if (effect === "gradient" || effect === "rainbow") {
    return <span>{seg.text}</span>;
  }
  return <span style={{ color: seg.color }}>{seg.text}</span>;
}

function WaveCharSegments({
  blockId,
  segments,
  effectSpeed,
}: {
  blockId: string;
  segments: ObsTextSegment[];
  effectSpeed: number;
}) {
  const plain = segments.map((s) => s.text).join("");
  const chars = Array.from(plain);
  const colorAt: string[] = [];
  for (const seg of segments) {
    for (let i = 0; i < Array.from(seg.text).length; i++) {
      colorAt.push(seg.color);
    }
  }

  return (
    <>
      {chars.map((ch, i) => (
        <span
          key={`${blockId}-w-${i}`}
          className="obs-text-fx-wave-char"
          style={{
            color: colorAt[i] ?? segments[0]?.color ?? "#fff",
            animationDelay: obsTextEffectWaveCharDelaySec(i, effectSpeed),
          }}
        >
          {ch === " " ? "\u00a0" : ch}
        </span>
      ))}
    </>
  );
}
