"use client";

import { useEffect, useState } from "react";
import type { SigItem } from "@/types";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import { useImagePreload } from "@/hooks/useImagePreload";
import { canonicalSigIdFromWheelSliceId, ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import { sigOverlayBroadcastCardShellStyle } from "@/components/sig-sales/sig-overlay-card-size";

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
  /** true면 한방 영역 「이미지 로딩 중…」 게이트 없음(로컬 미리보기 등) */
  skipHanbangSignLoadingOverlay?: boolean;
  /** true면 개별 당첨 카드 줄을 숨기고 한방 시그 카드만 표시(?hanbangOnly=1) */
  hanbangOnly?: boolean;
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
  skipHanbangSignLoadingOverlay = false,
  hanbangOnly = false,
}: ResultOverlayProps) {
  const [imageLoaded, setImageLoaded] = useState(() => skipHanbangSignLoadingOverlay);
  useEffect(() => {
    if (skipHanbangSignLoadingOverlay) {
      setImageLoaded(true);
      return;
    }
    setImageLoaded(false);
  }, [signImageUrl, skipHanbangSignLoadingOverlay]);

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

  const oneShotSold = (() => {
    if (!soldOverrideSet) return false;
    if (
      soldOverrideSet.has(ONE_SHOT_SIG_ID) ||
      soldOverrideSet.has(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID))
    ) {
      return true;
    }
    if (selectedSigs.length === 0) return false;
    return selectedSigs.every((item) => {
      const canon = canonicalSigIdFromWheelSliceId(item.id);
      return soldOverrideSet.has(item.id) || soldOverrideSet.has(canon);
    });
  })();

  const oneShotTrailing =
    oneShot && showOneShotReveal ? (
      <div className="relative shrink-0" style={sigOverlayBroadcastCardShellStyle()}>
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
        {!skipHanbangSignLoadingOverlay && !imageLoaded ? (
          <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl bg-black/40 text-[10px] font-semibold text-neutral-100">
            이미지 로딩 중...
          </div>
        ) : null}
      </div>
    ) : undefined;

  if (hanbangOnly) {
    return (
      <div className={`flex w-full flex-col items-center justify-center ${className}`.trim()}>
        {oneShotTrailing ?? null}
      </div>
    );
  }

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
