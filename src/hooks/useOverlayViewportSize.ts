"use client";

import { useEffect, useState } from "react";
import type { ViewportSize } from "@/lib/overlay-mobile-fit";

function readViewportSize(): ViewportSize {
  if (typeof window === "undefined") return { w: 1920, h: 1080 };
  const vv = window.visualViewport;
  return {
    w: Math.max(1, Math.round(vv?.width ?? window.innerWidth)),
    h: Math.max(1, Math.round(vv?.height ?? window.innerHeight)),
  };
}

/** OBS·모바일 방송 앱 visualViewport 기준 크기 */
const SSR_VIEWPORT: ViewportSize = { w: 1920, h: 1080 };

export function useOverlayViewportSize(): ViewportSize {
  /** 클라 첫 페인트에서 window를 읽으면 SSR(1920×1080)과 불일치 */
  const [size, setSize] = useState<ViewportSize>(SSR_VIEWPORT);

  useEffect(() => {
    const update = () => setSize(readViewportSize());
    update();
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, []);

  return size;
}
