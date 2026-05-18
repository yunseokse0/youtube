"use client";

import { useEffect } from "react";
import { stripOverlayPollMsFromBrowserLocation } from "@/lib/overlay-params";

/** OBS·방송 URL에 남아 있는 `overlayPollMs` 를 제거(주기 폴링 비활성 정책) */
export default function OverlayBroadcastHygiene() {
  useEffect(() => {
    stripOverlayPollMsFromBrowserLocation();
  }, []);
  return null;
}
