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
import type { ZubZubQueueItem } from "@/types";

function ZubzubOverlayInner() {
  const sp = useSearchParams();
  const rawUserId = (sp.get("u") || "").trim();
  const userId = resolveScopedOverlayUserId(rawUserId);

  const posParam = sp.get("pos");
  const position: "top" | "bottom" | "center" =
    posParam === "bottom" ? "bottom" : posParam === "center" ? "center" : "top";

  const alignParam = sp.get("align");
  const align: "center" | "left" | "right" =
    alignParam === "left" ? "left" : alignParam === "right" ? "right" : "center";

  const isDemoParam = sp.get("demo") === "1" || sp.get("preview") === "1" || sp.get("test") === "1";
  const [localDemoWaiting, setLocalDemoWaiting] = useState(isDemoParam);
  const [dismissGuide, setDismissGuide] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const isObs =
    isClient &&
    typeof window !== "undefined" &&
    (navigator.userAgent.includes("OBS/") || (sp.get("host") === "obs" && !window.location.search.includes("browser=1")));

  const { state: remoteState } = useOverlayRemoteState(userId || undefined, {
    enabled: Boolean(userId),
  });
  const [zubzubClaimedEvent, setZubzubClaimedEvent] = useState<ZubzubClaimedEvent | null>(null);
  const [waitingItems, setWaitingItems] = useState<ZubZubQueueItem[]>([]);

  // 1. 초기/원격 상태 동기화
  useEffect(() => {
    if (remoteState?.zubzubWaitingItems) {
      setWaitingItems(remoteState.zubzubWaitingItems);
    }
  }, [remoteState?.zubzubWaitingItems]);

  // 2. 실시간 SSE 이벤트 리스너
  const onSSE = useCallback((incoming: any) => {
    if (!incoming) return;
    if (incoming.type === "zubzub_claimed") {
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

  // 데모 대기 아이템 (위치 조절 및 미리보기용)
  const demoWaitingItem: ZubZubQueueItem = {
    id: "demo_zubzub_preview",
    userId: userId || "zakiexcel",
    sigName: "NO BATIDÃO",
    bonusAmount: 130000,
    status: "WAITING",
    createdAt: Date.now(),
  };

  const effectiveWaitingItems =
    waitingItems.length > 0
      ? waitingItems
      : isDemoParam || localDemoWaiting
      ? [demoWaitingItem]
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

  const showHelperHud =
    isClient &&
    !isObs &&
    !dismissGuide &&
    waitingItems.length === 0 &&
    !zubzubClaimedEvent &&
    !isDemoParam &&
    !localDemoWaiting;

  return (
    <div className="w-full h-full min-h-screen bg-transparent overflow-hidden select-none">
      <ZubzubOverlayBanner
        waitingItems={effectiveWaitingItems}
        claimedEvent={zubzubClaimedEvent}
        onClearClaimedEvent={() => setZubzubClaimedEvent(null)}
        position={position}
        align={align}
      />

      {/* 브라우저 직접 접속 시 대기열이 비어있을 때 표시되는 인터랙티브 가이드 HUD */}
      {showHelperHud && (
        <div className="pointer-events-auto fixed inset-0 flex flex-col items-center justify-center p-4 z-50">
          <div className="max-w-md w-full rounded-2xl border border-white/20 bg-neutral-950/95 p-5 shadow-2xl backdrop-blur-xl text-center space-y-3.5 animate-in fade-in zoom-in-95 duration-200">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center justify-center text-2xl mx-auto shadow-inner">
              🎁
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center justify-center gap-1.5">
                <span>대표 시그 줍줍 오버레이</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  연동 준비 완료
                </span>
              </h2>
              <p className="text-xs text-neutral-300 mt-2 leading-relaxed">
                현재 대기 중인 줍줍이 없어 방송 화면에서는 <strong>투명하게 숨김 대기</strong> 중입니다.<br />
                대표에게 시그니처가 터지면 자동으로 대기 뱃지가 나타납니다.
              </p>
            </div>

            <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => setLocalDemoWaiting(true)}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold text-white shadow-lg shadow-indigo-900/40 transition cursor-pointer flex items-center gap-1.5"
              >
                <span>🎁</span> 대기 뱃지 미리보기 켜기
              </button>
              <button
                type="button"
                onClick={triggerTestClaim}
                className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-xs font-bold text-white shadow-lg shadow-amber-900/40 transition cursor-pointer flex items-center gap-1.5"
              >
                <span>🎉</span> 4초 성공 연출 테스트
              </button>
            </div>

            <div className="border-t border-white/10 pt-2.5 flex items-center justify-between text-[11px] text-neutral-400">
              <span>OBS 크기 조절: URL 뒤에 <code className="text-amber-300 font-mono">&demo=1</code> 추가</span>
              <button
                type="button"
                onClick={() => setDismissGuide(true)}
                className="text-neutral-500 hover:text-neutral-300 underline cursor-pointer"
              >
                가이드 닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 미리보기 모드 활성화 시 해제 바 */}
      {localDemoWaiting && !isDemoParam && (
        <div className="pointer-events-auto fixed bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-950/90 border border-white/20 text-xs text-neutral-300 shadow-xl backdrop-blur-md">
          <span>✨ 줍줍 대기 뱃지 미리보기 표시 중</span>
          <button
            type="button"
            onClick={triggerTestClaim}
            className="text-amber-300 font-bold hover:underline"
          >
            [🎉 성공 연출 발동]
          </button>
          <button
            type="button"
            onClick={() => setLocalDemoWaiting(false)}
            className="text-neutral-400 hover:text-white font-bold ml-1"
          >
            ✕ 끄기
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
