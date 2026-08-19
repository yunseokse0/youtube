"use client";

import { useEffect, useState } from "react";
import {
  ADMIN_PREVIEW_DONORS_REQUEST,
  ADMIN_PREVIEW_DONORS_UPDATED,
  overlayUserIdsMatch,
} from "@/lib/broadcast-state-local-sync";

/** 관리자 iframe — 부모 탭 postMessage donors (누적 표와 동일 스냅샷) */
export function useAdminPreviewDonorsOverride(
  enabled: boolean,
  userId?: string
): Array<Record<string, unknown>> | undefined {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setRows(undefined);
      return;
    }
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as {
        type?: string;
        userId?: string | null;
        donors?: unknown[];
      } | null;
      if (!data || data.type !== ADMIN_PREVIEW_DONORS_UPDATED) return;
      if (!overlayUserIdsMatch(userId, data.userId)) return;
      if (!Array.isArray(data.donors)) return;
      setRows(
        data.donors.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>
      );
    };
    window.addEventListener("message", onMessage);
    try {
      window.parent.postMessage(
        { type: ADMIN_PREVIEW_DONORS_REQUEST, userId: userId ?? null },
        window.location.origin
      );
    } catch {
      /* noop */
    }
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, userId]);

  return enabled ? rows : undefined;
}
