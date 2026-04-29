"use client";

import { useState } from "react";
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
};

const EMPTY_SOLD_SET = new Set<string>();

export default function ResultOverlay({
  visible,
  selectedSigs,
  soldOutStampUrl,
  oneShot,
  signImageUrl,
  showOneShotReveal,
}: ResultOverlayProps) {
  const [imageLoaded, setImageLoaded] = useState(false);

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
    <div className="mt-4 space-y-4">
      <SelectedSigs
        items={selectedSigs}
        soldOutStampUrl={soldOutStampUrl}
        manualSoldSet={EMPTY_SOLD_SET}
        onToggleSold={() => {}}
        showToggle={false}
        compact
        trailingSlot={
          oneShot && showOneShotReveal ? (
            <div className="relative">
              <OneShotSigCard
                name={oneShot.name}
                price={oneShot.price}
                imageUrl={signImageUrl}
                sold={false}
                onToggleSold={() => {}}
                showToggle={false}
                compact
              />
              {!imageLoaded ? (
                <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/35 text-xs font-semibold text-yellow-100">
                  이미지 로딩 중...
                </div>
              ) : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}

