"use client";

import React, { useState, useEffect, useRef } from "react";
import type { ZubZubQueueItem } from "@/types";

export type ZubzubClaimedEvent = {
  type: "zubzub_claimed";
  queueItem: ZubZubQueueItem;
  memberId: string;
  memberName: string;
  bonusAmount: number;
  timestamp: number;
};

type Props = {
  waitingItems?: ZubZubQueueItem[];
  claimedEvent?: ZubzubClaimedEvent | null;
  onClearClaimedEvent?: () => void;
};

export function ZubzubOverlayBanner({
  waitingItems = [],
  claimedEvent,
  onClearClaimedEvent,
}: Props) {
  const [activeClaim, setActiveClaim] = useState<ZubzubClaimedEvent | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!claimedEvent) return;
    setActiveClaim(claimedEvent);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setActiveClaim(null);
      onClearClaimedEvent?.();
    }, 7000); // 7초간 축하 팝업 유지
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [claimedEvent, onClearClaimedEvent]);

  const hasWaiting = waitingItems.length > 0;
  const currentWaiting = waitingItems[0];

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex flex-col items-center gap-2">
      {/* 1. 줍줍 성공 축하 알림 (Claimed Celebration Popup) */}
      {activeClaim && (
        <div className="animate-bounce-in flex items-center gap-3 rounded-2xl border-2 border-amber-400/80 bg-neutral-950/95 px-5 py-3 shadow-[0_0_40px_rgba(245,158,11,0.6)] backdrop-blur-md">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-yellow-300 text-2xl shadow-lg">
            🎁
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-white uppercase">
                줍줍 성공!
              </span>
              <span className="font-black text-sm text-amber-300">
                {activeClaim.memberName}
              </span>
            </div>
            <div className="text-xs font-bold text-white">
              <span className="text-yellow-400">[{activeClaim.queueItem.sigName}]</span> 대표 시그 줍줍 완료!
            </div>
            <div className="font-mono text-[11px] font-extrabold text-emerald-400">
              +{activeClaim.bonusAmount.toLocaleString()}점 복제 지급 완료 (랭킹 기여도)
            </div>
          </div>
        </div>
      )}

      {/* 2. 대표 시그 줍줍 대기 중 배너 (무제한 타이머 대기 카드) */}
      {hasWaiting && currentWaiting && !activeClaim && (
        <div className="flex items-center gap-3 rounded-full border border-amber-500/50 bg-neutral-900/90 px-4 py-2 shadow-[0_0_25px_rgba(234,179,8,0.35)] backdrop-blur-sm animate-pulse">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-neutral-950 font-black text-xs shadow-md">
            🚨
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="font-extrabold text-amber-300">
              [대표 시그 줍줍 대기중]
            </span>
            <span className="font-bold text-white">
              {currentWaiting.sigName}
            </span>
            <span className="font-mono font-black text-emerald-400">
              +{currentWaiting.bonusAmount.toLocaleString()}점
            </span>
            {waitingItems.length > 1 && (
              <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-400 font-semibold border border-white/10">
                +{waitingItems.length - 1}건 대기
              </span>
            )}
          </div>

          <div className="rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] font-bold text-rose-300">
            선착순 줍줍!
          </div>
        </div>
      )}
    </div>
  );
}
