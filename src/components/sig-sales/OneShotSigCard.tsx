"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import { formatWon } from "@/lib/sig-roulette";
import { resolveSigImageUrl } from "@/lib/constants";
import SigSaleMedia from "@/components/sig-sales/SigSaleMedia";
import {
  SIG_OVERLAY_CARD_MEDIA_BOX_CLASS,
  SIG_OVERLAY_CARD_MAX_PX,
  sigOverlayBroadcastCardShellStyle,
} from "@/components/sig-sales/sig-overlay-card-size";

type OneShotSigCardProps = {
  name: string;
  price: number;
  sold: boolean;
  onToggleSold: () => void;
  disabled?: boolean;
  compact?: boolean;
  imageUrl?: string;
  showToggle?: boolean;
  /** 판매 완료 시 미디어 위 스탬프(관리·오버레이 공통). 없으면 스탬프 레이어 없음 */
  soldOutStampUrl?: string;
  /** 합산에 쓰인 개별 시그 수(문구 `선정된 N개 시그…`에 사용) */
  selectedSigCount?: number;
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
  soldOutStampUrl,
  selectedSigCount,
  gifDelayMultiplier = 1,
  onMediaReady,
}: OneShotSigCardProps) {
  const sumLine =
    typeof selectedSigCount === "number" && selectedSigCount > 0
      ? `선정된 ${selectedSigCount}개 시그 합산 금액`
      : "선정된 시그 합산 금액";
  return (
    <motion.section
      initial={
        compact
          ? { opacity: 0, scale: 0.97, y: 10 }
          : { opacity: 0, scale: 0.85, y: 24 }
      }
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ duration: compact ? 0.32 : 0.45, ease: "easeOut" }}
      style={compact ? sigOverlayBroadcastCardShellStyle() : undefined}
      className={`relative border border-yellow-300/70 bg-[linear-gradient(135deg,rgba(245,158,11,0.25),rgba(234,179,8,0.1))] shadow-[0_0_30px_rgba(250,204,21,0.35)] ${
        compact
          ? "mx-auto w-full shrink-0 self-start overflow-visible rounded-xl px-1.5 py-2 pb-2"
          : "overflow-hidden rounded-2xl p-4"
      }`}
    >
      {sold ? (
        <div className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit] bg-white/93" aria-hidden />
      ) : null}
      <div className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_top,rgba(250,204,21,0.35),transparent_65%)]" />
      <div
        className="relative z-[2]"
      >
      <div
        className={`relative overflow-hidden rounded-lg border border-yellow-200/40 bg-gradient-to-b from-amber-950/55 via-neutral-950/75 to-black ${
          compact ? SIG_OVERLAY_CARD_MEDIA_BOX_CLASS : "mb-2 h-40"
        }`}
      >
        <SigSaleMedia
          src={resolveSigImageUrl(name, imageUrl)}
          alt={name}
          fill
          sizes={compact ? `${SIG_OVERLAY_CARD_MAX_PX}px` : "160px"}
          className={`relative z-[2] object-cover object-center ${
            compact
              ? sold
                ? "brightness-[1.08] contrast-[1.05] saturate-[1.08]"
                : "brightness-[1.15] contrast-[1.08] saturate-[1.12]"
              : ""
          }`}
          gifDelayMultiplier={gifDelayMultiplier}
          onReady={onMediaReady}
        />
        {sold && soldOutStampUrl ? (
          <>
            <div className="absolute inset-0 z-[5] bg-black/18" aria-hidden />
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[min(12%,1rem)]">
              <Image
                src={soldOutStampUrl}
                alt="판매 완료"
                width={112}
                height={112}
                unoptimized
                className="relative h-auto w-auto max-h-[min(7.8rem,66%)] max-w-[min(7.8rem,66%)] object-contain object-center opacity-95 drop-shadow-[0_2px_6px_rgba(0,0,0,0.42)]"
              />
            </div>
          </>
        ) : null}
      </div>
      <div className={`relative ${compact ? "flex flex-col gap-0.5" : "flex flex-wrap items-center justify-between gap-3"}`}>
        <div>
          <h3
            className={`font-black ${compact ? "text-[12px] text-neutral-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.75)]" : "text-lg text-yellow-100"}`}
          >
            {name}
          </h3>
          <p
            className={`${compact ? "text-[10px] text-neutral-200/95" : "text-sm text-yellow-200/85"}`}
          >
            {sumLine}
          </p>
        </div>
        <div className={compact ? "" : "text-right"}>
          <div
            className={`${compact ? "text-base" : "text-2xl"} font-black tabular-nums text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.88)]`}
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
      </div>
    </motion.section>
  );
}
