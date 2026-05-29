"use client";

import { useEffect, useState } from "react";
import { DEFAULT_SIG_SOLD_STAMP_URL, resolveSigRollingStampUrl } from "@/lib/constants";

const STAMP_FALLBACK_URL = "/images/sigs/stamp.png";

/** 미디어 영역 위 반투명 회색(알파) — 카드 전체 흰색 덮개 대신 시그 이미지 위만 */
export const SIG_SOLD_MEDIA_DIM_CLASS = "pointer-events-none absolute inset-0 z-[5] bg-neutral-800/48";

/** 시그 GIF·이미지 영역 전체 — 미디어와 동일 크기(inset-0) */
export const SIG_SOLD_WHITE_BACKDROP_CLASS = "pointer-events-none absolute inset-0 z-[8] bg-white/30";

/** @deprecated 스탬프만 감싸던 구 박스 — 전체 배경은 SIG_SOLD_WHITE_BACKDROP_CLASS 사용 */
export const SIG_SOLD_STAMP_BACKDROP_CLASS =
  "flex items-center justify-center shadow-[0_1px_8px_rgba(0,0,0,0.25)]";

export const SIG_SOLD_STAMP_IMG_CLASS =
  "relative z-[1] h-auto w-auto max-h-[min(7.6rem,64%)] max-w-[min(7.6rem,64%)] object-contain object-center bg-transparent opacity-95 drop-shadow-[0_2px_10px_rgba(0,0,0,0.55)]";

type SigSoldStampOverlayProps = {
  soldOutStampUrl: string;
  /** SigBoardRolling 등 더 작은 칸 */
  stampMaxClass?: string;
};

/** 판매 완료 연출: 시그 이미지 → 회색 딤 → 흰색 30%(GIF 전체) → 스탬프 */
export default function SigSoldStampOverlay({
  soldOutStampUrl,
  stampMaxClass = SIG_SOLD_STAMP_IMG_CLASS,
}: SigSoldStampOverlayProps) {
  const primarySrc = resolveSigRollingStampUrl(soldOutStampUrl);
  const [stampSrc, setStampSrc] = useState(primarySrc);
  useEffect(() => {
    setStampSrc(primarySrc);
  }, [primarySrc]);
  return (
    <>
      <div className={SIG_SOLD_MEDIA_DIM_CLASS} aria-hidden />
      <div className={SIG_SOLD_WHITE_BACKDROP_CLASS} aria-hidden />
      <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[min(12%,1rem)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- 스탬프 알파 채널 유지(Next/Image 흰 배경 이슈 방지) */}
        <img
          src={stampSrc}
          alt="판매 완료"
          className={stampMaxClass}
          onError={() => {
            const fallback = resolveSigRollingStampUrl(STAMP_FALLBACK_URL);
            if (stampSrc !== fallback && primarySrc !== DEFAULT_SIG_SOLD_STAMP_URL) {
              setStampSrc(resolveSigRollingStampUrl(DEFAULT_SIG_SOLD_STAMP_URL));
              return;
            }
            if (stampSrc !== fallback) setStampSrc(fallback);
          }}
        />
      </div>
    </>
  );
}
