"use client";

import {
  VS_GLOW_SPARKS_SPRITE_URL,
  isGlowVsDesign,
  normalizeVsDesign,
  vsDesignSpriteBackgroundPosition,
  type VsDesignId,
} from "@/lib/vs-design";

export function VsCenterBadge({
  design: designRaw,
  compact = false,
}: {
  design?: unknown;
  compact?: boolean;
}) {
  const design = normalizeVsDesign(designRaw);

  if (isGlowVsDesign(design)) {
    const pos = vsDesignSpriteBackgroundPosition(design);
    const w = compact ? 72 : 96;
    const h = compact ? 28 : 36;
    return (
      <span
        className="inline-block shrink-0 bg-no-repeat drop-shadow-[0_2px_8px_rgba(0,0,0,0.55)]"
        style={{
          width: w,
          height: h,
          backgroundImage: `url(${VS_GLOW_SPARKS_SPRITE_URL})`,
          backgroundSize: "300% 100%",
          backgroundPosition: pos || "0% 50%",
        }}
        role="img"
        aria-label="VS"
        data-vs-design={design}
      />
    );
  }

  return (
    <span
      className={`flex items-center justify-center rounded-lg font-black tracking-[0.12em] text-white shadow-md ring-1 ring-white/25 ${
        compact ? "h-8 min-w-[2.25rem] px-1.5 text-sm" : "h-9 min-w-[2.5rem] px-2 text-base sm:text-lg"
      }`}
      style={{
        background:
          "linear-gradient(135deg, rgba(220,38,38,0.95) 0%, rgba(23,23,23,0.96) 48%, rgba(37,99,235,0.95) 100%)",
      }}
      data-vs-design="gradient"
    >
      VS
    </span>
  );
}

export type { VsDesignId };
