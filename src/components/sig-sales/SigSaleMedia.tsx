"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import { isLikelyGifUrl } from "@/lib/sigGif";
import SigSlowGif from "./SigSlowGif";

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

/** GIF는 브라우저 기본 재생보다 느린 캔버스 재생, 그 외는 next/image */
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
  const [gifFail, setGifFail] = useState(false);

  const handleGifError = useCallback(() => {
    setGifFail(true);
  }, []);

  if (isLikelyGifUrl(src) && !gifFail) {
    return (
      <SigSlowGif
        src={src}
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
      src={src}
      alt={alt}
      fill={fill}
      sizes={sizes}
      unoptimized={unoptimized ?? true}
      className={className}
      onError={onError}
      onLoad={onReady}
    />
  );
}
