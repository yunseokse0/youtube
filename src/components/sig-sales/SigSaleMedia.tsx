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

/**
 * GIF: 배수 `<= 1`이면 브라우저 네이티브 재생(부드러움). `> 1`이면 캔버스로 의도적으로 느리게.
 * 그 외 정적 이미지는 next/image. 로컬 404 시 더미 SVG로 전환.
 */
export default function SigSaleMedia({
  src,
  alt,
  fill,
  sizes,
  className,
  unoptimized,
  onError,
  onReady,
  gifDelayMultiplier = 1,
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
    if (gifDelayMultiplier <= 1) {
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
