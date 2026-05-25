"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { OVERLAY_POLL_MS_QUERY } from "@/lib/overlay-params";

/**
 * OBS·방송 URL의 `overlayPollMs` 제거.
 * useSearchParams+Suspense는 서버 HTML에 <template>를 남겨 overlay 하위 hydration 오류 유발 → 클라이언트 전용.
 */
export default function OverlayBroadcastHygiene() {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (!sp.has(OVERLAY_POLL_MS_QUERY)) return;
    const next = new URLSearchParams(sp.toString());
    next.delete(OVERLAY_POLL_MS_QUERY);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [ready, router, pathname]);

  return null;
}
