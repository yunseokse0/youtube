"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SigMatchDuelOverlay from "./SigMatchDuelOverlay";
import SigMatchOverlayLoading from "./SigMatchOverlayLoading";
import { SIG_MATCH_OVERLAY_UI_REV } from "@/lib/overlay-ui-revision";

function SigMatchOverlayPageInner() {
  const sp = useSearchParams();
  const revKey = sp.get("overlayUiRev") || sp.get("_build") || SIG_MATCH_OVERLAY_UI_REV;
  return <SigMatchDuelOverlay key={revKey} />;
}

export default function SigMatchOverlayPage() {
  return (
    <Suspense fallback={<SigMatchOverlayLoading />}>
      <SigMatchOverlayPageInner />
    </Suspense>
  );
}
