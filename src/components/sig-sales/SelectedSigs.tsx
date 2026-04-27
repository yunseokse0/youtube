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
};

export default function SelectedSigs({ items, soldOutStampUrl, manualSoldSet, onToggleSold, disabled = false, trailingSlot }: SelectedSigsProps) {
  const fallbackImage = "/images/sigs/dummy-sig.svg";
  return (
    <section className={`grid grid-cols-1 gap-3 ${trailingSlot ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
      {items.map((item, idx) => {
        const sold = manualSoldSet.has(item.id);
        return (
          <motion.article
            key={item.id}
            initial={{ opacity: 0, y: 28, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: idx * 0.08, duration: 0.35 }}
            className="relative overflow-hidden rounded-xl border border-white/20 bg-neutral-900/70"
          >
            <div className="relative aspect-[4/5]">
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
            <div className="space-y-1 p-2">
              <div className="truncate text-sm font-bold text-white">{item.name}</div>
              <div className="text-xs text-amber-200">{formatWon(item.price)}</div>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggleSold(item.id)}
                className={`w-full rounded px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${sold ? "bg-rose-700/85 text-white" : "bg-emerald-700/85 text-white"}`}
              >
                {sold ? "판매 취소" : "판매 완료"}
              </button>
            </div>
          </motion.article>
        );
      })}
      {trailingSlot ? <div className="min-h-[280px]">{trailingSlot}</div> : null}
    </section>
  );
}
