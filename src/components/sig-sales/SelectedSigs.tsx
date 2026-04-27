"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import type { SigItem } from "@/types";
import { formatWon } from "@/lib/sig-roulette";
import { resolveSigImageUrl } from "@/lib/constants";

type SelectedSigsProps = {
  items: SigItem[];
  soldOutStampUrl: string;
  manualSoldSet: Set<string>;
  onToggleSold: (id: string) => void;
  disabled?: boolean;
  trailingSlot?: ReactNode;
  highlightId?: string | null;
  showToggle?: boolean;
  soldOverrideSet?: Set<string>;
  compact?: boolean;
};

export default function SelectedSigs({
  items,
  soldOutStampUrl,
  manualSoldSet,
  onToggleSold,
  disabled = false,
  trailingSlot,
  highlightId = null,
  showToggle = true,
  soldOverrideSet,
  compact = false,
}: SelectedSigsProps) {
  const fallbackImage = "/images/sigs/dummy-sig.svg";
  return (
    <section className={`grid grid-cols-2 gap-2 ${trailingSlot ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
      {items.map((item, idx) => {
        const sold = soldOverrideSet ? soldOverrideSet.has(item.id) : manualSoldSet.has(item.id);
        const isLatestConfirmed = highlightId === item.id;
        return (
          <motion.article
            key={item.id}
            initial={{ opacity: 0, y: 28, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: idx * 0.08, duration: 0.35 }}
            className={`relative overflow-hidden rounded-xl border bg-neutral-900/70 ${isLatestConfirmed ? "border-yellow-300 shadow-[0_0_24px_rgba(250,204,21,0.45)]" : "border-white/20"}`}
          >
            <div className="absolute left-2 top-2 z-20 rounded bg-emerald-600/90 px-2 py-0.5 text-[10px] font-black text-white">
              확정
            </div>
            {isLatestConfirmed ? (
              <motion.div
                className="pointer-events-none absolute inset-0 z-10 border-2 border-yellow-300/85"
                initial={{ opacity: 0.1 }}
                animate={{ opacity: [0.15, 0.9, 0.2] }}
                transition={{ duration: 0.9, repeat: 1 }}
              />
            ) : null}
            <div className={`relative ${compact ? "aspect-[4/3]" : "aspect-[4/5]"}`}>
              <img
                src={resolveSigImageUrl(item.name, item.imageUrl)}
                alt={item.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = fallbackImage;
                }}
              />
              {sold ? (
                <>
                  <div className="absolute inset-0 bg-black/45" />
                  <img src={soldOutStampUrl} alt="판매 완료" className="absolute left-1/2 top-1/2 h-28 w-28 -translate-x-1/2 -translate-y-1/2 object-contain" />
                </>
              ) : null}
            </div>
            <div className={`${compact ? "space-y-0.5 p-1.5" : "space-y-1 p-2"}`}>
              <div className={`truncate font-bold text-white ${compact ? "text-[11px]" : "text-sm"}`}>{item.name}</div>
              <div className={`${compact ? "text-[10px]" : "text-xs"} text-amber-200`}>{formatWon(item.price)}</div>
              {showToggle ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleSold(item.id)}
                  className={`w-full rounded px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${sold ? "bg-rose-700/85 text-white" : "bg-emerald-700/85 text-white"}`}
                >
                  {sold ? "판매 취소" : "판매 완료"}
                </button>
              ) : null}
            </div>
          </motion.article>
        );
      })}
      {trailingSlot ? <div className={compact ? "min-h-[140px]" : "min-h-[280px]"}>{trailingSlot}</div> : null}
    </section>
  );
}
