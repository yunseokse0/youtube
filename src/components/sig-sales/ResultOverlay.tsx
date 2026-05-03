"use client";

import { useEffect, useState } from "react";
import type { SigItem } from "@/types";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import { useImagePreload } from "@/hooks/useImagePreload";
import { canonicalSigIdFromWheelSliceId, ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import { SIG_OVERLAY_CARD_MAX_PX } from "@/components/sig-sales/sig-overlay-card-size";

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
  /** 순차 시그 공개: 새로 붙는 카드만 등장 연출 */
  entranceOnlyLatest?: boolean;
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
  gifDelayMultiplier = 1,
  soldOverrideSet,
  entranceOnlyLatest = false,
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
      /** 원본 URL이 404여도 SigSaleMedia가 더미로 폴백하므로 로딩 오버레이로 결과를 가리지 않음 */
      setImageLoaded(true);
    }
  );

  if (!visible) return null;

  const oneShotSold =
    soldOverrideSet &&
    (soldOverrideSet.has(ONE_SHOT_SIG_ID) ||
      soldOverrideSet.has(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID)));

  const oneShotTrailing =
    oneShot && showOneShotReveal ? (
      <div
        className="relative shrink-0"
        style={{
          width: `min(100%, ${SIG_OVERLAY_CARD_MAX_PX}px)`,
          maxWidth: SIG_OVERLAY_CARD_MAX_PX,
        }}
      >
        <OneShotSigCard
          name={oneShot.name}
          price={oneShot.price}
          imageUrl={signImageUrl}
          sold={Boolean(oneShotSold)}
          soldOutStampUrl={soldOutStampUrl}
          selectedSigCount={selectedSigs.length}
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
    <div className={`flex w-full flex-col items-center space-y-2 ${className}`.trim()}>
      <SelectedSigs
        items={selectedSigs}
        soldOutStampUrl={soldOutStampUrl}
        manualSoldSet={EMPTY_SOLD_SET}
        soldOverrideSet={soldOverrideSet}
        onToggleSold={() => {}}
        showToggle={false}
        compact
        matchOneShotCardSize
        showConfirmedBadge={false}
        trailingSlot={oneShotTrailing}
        compactGridJustify="center"
        className="max-w-full justify-center"
        gifDelayMultiplier={gifDelayMultiplier}
        entranceOnlyLatest={entranceOnlyLatest}
      />
    </div>
  );
}
