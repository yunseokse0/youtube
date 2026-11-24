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

  return (
    <div className="w-full h-full min-h-screen bg-transparent overflow-hidden select-none pointer-events-none">
      <ZubzubOverlayBanner
        waitingItems={waitingItems}
        claimedEvent={zubzubClaimedEvent}
        onClearClaimedEvent={() => setZubzubClaimedEvent(null)}
        position={position}
        align={align}
      />
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
