"use client";

import type { CSSProperties } from "react";
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
    <WaveCharSegments blockId={block.id} segments={block.segments} />
  ) : (
    block.segments.map((seg, i) => (
      <ColoredSegment key={`${block.id}-${i}-${seg.text}`} seg={seg} effect={effect} />
    ))
  );

  if (effect === "none") {
    return <p style={lineStyle}>{content}</p>;
  }

  return (
    <p style={lineStyle}>
      <span
        className={`${fxClass}${useWave ? " obs-text-fx-wave" : ""}`.trim()}
        style={fxWrapStyle}
      >
        {content}
      </span>
    </p>
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
}: {
  blockId: string;
  segments: ObsTextSegment[];
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
          key={`${blockId}-w-${i}-${ch}`}
          className="obs-text-fx-wave-char"
          style={{
            color: colorAt[i] ?? segments[0]?.color ?? "#fff",
            animationDelay: `${(i * 0.07) % 1.2}s`,
          }}
        >
          {ch === " " ? "\u00a0" : ch}
        </span>
      ))}
    </>
  );
}
