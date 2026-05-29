"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import type { SigItem } from "@/types";
import { resolveSigOverlayCardImageUrl } from "@/lib/constants";
import SigSaleMedia from "@/components/sig-sales/SigSaleMedia";
import SigSoldStampOverlay, { SIG_SOLD_STAMP_IMG_CLASS } from "@/components/sig-sales/SigSoldStampOverlay";
import { canonicalSigIdFromWheelSliceId, ONE_SHOT_SIG_ID, sigMatchesMemberFilter } from "@/lib/sig-roulette";

type SigBoardRollingProps = {
  inventory: SigItem[];
  soldOutStampUrl: string;
  /** 완판 외에도 현재 회차 판매 확정 시그를 강제로 sold 처리할 때 사용 */
  soldOverrideSet?: Set<string>;
  /** 시그 판매 관리와 동일: 판매 제외 ID (`sigSalesExcludedIds`) */
  sigSalesExcludedIds?: string[];
  /** 시그 판매 오버레이 `memberId`와 동일하면 해당 멤버 시그만 표시 */
  memberFilterId?: string;
  /** 디스크 업로드 URL 복구용 계정 id */
  overlayUserId?: string;
  className?: string;
  gifDelayMultiplier?: number;
  /** false면 2.6초마다 페이지가 넘어가지 않음(방송 오버레이에서 GIF+롤링 이중 움직임 방지) */
  autoAdvancePages?: boolean;
};

/** 회전판 오버레이에 포함 가능한 시그 보드(보드 노출 롤링 그리드) */
export default function SigBoardRolling({
  inventory,
  soldOutStampUrl,
  soldOverrideSet,
  sigSalesExcludedIds = [],
  memberFilterId = "",
  overlayUserId = "",
  className = "",
  gifDelayMultiplier = 1,
  autoAdvancePages = true,
}: SigBoardRollingProps) {
  /** 시그 판매 관리 `activeNormalPool`과 동일: 판매 활성·제외·멤버 (구 `isRolling` 단독 필터 제거) */
  const rollingItems = useMemo(() => {
    const excluded = new Set(sigSalesExcludedIds.map(String));
    return inventory.filter(
      (x) =>
        x.id !== ONE_SHOT_SIG_ID &&
        Boolean(x.isActive) &&
        !excluded.has(x.id) &&
        sigMatchesMemberFilter(x, memberFilterId)
    );
  }, [inventory, sigSalesExcludedIds, memberFilterId]);

  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(rollingItems.length / pageSize));
  const [page, setPage] = useState(0);
  const prevSoldOutRef = useRef<Record<string, boolean>>({});
  const [stampBurstIds, setStampBurstIds] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!autoAdvancePages) return;
    if (pageCount <= 1) return;
    const id = window.setInterval(() => {
      setPage((p) => (p + 1) % pageCount);
    }, 2600);
    return () => window.clearInterval(id);
  }, [pageCount, autoAdvancePages]);

  useEffect(() => {
    const current: Record<string, boolean> = {};
    for (const item of rollingItems) {
      const canonId = canonicalSigIdFromWheelSliceId(item.id);
      const isSoldOut =
        item.soldCount >= item.maxCount ||
        Boolean(soldOverrideSet?.has(item.id) || soldOverrideSet?.has(canonId));
      current[item.id] = isSoldOut;
      if (isSoldOut && !prevSoldOutRef.current[item.id]) {
        setStampBurstIds((prev) => ({ ...prev, [item.id]: Date.now() }));
      }
    }
    prevSoldOutRef.current = current;
  }, [rollingItems, soldOverrideSet]);

  const visible = useMemo(() => {
    const start = page * pageSize;
    return rollingItems.slice(start, start + pageSize);
  }, [page, rollingItems]);

  const allClear = rollingItems.length > 0 && rollingItems.every((x) => x.soldCount >= x.maxCount);

  if (rollingItems.length === 0) return null;

  return (
    <div className={`text-pastel-ink ${className}`.trim()}>
      <div className="mx-auto max-w-[1280px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={`page-${page}`}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -40 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="grid grid-cols-2 md:grid-cols-4 gap-1"
          >
            {visible.map((item) => {
              const canonId = canonicalSigIdFromWheelSliceId(item.id);
              const soldOut =
                item.soldCount >= item.maxCount ||
                Boolean(soldOverrideSet?.has(item.id) || soldOverrideSet?.has(canonId));
              const stampBurstKey = stampBurstIds[item.id] || 0;
              const pct = Math.min(100, (item.soldCount / Math.max(1, item.maxCount)) * 100);
              const isSingleSale = item.maxCount <= 1;
              return (
                <div key={item.id} className="glass-pastel-card relative overflow-hidden rounded-3xl">
                  <div className="relative aspect-[4/5] w-full overflow-hidden">
                    <SigSaleMedia
                      src={resolveSigOverlayCardImageUrl(item.name, item.imageUrl, overlayUserId || undefined)}
                      storedImageUrl={item.imageUrl}
                      sigImageUserId={overlayUserId || undefined}
                      alt={item.name}
                      fill
                      className={`object-contain object-center ${soldOut ? "relative z-[2]" : "relative z-0"}`}
                      gifDelayMultiplier={gifDelayMultiplier}
                    />
                    <AnimatePresence>
                      {soldOut && (
                        <motion.div
                          key={`stamp-${item.id}-${stampBurstKey}`}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.35, ease: "easeOut" }}
                          className="absolute inset-0 z-20"
                        >
                          <SigSoldStampOverlay
                            soldOutStampUrl={soldOutStampUrl}
                            stampMaxClass={`${SIG_SOLD_STAMP_IMG_CLASS} max-h-[min(8.5rem,70%)] max-w-[min(8.5rem,70%)]`}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="p-2">
                    <div className="truncate text-sm font-bold pastel-text-outline">{item.name}</div>
                    <div className="text-xs text-pastel-ink/80 pastel-text-outline">
                      {isSingleSale ? (soldOut ? "완판" : "판매대기") : `${item.soldCount}/${item.maxCount}`} ·{" "}
                      {item.price.toLocaleString("ko-KR")}원
                    </div>
                    {!isSingleSale ? (
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-pastel-blue/50">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-pastel-red via-pastel-orange to-pastel-blue"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </motion.div>
        </AnimatePresence>

        <AnimatePresence>
          {allClear && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 280, damping: 20 }}
              className="pointer-events-none fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50"
            >
              <div className="glass-pastel-card rounded-full px-10 py-4 text-5xl font-black text-pastel-ink pastel-text-outline">
                ALL CLEAR
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
