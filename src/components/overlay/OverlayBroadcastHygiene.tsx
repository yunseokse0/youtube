"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  isEmbeddedInSameOriginAdminFrame,
  OVERLAY_POLL_MS_QUERY,
  stripPreviewOnlyOverlaySearchParams,
} from "@/lib/overlay-params";

/**
 * OBS·방송 URL 정리: `overlayPollMs`·미리보기 쿼리(hubPreview 등) 제거.
 * 관리자 iframe 미리보기는 그대로 둠.
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
    const inAdminIframe = isEmbeddedInSameOriginAdminFrame();
    const next = new URLSearchParams(sp.toString());
    let changed = false;
    if (next.has(OVERLAY_POLL_MS_QUERY)) {
      next.delete(OVERLAY_POLL_MS_QUERY);
      changed = true;
    }
    if (!inAdminIframe) {
      const before = next.toString();
      stripPreviewOnlyOverlaySearchParams(next);
      if (next.toString() !== before) changed = true;
    }
    if (!changed) return;
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [ready, router, pathname]);

  return null;
}
