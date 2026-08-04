"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { listSigOverlayImageFallbackUrls, toSigOverlayAbsoluteAssetUrl } from "@/lib/constants";
import { isLikelyGifUrl } from "@/lib/sigGif";
import SigSlowGif from "./SigSlowGif";

export type SigSaleMediaObjectFit = "contain" | "cover";

type SigSaleMediaProps = {
  src: string;
  alt: string;
  fill?: boolean;
  sizes?: string;
  className?: string;
  unoptimized?: boolean;
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void;
  onReady?: () => void;
  /** 로드된 naturalWidth/Height — 가로/세로 UI 분기용 */
  onNaturalSize?: (width: number, height: number) => void;
  /**
   * fill 네이티브 img에 적용할 object-fit.
   * 미지정 시 className의 object-cover/contain을 존중하고, 없으면 contain.
   */
  objectFit?: SigSaleMediaObjectFit;
  gifDelayMultiplier?: number;
  /** 1차 404 시 저장 경로를 `/uploads/sigs/<user>/…` 로 재시도 */
  sigImageUserId?: string;
  storedImageUrl?: string;
};

function resolveObjectFit(
  objectFit: SigSaleMediaObjectFit | undefined,
  className: string | undefined
): SigSaleMediaObjectFit {
  if (objectFit === "cover" || objectFit === "contain") return objectFit;
  if (/\bobject-cover\b/.test(className || "")) return "cover";
  return "contain";
}

function buildFillClassName(className: string | undefined, fit: SigSaleMediaObjectFit): string {
  const cleaned = String(className || "")
    .replace(/\bobject-(?:contain|cover|fill|none|scale-down)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${cleaned} absolute inset-0 h-full w-full object-${fit}`.trim();
}

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
  onNaturalSize,
  objectFit,
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
  const onNaturalSizeRef = useRef(onNaturalSize);
  onNaturalSizeRef.current = onNaturalSize;
  const fit = resolveObjectFit(objectFit, className);

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

  const reportNaturalSize = useCallback((img: HTMLImageElement | null) => {
    if (!img) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w > 0 && h > 0) onNaturalSizeRef.current?.(w, h);
  }, []);

  const handleImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      reportNaturalSize(e.currentTarget);
      notifyReady();
    },
    [notifyReady, reportNaturalSize]
  );

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
      const fillClass = fill ? buildFillClassName(className, fit) : className;
      return (
        // eslint-disable-next-line @next/next/no-img-element -- OBS CEF: next/image GIF가 검게 나오는 경우 방지
        <img
          src={displaySrc}
          alt={alt}
          className={fillClass}
          decoding="async"
          onError={handleImageError}
          onLoad={handleImageLoad}
          ref={(el) => {
            if (el?.complete) reportNaturalSize(el);
          }}
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
      className={fill ? buildFillClassName(className, fit) : className}
      onError={handleImageError}
      onLoad={handleImageLoad}
      onLoadingComplete={(img) => {
        reportNaturalSize(img);
        notifyReady();
      }}
    />
  );
}
