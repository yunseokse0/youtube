"use client";

import { useEffect, useRef } from "react";
import { getSigImagePlaceholderOnlyForOverlay, normalizeSigImageUrlStored } from "@/lib/constants";

export function useImagePreload(
  url?: string | null,
  onLoad?: (url: string) => void,
  onError?: (url: string) => void
) {
  const loadedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const raw = String(url || "").trim();
    if (!raw) return;
    const src = getSigImagePlaceholderOnlyForOverlay()
      ? "/images/sigs/dummy-sig.svg"
      : normalizeSigImageUrlStored(raw) || raw;
    if (!src) return;
    if (loadedRef.current[src]) return;

    const img = new Image();
    img.onload = () => {
      loadedRef.current[src] = true;
      onLoad?.(src);
    };
    img.onerror = () => {
      onError?.(src);
    };
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url, onLoad, onError]);
}

