"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import type { ReactNode } from "react";
import type { SigItem } from "@/types";
import { formatWon } from "@/lib/sig-roulette";
import { resolveSigImageUrl } from "@/lib/constants";
import SigSaleMedia from "@/components/sig-sales/SigSaleMedia";

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
  showConfirmedBadge?: boolean;
  className?: string;
  /** GIF 시그 프레임 유지 배수 (오버레이 `sigGifDelay` 등과 동일 의미, 기본 2) */
  gifDelayMultiplier?: number;
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
  showConfirmedBadge = true,
  className = "",
  gifDelayMultiplier = 2,
}: SelectedSigsProps) {
  const fallbackImage = "/images/sigs/dummy-sig.svg";
  const gridClass = compact
    ? trailingSlot
      ? "grid-cols-6"
      : "grid-cols-5"
    : trailingSlot
      ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6"
      : "grid-cols-2 md:grid-cols-3 xl:grid-cols-5";
  return (
    <section className={`grid ${gridClass} gap-1.5 ${className}`.trim()}>
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
            {showConfirmedBadge ? (
              <div className="absolute left-2 top-2 z-20 rounded bg-emerald-600/90 px-2 py-0.5 text-[10px] font-black text-white">
                확정
              </div>
            ) : null}
            {isLatestConfirmed ? (
              <motion.div
                className="pointer-events-none absolute inset-0 z-10 border-2 border-yellow-300/85"
                initial={{ opacity: 0.1 }}
                animate={{ opacity: [0.15, 0.9, 0.2] }}
                transition={{ duration: 0.9, repeat: 1 }}
              />
            ) : null}
            <div className={`relative overflow-hidden ${compact ? "aspect-[3/4]" : "aspect-[4/5]"}`}>
              <SigSaleMedia
                src={resolveSigImageUrl(item.name, item.imageUrl)}
                alt={item.name}
                fill
                sizes={compact ? "140px" : "240px"}
                className="object-cover object-center"
                gifDelayMultiplier={gifDelayMultiplier}
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = fallbackImage;
                }}
              />
              {sold ? (
                <>
                  <div className="absolute inset-0 z-[5] bg-black/45" aria-hidden />
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[min(12%,1rem)]">
                    <Image
                      src={soldOutStampUrl}
                      alt="판매 완료"
                      width={112}
                      height={112}
                      unoptimized
                      className="h-auto w-auto max-h-[min(7rem,55%)] max-w-[min(7rem,55%)] object-contain object-center"
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div className={`${compact ? "space-y-0 p-1" : "space-y-1 p-2"}`}>
              <div className={`truncate font-bold text-white ${compact ? "text-[9px]" : "text-sm"}`}>{item.name}</div>
              <div
                className={`${compact ? "text-[8px]" : "text-xs"} font-semibold tabular-nums text-neutral-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]`}
              >
                {formatWon(item.price)}
              </div>
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
      {trailingSlot ? <div className={compact ? "min-h-[132px]" : "min-h-[280px]"}>{trailingSlot}</div> : null}
    </section>
  );
}
