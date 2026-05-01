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
  gifDelayMultiplier = 2,
}: ResultOverlayProps) {
  const [imageLoaded, setImageLoaded] = useState(false);
  useEffect(() => {
    setImageLoaded(false);
  }, [signImageUrl]);

  useImagePreload(
    signImageUrl,
    (url) => {
      setImageLoaded(true);
      console.log(`[Result] Image fully loaded: ${url}`);
    },
    (url) => {
      setImageLoaded(false);
      console.warn(`[Result] Image load failed, using fallback: ${url}`);
    }
  );

  if (!visible) return null;

  return (
    <div className={`space-y-2 ${className}`.trim()}>
      <SelectedSigs
        items={selectedSigs}
        soldOutStampUrl={soldOutStampUrl}
        manualSoldSet={EMPTY_SOLD_SET}
        onToggleSold={() => {}}
        showToggle={false}
        compact
        showConfirmedBadge={false}
        className="mx-auto w-full max-w-[1120px]"
        gifDelayMultiplier={gifDelayMultiplier}
      />
      {oneShot && showOneShotReveal ? (
        <div className="w-full max-w-[220px]">
          <div className="relative rounded-xl border border-yellow-300/45 bg-black/20 p-1 shadow-[0_0_18px_rgba(250,204,21,0.25)]">
            <OneShotSigCard
              name={oneShot.name}
              price={oneShot.price}
              imageUrl={signImageUrl}
              sold={false}
              onToggleSold={() => {}}
              showToggle={false}
              compact
              gifDelayMultiplier={gifDelayMultiplier}
            />
            {!imageLoaded ? (
              <div className="pointer-events-none absolute inset-1 grid place-items-center rounded-xl bg-black/35 text-xs font-semibold text-yellow-100">
                이미지 로딩 중...
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

