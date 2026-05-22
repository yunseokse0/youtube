"use client";

import { resolveSigRollingStampUrl } from "@/lib/constants";

/** 미디어 영역 위 반투명 회색(알파) — 카드 전체 흰색 덮개 대신 시그 이미지 위만 */
export const SIG_SOLD_MEDIA_DIM_CLASS = "pointer-events-none absolute inset-0 z-[5] bg-neutral-800/48";

export const SIG_SOLD_STAMP_IMG_CLASS =
  "relative z-[1] h-auto w-auto max-h-[min(7.6rem,64%)] max-w-[min(7.6rem,64%)] object-contain object-center bg-transparent opacity-95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]";

type SigSoldStampOverlayProps = {
  soldOutStampUrl: string;
  /** SigBoardRolling 등 더 작은 칸 */
  stampMaxClass?: string;
};

/**
 * 판매 완료 연출: 시그 이미지 → 회색 반투명 딤 → 스탬프(PNG/SVG 알파 유지).
 * `bg-white` 전체 덮개는 사용하지 않음.
 */
export default function SigSoldStampOverlay({
  soldOutStampUrl,
  stampMaxClass = SIG_SOLD_STAMP_IMG_CLASS,
}: SigSoldStampOverlayProps) {
  const stampSrc = resolveSigRollingStampUrl(soldOutStampUrl);
  return (
    <>
      <div className={SIG_SOLD_MEDIA_DIM_CLASS} aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[min(12%,1rem)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- 스탬프 알파 채널 유지(Next/Image 흰 배경 이슈 방지) */}
        <img src={stampSrc} alt="판매 완료" className={stampMaxClass} />
      </div>
    </>
  );
}
