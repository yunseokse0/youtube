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

export function limitZubzubWaitingItems(
  items: ZubZubQueueItem[],
  maxVisibleItems: number = 3
): ZubZubQueueItem[] {
  const limit = Math.min(
    10,
    Math.max(1, Math.round(Number(maxVisibleItems) || 3))
  );
  return [...items]
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
    .slice(0, limit);
}

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
  /** 배너 크기 배율 (1 = 원본) */
  scale?: number;
  /** 대기 목록에서 한 번에 표시할 최대 항목 수 */
  maxVisibleItems?: number;
  /** 10개 이상 밀렸을 때 롤링 간격/속도 (초 단위, 기본 2.5초) */
  rollIntervalSec?: number;
};

export function ZubzubOverlayBanner({
  waitingItems = [],
  claimedEvent,
  onClearClaimedEvent,
  position = "top",
  align = "left",
  className = "",
  alwaysShowWaiting = true,
  emptyText = "대기 없음",
  scale = 1,
  maxVisibleItems = 3,
  rollIntervalSec = 2.5,
}: Props) {
  const [activeClaim, setActiveClaim] = useState<ZubzubClaimedEvent | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 10개 이상 밀렸을 때 무한 롤링 상태
  const isRolling = waitingItems.length >= 10;
  const [scrollIndex, setScrollIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(true);
  const itemRef = useRef<HTMLDivElement | null>(null);
  const [measuredItemHeight, setMeasuredItemHeight] = useState(38);

  const rollIntervalMs = Math.max(
    1000,
    Math.min(10000, Math.round(Number(rollIntervalSec || 2.5) * 1000))
  );

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

  // 대기 아이템 정렬 및 인덱스 부여
  const sortedWaitings = React.useMemo(() => {
    return [...waitingItems]
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .map((item, idx) => ({ ...item, _originalIndex: idx }));
  }, [waitingItems]);

  const visibleCount = React.useMemo(() => {
    return Math.min(
      sortedWaitings.length,
      Math.min(5, Math.max(2, Math.round(Number(maxVisibleItems) || 3)))
    );
  }, [sortedWaitings.length, maxVisibleItems]);

  // 롤링 버퍼 (원형 큐 무한 롤링을 위해 앞부분을 뒤에 이어붙임)
  const displayItems = React.useMemo(() => {
    if (!isRolling) {
      return sortedWaitings.slice(0, Math.min(10, Math.max(1, Math.round(Number(maxVisibleItems) || 3))));
    }
    return [...sortedWaitings, ...sortedWaitings.slice(0, visibleCount + 1)];
  }, [isRolling, sortedWaitings, visibleCount, maxVisibleItems]);

  // 첫 번째 아이템의 실제 렌더링 높이 측정 (반응형 폰트/패딩 호환)
  useEffect(() => {
    if (itemRef.current) {
      const h = itemRef.current.offsetHeight;
      if (h > 20) setMeasuredItemHeight(h + 6); // 높이 + gap-1.5(6px)
    }
  }, [isRolling, displayItems.length]);

  // 롤링 타이머 (2.5초마다 1칸씩 자연스럽게 슬라이드)
  useEffect(() => {
    if (!isRolling || sortedWaitings.length === 0 || activeClaim) {
      setScrollIndex(0);
      return;
    }
    const timer = setInterval(() => {
      setIsTransitioning(true);
      setScrollIndex((prev) => prev + 1);
    }, rollIntervalMs);
    return () => clearInterval(timer);
  }, [isRolling, sortedWaitings.length, rollIntervalMs, activeClaim]);

  // 원형 큐 끝에 도달했을 때 눈속임 0초 리셋 (깜빡임 없이 매끄러운 무한 롤링)
  useEffect(() => {
    if (!isRolling || sortedWaitings.length === 0) return;
    if (scrollIndex >= sortedWaitings.length) {
      const resetTimer = setTimeout(() => {
        setIsTransitioning(false);
        setScrollIndex(0);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setIsTransitioning(true);
          });
        });
      }, 500);
      return () => clearTimeout(resetTimer);
    }
  }, [scrollIndex, isRolling, sortedWaitings.length]);

  const hasWaiting = sortedWaitings.length > 0;

  // 위치 스타일 결정
  const posClass =
    position === "bottom"
      ? "bottom-4"
      : position === "center"
        ? "top-1/2 -translate-y-1/2"
        : "top-3";

  // 정렬 스타일 결정 (기본값: left 좌측 정렬)
  const alignClass =
    align === "center"
      ? "justify-center"
      : align === "right"
        ? "justify-end pr-4 sm:pr-6"
        : "justify-start pl-4 sm:pl-6";

  // 대기 목록(여러 줄) 내부 정렬
  const columnAlignClass =
    align === "center" ? "items-center" : align === "right" ? "items-end" : "items-start";

  // 크기 배율 (1 = 원본). 위치/정렬에 맞춰 변환 기준점을 잡아 화면 밖으로 밀리지 않게 한다.
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const hOrigin = align === "center" ? "center" : align === "right" ? "right" : "left";
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
          isRolling ? (
            /* 2-A. 10개 이상 밀렸을 때: 자연스러운 순환 롤링 뷰포트 */
            <div className={`flex flex-col gap-1.5 ${columnAlignClass}`}>
              {/* 상단 밀림 안내 인디케이터 배지 */}
              <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-neutral-950/90 px-3 py-1 shadow-md text-[10px] font-bold text-amber-300 backdrop-blur-md animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>🎁 대표 줍줍 대기열 ({sortedWaitings.length}개 밀림 · 순환 롤링 중)</span>
              </div>

              {/* 고정 높이 롤링 마스크 창 */}
              <div
                className="relative overflow-hidden"
                style={{
                  height: `${visibleCount * measuredItemHeight - 6}px`,
                }}
              >
                <div
                  className="flex flex-col gap-1.5 will-change-transform"
                  style={{
                    transform: `translateY(-${scrollIndex * measuredItemHeight}px)`,
                    transition: isTransitioning
                      ? "transform 500ms cubic-bezier(0.4, 0, 0.2, 1)"
                      : "none",
                  }}
                >
                  {displayItems.map((item, idx) => {
                    const itemNumber =
                      (item as any)._originalIndex !== undefined
                        ? (item as any)._originalIndex + 1
                        : idx + 1;
                    return (
                      <div
                        key={`${item.id}_${idx}`}
                        ref={idx === 0 ? itemRef : undefined}
                        className="inline-flex items-center gap-2 rounded-full border border-amber-400/60 bg-neutral-950/85 px-3.5 py-1.5 shadow-[0_2px_15px_rgba(245,158,11,0.3)] backdrop-blur-md whitespace-nowrap"
                      >
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500/20 text-xs">
                          🎁
                        </span>
                        <span className="text-[11px] font-bold text-amber-300">
                          #{itemNumber}
                        </span>
                        <span className="text-xs font-bold text-white">
                          [{item.sigName}]
                        </span>
                        <span className="font-mono text-xs font-black text-emerald-400">
                          +{item.bonusAmount.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            /* 2-B. 10개 미만 일반 대기 목록 (정적 순서대로 표시) */
            <div className={`flex flex-col gap-1.5 ${columnAlignClass}`}>
              {displayItems.map((item, idx) => {
                const waitingInfo = formatZubzubSimpleWaiting(item, 1);
                return (
                  <div
                    key={item.id}
                    ref={idx === 0 ? itemRef : undefined}
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
          )
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
