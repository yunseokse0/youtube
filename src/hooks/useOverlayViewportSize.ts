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
export function useOverlayViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() => readViewportSize());

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
