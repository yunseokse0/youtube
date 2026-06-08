"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { listSigOverlayImageFallbackUrls, toSigOverlayAbsoluteAssetUrl } from "@/lib/constants";
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
  /** 1차 404 시 저장 경로를 `/uploads/sigs/<user>/…` 로 재시도 */
  sigImageUserId?: string;
  storedImageUrl?: string;
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
  sigImageUserId,
  storedImageUrl,
}: SigSaleMediaProps) {
  const [displaySrc, setDisplaySrc] = useState(src);
  const [gifFail, setGifFail] = useState(false);
  const retryStageRef = useRef(0);
  const fallbackUrlsRef = useRef<string[]>([]);
  const readyFiredRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const fallbacks = sigImageUserId
      ? listSigOverlayImageFallbackUrls(alt, storedImageUrl || src, sigImageUserId).map((u) =>
          typeof window !== "undefined" ? toSigOverlayAbsoluteAssetUrl(u) : u
        )
      : [];
    fallbackUrlsRef.current = fallbacks.length > 0 ? fallbacks : [src];
    const next = fallbackUrlsRef.current[0] || src;
    setDisplaySrc((prev) => {
      const prevNorm =
        typeof window !== "undefined" ? toSigOverlayAbsoluteAssetUrl(prev) : prev;
      if (prev === next || prevNorm === next) return prev;
      return next;
    });
    setGifFail(false);
    retryStageRef.current = 0;
    readyFiredRef.current = false;
  }, [src, alt, sigImageUserId, storedImageUrl]);

  const notifyReady = useCallback(() => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, []);

  const handleImageError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      const fallbacks = fallbackUrlsRef.current;
      let idx = retryStageRef.current + 1;
      while (idx < fallbacks.length) {
        const candidate = fallbacks[idx];
        retryStageRef.current = idx;
        if (candidate && candidate !== displaySrc) {
          setDisplaySrc(candidate);
          return;
        }
        idx += 1;
      }
      onError?.(e);
    },
    [displaySrc, onError]
  );

  const handleGifError = useCallback(() => {
    setGifFail(true);
  }, []);

  /** OBS·당첨 오버레이: next/image·캔버스 GIF가 검은 칸으로만 보이는 CEF 대응 — 네이티브 img 우선 */
  const preferNativeImg = Boolean(sigImageUserId);

  if ((preferNativeImg || isLikelyGifUrl(displaySrc)) && !gifFail) {
    if (gifDelayMultiplier <= 1 || preferNativeImg) {
      const fillClass = fill
        ? `${className ?? ""} absolute inset-0 h-full w-full object-contain`.trim()
        : className;
      return (
        // eslint-disable-next-line @next/next/no-img-element -- OBS CEF: next/image GIF가 검게 나오는 경우 방지
        <img
          src={displaySrc}
          alt={alt}
          className={fillClass}
          decoding="async"
          onError={handleImageError}
          onLoad={notifyReady}
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
      src={displaySrc}
      alt={alt}
      fill={fill}
      sizes={sizes}
      priority={Boolean(fill)}
      unoptimized={unoptimized ?? true}
      className={className}
      onError={handleImageError}
      onLoad={notifyReady}
      onLoadingComplete={notifyReady}
    />
  );
}
