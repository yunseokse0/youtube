"use client";

import { motion } from "framer-motion";
import { formatWon } from "@/lib/sig-roulette";
import { resolveSigImageUrl } from "@/lib/constants";
import SigSaleMedia from "@/components/sig-sales/SigSaleMedia";

type OneShotSigCardProps = {
  name: string;
  price: number;
  sold: boolean;
  onToggleSold: () => void;
  disabled?: boolean;
  compact?: boolean;
  imageUrl?: string;
  showToggle?: boolean;
  gifDelayMultiplier?: number;
  onMediaReady?: () => void;
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
  gifDelayMultiplier = 3.5,
  onMediaReady,
}: OneShotSigCardProps) {
  const fallbackImage = "/images/sigs/dummy-sig.svg";
  return (
    <motion.section
      initial={{ opacity: 0, scale: 0.85, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: 0.45, ease: "easeOut" }}
      className={`relative border border-yellow-300/70 bg-[linear-gradient(135deg,rgba(245,158,11,0.25),rgba(234,179,8,0.1))] shadow-[0_0_30px_rgba(250,204,21,0.35)] ${
        compact
          ? "mx-auto w-full max-w-[148px] self-start overflow-visible rounded-xl p-1 pb-1.5"
          : "overflow-hidden rounded-2xl p-4"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.35),transparent_65%)]" />
      <div
        className={`relative overflow-hidden rounded-lg border border-yellow-200/25 bg-black/25 ${
          compact ? "mb-1 h-[100px] w-full sm:h-[108px]" : "mb-2 h-40"
        }`}
      >
        <SigSaleMedia
          src={resolveSigImageUrl(name, imageUrl)}
          alt={name}
          fill
          sizes={compact ? "110px" : "160px"}
          className="object-cover object-center"
          gifDelayMultiplier={gifDelayMultiplier}
          onReady={onMediaReady}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src = fallbackImage;
          }}
        />
      </div>
      <div className={`relative ${compact ? "flex flex-col gap-0.5" : "flex flex-wrap items-center justify-between gap-3"}`}>
        <div>
          <h3
            className={`font-black ${compact ? "text-[11px] text-neutral-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]" : "text-lg text-yellow-100"}`}
          >
            {name}
          </h3>
          <p
            className={`${compact ? "text-[9px] text-neutral-200/95" : "text-sm text-yellow-200/85"}`}
          >
            선정된 5개 시그 합산 금액
          </p>
        </div>
        <div className={compact ? "" : "text-right"}>
          <div
            className={`${compact ? "text-sm" : "text-2xl"} font-black tabular-nums text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.88)]`}
          >
            {formatWon(price)}
          </div>
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
