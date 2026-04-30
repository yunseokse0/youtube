"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Image from "next/image";
import type { SigItem } from "@/types";
import { resolveSigImageUrl } from "@/lib/constants";

type SigBoardRollingProps = {
  inventory: SigItem[];
  soldOutStampUrl: string;
  className?: string;
};

/** 회전판 오버레이에 포함 가능한 시그 보드(보드 노출 롤링 그리드) */
export default function SigBoardRolling({ inventory, soldOutStampUrl, className = "" }: SigBoardRollingProps) {
  const rollingItems = useMemo(() => inventory.filter((x) => x.isRolling), [inventory]);

  const pageSize = 4;
  const pageCount = Math.max(1, Math.ceil(rollingItems.length / pageSize));
  const [page, setPage] = useState(0);
  const prevSoldOutRef = useRef<Record<string, boolean>>({});
  const [stampBurstIds, setStampBurstIds] = useState<Record<string, number>>({});

  useEffect(() => {
    if (pageCount <= 1) return;
    const id = window.setInterval(() => {
      setPage((p) => (p + 1) % pageCount);
    }, 2600);
    return () => window.clearInterval(id);
  }, [pageCount]);

  useEffect(() => {
    const current: Record<string, boolean> = {};
    for (const item of rollingItems) {
      const isSoldOut = item.soldCount >= item.maxCount;
      current[item.id] = isSoldOut;
      if (isSoldOut && !prevSoldOutRef.current[item.id]) {
        setStampBurstIds((prev) => ({ ...prev, [item.id]: Date.now() }));
      }
    }
    prevSoldOutRef.current = current;
  }, [rollingItems]);

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
            className="grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            {visible.map((item) => {
              const soldOut = item.soldCount >= item.maxCount;
              const stampBurstKey = stampBurstIds[item.id] || 0;
              const pct = Math.min(100, (item.soldCount / Math.max(1, item.maxCount)) * 100);
              const isSingleSale = item.maxCount <= 1;
              return (
                <div key={item.id} className="glass-pastel-card relative overflow-hidden rounded-3xl">
                  <div className="relative aspect-[4/5] w-full">
                    <Image
                      src={resolveSigImageUrl(item.name, item.imageUrl)}
                      alt={item.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                    {soldOut && <div className="absolute inset-0 bg-pastel-ink/25" />}
                    <AnimatePresence>
                      {soldOut && (
                        <motion.div
                          key={`stamp-${item.id}-${stampBurstKey}`}
                          initial={{ scale: 2.2, rotate: -12, opacity: 0 }}
                          animate={{ scale: 1, rotate: -8, opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.35, ease: "easeOut" }}
                          className="pointer-events-none absolute left-1/2 top-1/2 flex h-32 w-32 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                        >
                          <div className="absolute inset-2 rounded-full bg-pastel-red/50 blur-[2px]" aria-hidden />
                          <motion.img
                            src={soldOutStampUrl}
                            alt="stamp"
                            className="relative z-[1] h-28 w-28 object-contain opacity-90"
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
