"use client";

import type { CSSProperties } from "react";

export function clampBattleRulesFontSize(raw: unknown, fallback = 16): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(10, Math.min(36, Math.round(n)));
}

export default function BattleRulesBox({
  text,
  compact = false,
  fontSizePx,
  className = "",
}: {
  text: string;
  compact?: boolean;
  /** 본문 px. 미지정 시 compact 14 / 일반 16 */
  fontSizePx?: number;
  className?: string;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const bodyPx = clampBattleRulesFontSize(fontSizePx, compact ? 14 : 16);
  const labelPx = Math.max(10, Math.round(bodyPx * 0.72));
  const boxStyle: CSSProperties = {
    fontSize: `${bodyPx}px`,
    lineHeight: 1.35,
    maxWidth: "min(100%, 28rem)",
  };
  return (
    <div
      className={`pointer-events-none absolute z-20 rounded-lg border border-white/15 bg-black/72 px-3 py-2 text-left shadow-lg backdrop-blur-sm ${className}`}
      style={boxStyle}
      data-battle-rules-box="true"
    >
      <div
        className="mb-1 font-bold uppercase tracking-wider text-amber-200/90"
        style={{ fontSize: `${labelPx}px` }}
      >
        규칙
      </div>
      <p className="whitespace-pre-wrap font-semibold text-white/95">{trimmed}</p>
    </div>
  );
}
