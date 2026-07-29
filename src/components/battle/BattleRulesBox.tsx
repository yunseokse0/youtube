"use client";

export default function BattleRulesBox({
  text,
  compact = false,
  className = "",
}: {
  text: string;
  compact?: boolean;
  className?: string;
}) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return (
    <div
      className={`pointer-events-none absolute z-20 max-w-[min(100%,22rem)] rounded-lg border border-white/15 bg-black/72 px-3 py-2 text-left shadow-lg backdrop-blur-sm ${compact ? "text-[10px] leading-snug" : "text-[11px] leading-snug sm:text-xs"} ${className}`}
      data-battle-rules-box="true"
    >
      <div className="mb-1 text-[9px] font-bold uppercase tracking-wider text-amber-200/90">규칙</div>
      <p className="whitespace-pre-wrap font-medium text-white/92">{trimmed}</p>
    </div>
  );
}
