"use client";

import { motion } from "framer-motion";
import { formatWon } from "@/lib/sig-roulette";
import { resolveSigImageUrl } from "@/lib/constants";

type OneShotSigCardProps = {
  name: string;
  price: number;
  sold: boolean;
  onToggleSold: () => void;
  disabled?: boolean;
  compact?: boolean;
  imageUrl?: string;
  showToggle?: boolean;
};

export default function OneShotSigCard({
  name,
  price,
  sold,
  onToggleSold,
  disabled = false,
  compact = false,
  imageUrl = "",
  showToggle = true,
}: OneShotSigCardProps) {
  const fallbackImage = "/images/sigs/dummy-sig.svg";
  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.85, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className={`relative overflow-hidden border border-yellow-300/70 bg-[linear-gradient(135deg,rgba(245,158,11,0.25),rgba(234,179,8,0.1))] shadow-[0_0_30px_rgba(250,204,21,0.35)] ${compact ? "h-full rounded-xl p-2" : "rounded-2xl p-4"}`}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.35),transparent_65%)]" />
      <div className={`relative mb-2 overflow-hidden rounded-lg border border-yellow-200/25 bg-black/25 ${compact ? "h-24" : "h-40"}`}>
        <img
          src={resolveSigImageUrl(name, imageUrl)}
          alt={name}
          className="h-full w-full object-cover"
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = fallbackImage;
          }}
        />
      </div>
      <div className={`relative ${compact ? "flex h-full flex-col justify-between gap-2" : "flex flex-wrap items-center justify-between gap-3"}`}>
        <div>
          <h3 className={`${compact ? "text-sm" : "text-lg"} font-black text-yellow-100`}>{name}</h3>
          <p className={`${compact ? "text-[11px]" : "text-sm"} text-yellow-200/85`}>선정된 5개 시그 합산 금액</p>
        </div>
        <div className={compact ? "" : "text-right"}>
          <div className={`${compact ? "text-base" : "text-2xl"} font-black text-yellow-200`}>{formatWon(price)}</div>
          {showToggle ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onToggleSold}
              className={`mt-2 w-full rounded px-2 py-1 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50 ${sold ? "bg-rose-700 text-white" : "bg-amber-500 text-black"}`}
            >
              {sold ? "한방 판매 취소" : "한방 판매 완료"}
            </button>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}
