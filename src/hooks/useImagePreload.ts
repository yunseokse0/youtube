"use client";

import { useEffect, useRef } from "react";
import { getSigImagePlaceholderOnlyForOverlay, normalizeSigImageUrlStored } from "@/lib/constants";

export function useImagePreload(
  url?: string | null,
  onLoad?: (url: string) => void,
  onError?: (url: string) => void
) {
  const loadedRef = useRef<Record<string, boolean>>({});
  /** 의존성에 넣으면 매 렌더마다 effect가 재실행되어 img 핸들러가 지워져 onLoad가 영원히 안 올 수 있음 */
  const onLoadRef = useRef(onLoad);
  const onErrorRef = useRef(onError);
  onLoadRef.current = onLoad;
  onErrorRef.current = onError;

  useEffect(() => {
    const raw = String(url || "").trim();
    if (!raw) {
      onErrorRef.current?.("");
      return;
    }
    const src = getSigImagePlaceholderOnlyForOverlay()
      ? "/images/sigs/dummy-sig.svg"
      : normalizeSigImageUrlStored(raw) || raw;
    if (!src) {
      onErrorRef.current?.(raw);
      return;
    }
    if (loadedRef.current[src]) {
      onLoadRef.current?.(src);
      return;
    }

    const img = new Image();
    const fireLoad = () => {
      loadedRef.current[src] = true;
      onLoadRef.current?.(src);
    };
    const fireErr = () => {
      onErrorRef.current?.(src);
    };
    img.onload = fireLoad;
    img.onerror = fireErr;
    img.src = src;
    /** SVG·캐시 히트는 `naturalHeight`가 0인 경우가 많아 여기서만 보면 영원히 로드 안 된 것처럼 남음 */
    if (img.complete) {
      fireLoad();
    }
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url]);
}

