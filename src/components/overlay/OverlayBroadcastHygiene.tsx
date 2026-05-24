"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { OVERLAY_POLL_MS_QUERY } from "@/lib/overlay-params";

/** OBS·방송 URL에 남아 있는 `overlayPollMs` 제거 — `history.replaceState` 직접 호출은 App Router를 깨뜨릴 수 있음 */
function OverlayBroadcastHygieneInner() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  useEffect(() => {
    if (!sp.has(OVERLAY_POLL_MS_QUERY)) return;
    const next = new URLSearchParams(sp.toString());
    next.delete(OVERLAY_POLL_MS_QUERY);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [router, pathname, sp]);

  return null;
}

export default function OverlayBroadcastHygiene() {
  return (
    <Suspense fallback={null}>
      <OverlayBroadcastHygieneInner />
    </Suspense>
  );
}
