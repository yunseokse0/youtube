"use client";

import { useEffect, useRef } from "react";

export function useImagePreload(
  url?: string | null,
  onLoad?: (url: string) => void,
  onError?: (url: string) => void
) {
  const loadedRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const src = String(url || "").trim();
    if (!src) return;
    if (loadedRef.current[src]) return;

    const img = new Image();
    img.onload = () => {
      console.log(`✅ [Preload] Success: ${src}`);
      loadedRef.current[src] = true;
      onLoad?.(src);
    };
    img.onerror = () => {
      console.error(`❌ [Preload] Failed: ${src}`);
      onError?.(src);
    };
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [url, onLoad, onError]);
}

