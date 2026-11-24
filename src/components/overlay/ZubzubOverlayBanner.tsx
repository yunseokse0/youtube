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

export type ZubzubSimpleWaitingInfo = {
  badgeLabel: string;
  sigName: string;
  bonusText: string;
  extraCount: number;
};

export type ZubzubSimpleClaimedInfo = {
  icon: string;
  memberName: string;
  actionText: string;
  sigName: string;
  bonusText: string;
};

/** 초간결 줍줍 대기 1줄 텍스트 포맷터 */
export function formatZubzubSimpleWaiting(
  item: ZubZubQueueItem,
  totalCount: number = 1
): ZubzubSimpleWaitingInfo {
  return {
    badgeLabel: "줍줍 대기:",
    sigName: `[${item.sigName}]`,
    bonusText: `+${item.bonusAmount.toLocaleString()}`,
    extraCount: totalCount > 1 ? totalCount - 1 : 0,
  };
}

/** 초간결 줍줍 성공 1줄 텍스트 포맷터 */
export function formatZubzubSimpleClaimed(
  event: ZubzubClaimedEvent
): ZubzubSimpleClaimedInfo {
  return {
    icon: "🎉",
    memberName: event.memberName,
    actionText: "줍줍 성공!",
    sigName: `[${event.queueItem.sigName}]`,
    bonusText: `+${event.bonusAmount.toLocaleString()}`,
  };
}

type Props = {
  waitingItems?: ZubZubQueueItem[];
  claimedEvent?: ZubzubClaimedEvent | null;
  onClearClaimedEvent?: () => void;
  position?: "top" | "bottom" | "center";
  align?: "center" | "left" | "right";
  className?: string;
  /** 대기 중인 시그가 없을 때도 '🎁 줍줍 대기: 대기 없음' 뱃지를 항상 화면에 표시 (기본 true) */
  alwaysShowWaiting?: boolean;
  emptyText?: string;
};

export function ZubzubOverlayBanner({
  waitingItems = [],
  claimedEvent,
  onClearClaimedEvent,
  position = "top",
  align = "center",
  className = "",
  alwaysShowWaiting = true,
  emptyText = "대기 없음",
}: Props) {
  const [activeClaim, setActiveClaim] = useState<ZubzubClaimedEvent | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!claimedEvent) return;
    setActiveClaim(claimedEvent);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    // 간결하고 깔끔하게 4초간 축하 후 자동 닫힘
    timeoutRef.current = setTimeout(() => {
      setActiveClaim(null);
      onClearClaimedEvent?.();
    }, 4000);
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [claimedEvent, onClearClaimedEvent]);

  const hasWaiting = waitingItems.length > 0;
  const currentWaiting = waitingItems[0];

  // 위치 스타일 결정
  const posClass =
    position === "bottom"
      ? "bottom-4"
      : position === "center"
        ? "top-1/2 -translate-y-1/2"
        : "top-3";

  // 정렬 스타일 결정
  const alignClass =
    align === "left"
      ? "justify-start pl-6"
      : align === "right"
        ? "justify-end pr-6"
        : "justify-center";

  // 아무것도 표시할 내용이 없고 alwaysShowWaiting도 꺼져 있으면 렌더링 생략
  if (!activeClaim && !hasWaiting && !alwaysShowWaiting) {
    return null;
  }

  const claimInfo = activeClaim ? formatZubzubSimpleClaimed(activeClaim) : null;
  const waitingInfo = currentWaiting
    ? formatZubzubSimpleWaiting(currentWaiting, waitingItems.length)
    : null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 ${posClass} z-[9999] flex items-center ${alignClass} select-none transition-all duration-300 ${className}`}
    >
      {/* 1. 줍줍 성공 축하 알림 (간결한 1줄 뱃지) */}
      {claimInfo ? (
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/80 bg-neutral-950/90 px-4 py-1.5 shadow-[0_4px_25px_rgba(245,158,11,0.45)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-200">
          <span className="text-sm">{claimInfo.icon}</span>
          <span className="text-xs font-black text-amber-300">
            {claimInfo.memberName}
          </span>
          <span className="text-xs font-bold text-white">
            {claimInfo.actionText}
          </span>
          <span className="text-xs font-bold text-neutral-300">
            {claimInfo.sigName}
          </span>
          <span className="font-mono text-xs font-black text-emerald-400">
            {claimInfo.bonusText}
          </span>
        </div>
      ) : waitingInfo ? (
        /* 2. 대표 시그 줍줍 대기 중 배너 (초간결 1줄 뱃지) */
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/60 bg-neutral-950/85 px-3.5 py-1.5 shadow-[0_2px_15px_rgba(245,158,11,0.3)] backdrop-blur-md">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-xs">
            🎁
          </span>
          <span className="text-[11px] font-bold text-amber-300">
            {waitingInfo.badgeLabel}
          </span>
          <span className="text-xs font-bold text-white">
            {waitingInfo.sigName}
          </span>
          <span className="font-mono text-xs font-black text-emerald-400">
            {waitingInfo.bonusText}
          </span>
          {waitingInfo.extraCount > 0 && (
            <span className="rounded-full bg-neutral-800/80 border border-white/10 px-1.5 py-0.2 text-[10px] font-bold text-neutral-400">
              +{waitingInfo.extraCount}
            </span>
          )}
        </div>
      ) : alwaysShowWaiting ? (
        /* 3. 대기 중인 시그가 없을 때 방송에 항상 유지되는 뱃지 */
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-neutral-950/80 px-3.5 py-1.5 shadow-[0_2px_15px_rgba(0,0,0,0.5)] backdrop-blur-md">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-xs">
            🎁
          </span>
          <span className="text-[11px] font-bold text-amber-300/90">
            줍줍 대기:
          </span>
          <span className="text-xs font-semibold text-neutral-400">
            {emptyText}
          </span>
        </div>
      ) : null}
    </div>
  );
}
