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
    badgeLabel: "대표 줍줍 :",
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
  /** 대기 중인 시그가 없을 때도 '🎁 대표 줍줍 : 대기 없음' 뱃지를 항상 화면에 표시 (기본 true) */
  alwaysShowWaiting?: boolean;
  emptyText?: string;
  /** 배너 크기 배율 (1 = 원본). 독립 오버레이 URL의 `scale` 파라미터로 조절 */
  scale?: number;
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
  scale = 1,
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
  const orderedWaitings = [...waitingItems].sort(
    (a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0)
  );

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

  // 대기 목록(여러 줄) 내부 정렬
  const columnAlignClass =
    align === "left" ? "items-start" : align === "right" ? "items-end" : "items-center";

  // 크기 배율 (1 = 원본). 위치/정렬에 맞춰 변환 기준점을 잡아 화면 밖으로 밀리지 않게 한다.
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const hOrigin = align === "left" ? "left" : align === "right" ? "right" : "center";
  const vOrigin = position === "bottom" ? "bottom" : position === "center" ? "center" : "top";
  const scaleStyle: React.CSSProperties =
    Math.abs(safeScale - 1) > 0.001
      ? {
          transform: `scale(${safeScale})`,
          transformOrigin: `${hOrigin} ${vOrigin}`,
          transition: "transform 200ms ease-out",
        }
      : {};

  // 아무것도 표시할 내용이 없고 alwaysShowWaiting도 꺼져 있으면 렌더링 생략
  if (!activeClaim && !hasWaiting && !alwaysShowWaiting) {
    return null;
  }

  const claimInfo = activeClaim ? formatZubzubSimpleClaimed(activeClaim) : null;

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 ${posClass} z-[9999] flex items-center ${alignClass} select-none transition-all duration-300 ${className}`}
    >
      <div className="inline-flex" style={scaleStyle}>
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
      ) : hasWaiting ? (
        /* 2. 대표 시그 줍줍 대기 목록 (대기 중인 모든 시그를 순서대로 표시) */
        <div className={`flex flex-col gap-1.5 ${columnAlignClass}`}>
          {orderedWaitings.map((item, idx) => {
            const waitingInfo = formatZubzubSimpleWaiting(item, 1);
            return (
              <div
                key={item.id}
                className="inline-flex items-center gap-2 rounded-full border border-amber-400/60 bg-neutral-950/85 px-3.5 py-1.5 shadow-[0_2px_15px_rgba(245,158,11,0.3)] backdrop-blur-md"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-xs">
                  🎁
                </span>
                <span className="text-[11px] font-bold text-amber-300">
                  {idx === 0 ? waitingInfo.badgeLabel : `#${idx + 1}`}
                </span>
                <span className="text-xs font-bold text-white">
                  {waitingInfo.sigName}
                </span>
                <span className="font-mono text-xs font-black text-emerald-400">
                  {waitingInfo.bonusText}
                </span>
              </div>
            );
          })}
        </div>
      ) : alwaysShowWaiting ? (
        /* 3. 대기 중인 시그가 없을 때 방송에 항상 유지되는 뱃지 */
        <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-neutral-950/80 px-3.5 py-1.5 shadow-[0_2px_15px_rgba(0,0,0,0.5)] backdrop-blur-md">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/15 text-xs">
            🎁
          </span>
          <span className="text-[11px] font-bold text-amber-300/90">
            대표 줍줍 :
          </span>
          <span className="text-xs font-semibold text-neutral-400">
            {emptyText}
          </span>
        </div>
      ) : null}
      </div>
    </div>
  );
}
