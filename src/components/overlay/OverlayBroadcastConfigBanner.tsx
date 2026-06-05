"use client";

import { useMemo } from "react";
import {
  getOverlayBroadcastConfigWarnings,
  isEmbeddedInSameOriginAdminFrame,
} from "@/lib/overlay-params";

/** 관리자 iframe 미리보기에서만 경고 — OBS·Prism 브라우저 소스에는 절대 표시하지 않음 */
export default function OverlayBroadcastConfigBanner() {
  const warnings = useMemo(() => {
    if (typeof window === "undefined") return [];
    if (!isEmbeddedInSameOriginAdminFrame()) return [];
    return getOverlayBroadcastConfigWarnings();
  }, []);
  if (warnings.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed left-2 right-2 top-2 z-[9999] space-y-1"
      role="status"
    >
      {warnings.map((msg) => (
        <p
          key={msg}
          className="rounded-lg border border-amber-400/70 bg-amber-950/92 px-3 py-2 text-[11px] font-semibold leading-snug text-amber-50 shadow-lg"
        >
          {msg}
        </p>
      ))}
    </div>
  );
}
