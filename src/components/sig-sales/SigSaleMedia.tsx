"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BUNDLED_SIG_PLACEHOLDER_URL,
  resolveSigAdminPreviewFallbackSrc,
  toGithubRawSigAssetUrl,
  toSigOverlayAbsoluteAssetUrl,
} from "@/lib/constants";
import { isLikelyGifUrl } from "@/lib/sigGif";
import { repairDiskUploadSigImagePath } from "@/lib/sig-image-mode";
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
  const retriedRepairRef = useRef(false);
  const readyFiredRef = useRef(false);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    const next =
      typeof window !== "undefined" ? toSigOverlayAbsoluteAssetUrl(src) : src;
    setDisplaySrc((prev) => {
      const prevNorm =
        typeof window !== "undefined" ? toSigOverlayAbsoluteAssetUrl(prev) : prev;
      if (prev === next || prevNorm === next) return prev;
      return next;
    });
    setGifFail(false);
    retriedRepairRef.current = false;
    readyFiredRef.current = false;
  }, [src]);

  const notifyReady = useCallback(() => {
    if (readyFiredRef.current) return;
    readyFiredRef.current = true;
    onReadyRef.current?.();
  }, []);

  const handleImageError = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
      if (!retriedRepairRef.current && sigImageUserId) {
        const repaired = repairDiskUploadSigImagePath(
          String(storedImageUrl || src || ""),
          sigImageUserId
        );
        if (repaired && repaired !== displaySrc) {
          retriedRepairRef.current = true;
          setDisplaySrc(
            typeof window !== "undefined"
              ? toSigOverlayAbsoluteAssetUrl(repaired)
              : repaired
          );
          return;
        }
      }
      if (!retriedRepairRef.current) {
        const fromDrive = resolveSigAdminPreviewFallbackSrc(
          storedImageUrl || src,
          alt,
          sigImageUserId
        );
        if (fromDrive) {
          const abs =
            typeof window !== "undefined"
              ? toSigOverlayAbsoluteAssetUrl(fromDrive)
              : fromDrive;
          if (abs && abs !== displaySrc) {
            retriedRepairRef.current = true;
            setDisplaySrc(abs);
            return;
          }
        }
      }
      const dummy =
        toGithubRawSigAssetUrl(BUNDLED_SIG_PLACEHOLDER_URL) || BUNDLED_SIG_PLACEHOLDER_URL;
      const dummyAbs =
        typeof window !== "undefined" ? toSigOverlayAbsoluteAssetUrl(dummy) : dummy;
      if (displaySrc !== dummyAbs) {
        setDisplaySrc(dummyAbs);
        return;
      }
      onError?.(e);
    },
    [displaySrc, onError, sigImageUserId, storedImageUrl, src, alt]
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
