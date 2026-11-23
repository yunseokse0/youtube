"use client";

import React, { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { useSSEConnection } from "@/lib/sse-client";
import { MarqueeTickerOverlay } from "@/components/overlay/MarqueeTickerOverlay";
import type { TickerSettings } from "@/types";

function TickerOverlayInner() {
  const sp = useSearchParams();
  const rawUserId = (sp.get("u") || "").trim();
  const userId = resolveScopedOverlayUserId(rawUserId);

  const { state: remoteState } = useOverlayRemoteState(userId || undefined, Boolean(userId));
  const [tickerSettings, setTickerSettings] = useState<TickerSettings | null>(
    remoteState?.tickerSettings || null
  );

  useEffect(() => {
    if (remoteState?.tickerSettings) {
      setTickerSettings(remoteState.tickerSettings);
    }
  }, [remoteState?.tickerSettings]);

  const onSSE = useCallback((incoming: any) => {
    if (!incoming) return;
    if (incoming.type === "ticker_updated" && incoming.settings) {
      setTickerSettings(incoming.settings);
    }
  }, []);

  useSSEConnection(onSSE);

  // If no settings set yet, show default template so it's immediately testable
  const effectiveSettings: TickerSettings = tickerSettings || {
    enabled: true,
    badgeText: "NOTICE",
    badgeBgColor: "#dc2626",
    badgeTextColor: "#ffffff",
    text: "✦ 첫만남은 어려워 30500원 ✦ 매드레이디 40200 ✦ 매드쉐이크 40300 ✦ 팬서비스 40700 ✦ 나의N이되어줘 50700 ✦ 다시여기바닷가 70700 ✦ 캐치캐치 95900 ✦ 하나뿐인매드 150400 ✦ 슈퍼매드신호탄 1001300",
    speedSec: 35,
    fontSizePx: 14,
    textColor: "#ffffff",
    bgColor: "rgba(10, 10, 10, 0.85)",
  };

  return (
    <div className="w-full h-full min-h-screen bg-transparent select-none pointer-events-none relative overflow-hidden">
      <MarqueeTickerOverlay settings={effectiveSettings} />
    </div>
  );
}

export default function StandaloneTickerOverlayPage() {
  return (
    <Suspense fallback={<div className="w-full h-full bg-transparent" />}>
      <TickerOverlayInner />
    </Suspense>
  );
}
