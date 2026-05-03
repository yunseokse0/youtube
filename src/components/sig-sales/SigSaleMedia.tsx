"use client";

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import { isLikelyGifUrl } from "@/lib/sigGif";
import SigSlowGif from "./SigSlowGif";

const FALLBACK_SRC = "/images/sigs/dummy-sig.svg";

type SigSaleMediaProps = {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  className?: string;
  unoptimized?: boolean;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  onReady?: () => void;
  gifDelayMultiplier?: number;
};

/** GIF는 브라우저 기본 재생보다 느린 캔버스 재생, 그 외는 next/image. 로컬 PNG 404 시 상태로 더미로 전환(직접 img.src 조작은 next/image에서 불안정). */
export default function SigSaleMedia({
  src,
  alt,
  fill,
  sizes,
  className,
  unoptimized,
  onError,
  onReady,
  gifDelayMultiplier = 3.5,
}: SigSaleMediaProps) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [gifFail, setGifFail] = useState(false);

  useEffect(() => {
    setDisplaySrc(src);
    setGifFail(false);
  }, [src]);

  const handleImageError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      if (displaySrc !== FALLBACK_SRC) {
        setDisplaySrc(FALLBACK_SRC);
        return;
      }
      onError?.(e);
    },
    [displaySrc, onError]
  );

  const handleGifError = useCallback(() => {
    setGifFail(true);
  }, []);

  if (isLikelyGifUrl(displaySrc) && !gifFail) {
    return (
      <SigSlowGif
        src={displaySrc}
        alt={alt}
        className={className}
        delayMultiplier={gifDelayMultiplier}
        onLoadError={handleGifError}
        onReady={onReady}
      />
    );
  }

  return (
    <Image
      key={displaySrc}
      src={displaySrc}
      alt={alt}
      fill={fill}
      sizes={sizes}
      unoptimized={unoptimized ?? true}
      className={className}
      onError={handleImageError}
      onLoad={onReady}
    />
  );
}
