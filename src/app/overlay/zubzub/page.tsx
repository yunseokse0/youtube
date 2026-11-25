"use client";

import React, { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { useSSEConnection } from "@/lib/sse-client";
import {
  ZubzubOverlayBanner,
  type ZubzubClaimedEvent,
} from "@/components/overlay/ZubzubOverlayBanner";
import type { ZubZubQueueItem, ZubZubSettings } from "@/types";

function ZubzubOverlayInner() {
  const sp = useSearchParams();
  const rawUserId = (sp.get("u") || "").trim();
  const userId = resolveScopedOverlayUserId(rawUserId);

  const { state: remoteState } = useOverlayRemoteState(userId || undefined, {
    enabled: Boolean(userId),
  });
  const [zubzubClaimedEvent, setZubzubClaimedEvent] = useState<ZubzubClaimedEvent | null>(null);
  const [waitingItems, setWaitingItems] = useState<ZubZubQueueItem[]>([]);
  const [overlaySettings, setOverlaySettings] = useState<ZubZubSettings | null>(null);
  const [isClient, setIsClient] = useState(false);

  const isDemoParam = sp.get("demo") === "1" || sp.get("preview") === "1" || sp.get("test") === "1";
  const [demoMode, setDemoMode] = useState<"none" | "single" | "twelve">(isDemoParam ? "twelve" : "none");

  const posParam = sp.get("pos");
  const position: "top" | "bottom" | "center" =
    posParam === "bottom" ? "bottom" : posParam === "center" ? "center" : "top";

  const alignParam = sp.get("align");
  const align: "center" | "left" | "right" =
    alignParam === "left"
      ? "left"
      : alignParam === "right"
        ? "right"
        : alignParam === "center"
          ? "center"
          : (overlaySettings?.align || "left");

  useEffect(() => {
    setIsClient(true);
  }, []);

  const isObs =
    isClient &&
    typeof window !== "undefined" &&
    (navigator.userAgent.includes("OBS/") || (sp.get("host") === "obs" && !window.location.search.includes("browser=1")));

  // 1. 초기/원격 상태 동기화
  useEffect(() => {
    if (remoteState?.zubzubWaitingItems) {
      setWaitingItems(remoteState.zubzubWaitingItems);
    }
    if (remoteState?.zubzubSettings) {
      setOverlaySettings(remoteState.zubzubSettings);
    }
  }, [remoteState?.zubzubWaitingItems, remoteState?.zubzubSettings]);

  // 2. 실시간 SSE 이벤트 리스너
  const onSSE = useCallback((incoming: any) => {
    if (!incoming) return;
    if (incoming.type === "zubzub_settings_updated" && incoming.settings) {
      setOverlaySettings(incoming.settings as ZubZubSettings);
    } else if (incoming.type === "zubzub_claimed") {
      setZubzubClaimedEvent(incoming);
      // 획득 시 대기열 갱신
      if (incoming.queueItem?.id) {
        setWaitingItems((prev) => prev.filter((x) => x.id !== incoming.queueItem.id));
      }
    } else if (incoming.type === "zubzub_waiting") {
      if (incoming.queueItem) {
        setWaitingItems((prev) => {
          if (prev.some((x) => x.id === incoming.queueItem.id)) return prev;
          return [...prev, incoming.queueItem];
        });
      }
    } else if (incoming.type === "zubzub_canceled") {
      if (incoming.queueId) {
        setWaitingItems((prev) => prev.filter((x) => x.id !== incoming.queueId));
      }
    } else if (incoming.type === "zubzub_canceled_all") {
      setWaitingItems([]);
    }
  }, []);

  useSSEConnection(onSSE);

  const configuredScale = Number(overlaySettings?.overlayScale ?? remoteState?.zubzubSettings?.overlayScale);
  const bannerScale = Number.isFinite(configuredScale) && configuredScale > 0
    ? Math.min(4, Math.max(0.5, configuredScale))
    : 1;
  const configuredMaxVisibleItems = Number(
    overlaySettings?.maxVisibleItems ?? remoteState?.zubzubSettings?.maxVisibleItems
  );
  const maxVisibleItems = Number.isFinite(configuredMaxVisibleItems)
    ? Math.min(10, Math.max(1, Math.round(configuredMaxVisibleItems)))
    : 3;
  const alwaysShowWaiting = overlaySettings?.alwaysShowWaiting !== false;

  // 데모 대기 아이템 (위치 조절 및 롤링 테스트용)
  const demoWaitingItem: ZubZubQueueItem = {
    id: "demo_zubzub_preview_1",
    userId: userId || "zakiexcel",
    triggerDonationId: "demo_trigger_preview",
    sigName: "NO BATIDÃO",
    bonusAmount: 130000,
    status: "WAITING",
    createdAt: Date.now(),
  };

  const demo12Items: ZubZubQueueItem[] = React.useMemo(() => [
    { id: "dm_1", userId: "demo", triggerDonationId: "t1", sigName: "NO BATIDÃO", bonusAmount: 130000, status: "WAITING", createdAt: 100 },
    { id: "dm_2", userId: "demo", triggerDonationId: "t2", sigName: "ALIVE", bonusAmount: 52000, status: "WAITING", createdAt: 200 },
    { id: "dm_3", userId: "demo", triggerDonationId: "t3", sigName: "매드쉐이크", bonusAmount: 40300, status: "WAITING", createdAt: 300 },
    { id: "dm_4", userId: "demo", triggerDonationId: "t4", sigName: "팬서비스", bonusAmount: 40700, status: "WAITING", createdAt: 400 },
    { id: "dm_5", userId: "demo", triggerDonationId: "t5", sigName: "나의N이되어줘", bonusAmount: 50700, status: "WAITING", createdAt: 500 },
    { id: "dm_6", userId: "demo", triggerDonationId: "t6", sigName: "첫만남은어려워", bonusAmount: 30500, status: "WAITING", createdAt: 600 },
    { id: "dm_7", userId: "demo", triggerDonationId: "t7", sigName: "다시여기바닷가", bonusAmount: 70700, status: "WAITING", createdAt: 700 },
    { id: "dm_8", userId: "demo", triggerDonationId: "t8", sigName: "캐치캐치", bonusAmount: 95900, status: "WAITING", createdAt: 800 },
    { id: "dm_9", userId: "demo", triggerDonationId: "t9", sigName: "하나뿐인매드", bonusAmount: 150400, status: "WAITING", createdAt: 900 },
    { id: "dm_10", userId: "demo", triggerDonationId: "t10", sigName: "슈퍼매드신호탄", bonusAmount: 1001300, status: "WAITING", createdAt: 1000 },
    { id: "dm_11", userId: "demo", triggerDonationId: "t11", sigName: "골든벨", bonusAmount: 200000, status: "WAITING", createdAt: 1100 },
    { id: "dm_12", userId: "demo", triggerDonationId: "t12", sigName: "피날레", bonusAmount: 300000, status: "WAITING", createdAt: 1200 },
  ], []);

  const effectiveWaitingItems =
    demoMode === "twelve"
      ? demo12Items
      : demoMode === "single"
      ? [demoWaitingItem]
      : waitingItems.length > 0
      ? waitingItems
      : isDemoParam
      ? demo12Items
      : [];

  const triggerTestClaim = () => {
    const dummy: ZubzubClaimedEvent = {
      type: "zubzub_claimed",
      queueItem: {
        id: `demo_${Date.now()}`,
        userId: userId || "zakiexcel",
        triggerDonationId: "demo_trigger",
        sigName: "NO BATIDÃO",
        bonusAmount: 130000,
        status: "CLAIMED",
        createdAt: Date.now(),
      },
      memberId: "m_jina",
      memberName: "진아",
      bonusAmount: 130000,
      timestamp: Date.now(),
    };
    setZubzubClaimedEvent(dummy);
  };

  const isBrowserPreview = isClient && !isObs;
  const rollIntervalSec = Number(overlaySettings?.rollIntervalSec || 2.5);

  return (
    <div className="w-full h-full min-h-screen bg-transparent overflow-hidden select-none">
      <ZubzubOverlayBanner
        waitingItems={effectiveWaitingItems}
        claimedEvent={zubzubClaimedEvent}
        onClearClaimedEvent={() => setZubzubClaimedEvent(null)}
        position={position}
        align={align}
        alwaysShowWaiting={alwaysShowWaiting}
        scale={bannerScale}
        maxVisibleItems={maxVisibleItems}
        rollIntervalSec={rollIntervalSec}
      />

      {/* 브라우저 직접 접속 테스트 전용 하단 툴바 (OBS 방송 브라우저 소스에서는 자동 숨김) */}
      {isBrowserPreview && (
        <div className="pointer-events-auto fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex flex-wrap items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-950/90 border border-white/20 text-xs text-neutral-300 shadow-2xl backdrop-blur-md">
          <span className="text-amber-300 font-bold flex items-center gap-1">
            <span>🎁</span> 줍줍 테스트:
          </span>
          <button
            type="button"
            onClick={() => setDemoMode("twelve")}
            className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
              demoMode === "twelve"
                ? "bg-amber-500 text-black font-black border-amber-400"
                : "bg-neutral-800 hover:bg-neutral-700 text-white border-white/10"
            }`}
          >
            🌀 12개 대기 (롤링 테스트)
          </button>
          <button
            type="button"
            onClick={() => setDemoMode("single")}
            className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
              demoMode === "single"
                ? "bg-amber-500 text-black font-black border-amber-400"
                : "bg-neutral-800 hover:bg-neutral-700 text-white border-white/10"
            }`}
          >
            1개 대기
          </button>
          <button
            type="button"
            onClick={() => setDemoMode("none")}
            className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold border transition cursor-pointer ${
              demoMode === "none"
                ? "bg-neutral-700 text-white border-white/30"
                : "bg-neutral-800 hover:bg-neutral-700 text-neutral-400 border-white/10"
            }`}
          >
            대기 비우기
          </button>
          <button
            type="button"
            onClick={triggerTestClaim}
            className="px-2.5 py-0.5 rounded-md bg-amber-600 hover:bg-amber-500 text-[11px] font-semibold text-white shadow transition cursor-pointer"
          >
            🎉 4초 성공 연출
          </button>
        </div>
      )}
    </div>
  );
}

export default function ZubzubStandaloneOverlayPage() {
  return (
    <Suspense fallback={<div className="w-full h-full bg-transparent" />}>
      <ZubzubOverlayInner />
    </Suspense>
  );
}
