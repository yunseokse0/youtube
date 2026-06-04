"use client";

import { useMemo } from "react";
import { getOverlayBroadcastConfigWarnings } from "@/lib/overlay-params";

/** OBS에 잘못된 URL·미리보기 모드일 때 상단 경고(투명 배경 위에 보이도록) */
export default function OverlayBroadcastConfigBanner() {
  const warnings = useMemo(() => getOverlayBroadcastConfigWarnings(), []);
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
