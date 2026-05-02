"use client";

import { useEffect, useState } from "react";
import type { SigItem } from "@/types";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import { useImagePreload } from "@/hooks/useImagePreload";

type ResultOverlayProps = {
  visible: boolean;
  selectedSigs: SigItem[];
  soldOutStampUrl: string;
  oneShot: { name: string; price: number } | null;
  signImageUrl: string;
  showOneShotReveal: boolean;
  className?: string;
  gifDelayMultiplier?: number;
  /** 재고 완판 등: 해당 id면 판매 완료 스탬프(방송 오버레이용) */
  soldOverrideSet?: Set<string>;
};

const EMPTY_SOLD_SET = new Set<string>();

export default function ResultOverlay({
  visible,
  selectedSigs,
  soldOutStampUrl,
  oneShot,
  signImageUrl,
  showOneShotReveal,
  className = "",
  gifDelayMultiplier = 3.5,
  soldOverrideSet,
}: ResultOverlayProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => {
    setImageLoaded(false);
  }, [signImageUrl]);

  useImagePreload(
    signImageUrl,
    () => {
      setImageLoaded(true);
    },
    () => {
      setImageLoaded(false);
    }
  );

  if (!visible) return null;

  const oneShotTrailing =
    oneShot && showOneShotReveal ? (
      <div className="relative w-full max-w-[152px] justify-self-center">
        <OneShotSigCard
          name={oneShot.name}
          price={oneShot.price}
          imageUrl={signImageUrl}
          sold={false}
          onToggleSold={() => {}}
          showToggle={false}
          compact
          gifDelayMultiplier={gifDelayMultiplier}
          onMediaReady={() => setImageLoaded(true)}
        />
        {!imageLoaded ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl bg-black/40 text-[10px] font-semibold text-neutral-100">
            이미지 로딩 중...
          </div>
        ) : null}
      </div>
    ) : undefined;

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <SelectedSigs
        items={selectedSigs}
        soldOutStampUrl={soldOutStampUrl}
        manualSoldSet={EMPTY_SOLD_SET}
        soldOverrideSet={soldOverrideSet}
        onToggleSold={() => {}}
        showToggle={false}
        compact
        showConfirmedBadge={false}
        trailingSlot={oneShotTrailing}
        className="mx-auto w-full max-w-[1120px]"
        gifDelayMultiplier={gifDelayMultiplier}
      />
    </div>
  );
}
