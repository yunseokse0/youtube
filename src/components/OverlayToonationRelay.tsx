"use client";

import { useEffect } from "react";
import ToonationBrowserRelay from "@/components/ToonationBrowserRelay";

type Props = {
  userId: string;
  /** URL `key=` 등 — 있으면 relay-config API 생략 */
  linkKey?: string;
  ownerName?: string;
  /** overlay 열릴 때 서버 Node WS 일시 중지(후원 JSON 분산 방지) */
  pauseServerListener?: boolean;
};

/** 엑셀표 OBS — relay-config 또는 URL key 기반 자동 릴레이(항상 ON) */
export default function OverlayToonationRelay({
  userId,
  linkKey,
  ownerName,
  pauseServerListener = true,
}: Props) {
  useEffect(() => {
    if (!userId || !pauseServerListener) return;
    let cancelled = false;
    let shouldRestore = false;
    let resumeBody: { alertboxUrl: string; ownerName: string } | null = null;

    const run = async () => {
      try {
        const cfgRes = await fetch(`/api/donations/toonation/relay-config?u=${encodeURIComponent(userId)}`, {
          cache: "no-store",
        });
        const cfg = (await cfgRes.json().catch(() => null)) as {
          linkKey?: string;
          ownerName?: string;
          serverListenerEnabled?: boolean;
        } | null;
        const link = String(linkKey || cfg?.linkKey || "").trim();
        if (cancelled || !link) return;
        if (cfg?.serverListenerEnabled) {
          shouldRestore = true;
          resumeBody = {
            alertboxUrl: link,
            ownerName: String(ownerName || cfg?.ownerName || "").trim(),
          };
        }
        await fetch(`/api/donations/toonation/listener?u=${encodeURIComponent(userId)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alertboxUrl: link,
            ownerName: String(ownerName || cfg?.ownerName || "").trim(),
            enabled: false,
          }),
        });
      } catch {
        /* noop */
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (!shouldRestore || !resumeBody) return;
      void fetch(`/api/donations/toonation/listener?u=${encodeURIComponent(userId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...resumeBody, enabled: true }),
      });
    };
  }, [linkKey, ownerName, pauseServerListener, userId]);

  return (
    <ToonationBrowserRelay
      userId={userId}
      linkKey={linkKey}
      ownerName={ownerName}
      enabled
      hidden
    />
  );
}