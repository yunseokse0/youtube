"use client";

import { useSearchParams } from "next/navigation";
import OverlayToonationRelay from "@/components/OverlayToonationRelay";

/** overlay 페이지 최상단 — 렌더 분기·프리셋 대기와 무관하게 투네 릴레이 항상 ON */
export default function OverlayToonationRelayHost() {
  const sp = useSearchParams();
  const userId = (sp.get("u") || "").trim() || "finalent";
  const linkKey = (sp.get("key") || sp.get("linkKey") || sp.get("toonKey") || "").trim();
  const ownerName = (sp.get("owner") || sp.get("ownerName") || "").trim();

  return (
    <OverlayToonationRelay
      userId={userId}
      linkKey={linkKey || undefined}
      ownerName={ownerName || undefined}
    />
  );
}
