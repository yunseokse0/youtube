"use client";

import { useEffect, useState } from "react";
import {
  ADMIN_PREVIEW_DONOR_RANKINGS_THEME_UPDATED,
  overlayUserIdsMatch,
} from "@/lib/broadcast-state-local-sync";
import type { AppState } from "@/lib/state";

/** 관리자 iframe — 부모 탭 postMessage로 후원순위 테마 즉시 반영 */
export function useAdminPreviewDonorRankingsThemeOverride(
  enabled: boolean,
  userId?: string
): AppState["donorRankingsTheme"] | undefined {
  const [theme, setTheme] = useState<AppState["donorRankingsTheme"] | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setTheme(undefined);
      return;
    }
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as {
        type?: string;
        userId?: string | null;
        donorRankingsTheme?: AppState["donorRankingsTheme"];
      } | null;
      if (!data || data.type !== ADMIN_PREVIEW_DONOR_RANKINGS_THEME_UPDATED) return;
      if (!overlayUserIdsMatch(userId, data.userId)) return;
      if (!data.donorRankingsTheme || typeof data.donorRankingsTheme !== "object") return;
      setTheme(data.donorRankingsTheme);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, userId]);

  return enabled ? theme : undefined;
}
