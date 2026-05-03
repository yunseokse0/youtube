"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import type { ReactNode } from "react";
import type { SigItem } from "@/types";
import { canonicalSigIdFromWheelSliceId, formatWon } from "@/lib/sig-roulette";
import { resolveSigImageUrl } from "@/lib/constants";
import SigSaleMedia from "@/components/sig-sales/SigSaleMedia";

type SelectedSigsProps = {
  items: SigItem[];
  soldOutStampUrl: string;
  manualSoldSet: Set<string>;
  onToggleSold: (id: string) => void;
  disabled?: boolean;
  trailingSlot?: ReactNode;
  highlightId?: string | null;
  showToggle?: boolean;
  soldOverrideSet?: Set<string>;
  compact?: boolean;
  /** 오버레이 등: 당첨 카드를 왼쪽 정렬 */
  compactGridJustify?: "center" | "start";
  showConfirmedBadge?: boolean;
  className?: string;
  /** GIF 시그 프레임 유지 배수 (오버레이 `sigGifDelay` 등과 동일 의미, 기본 3.5) */
  gifDelayMultiplier?: number;
  /** true: 맨 마지막으로 추가된 카드만 등장 연출(순차 공개 시 이전 카드가 다시 튀지 않게) */
  entranceOnlyLatest?: boolean;
};

export default function SelectedSigs({
  items,
  soldOutStampUrl,
  manualSoldSet,
  onToggleSold,
  disabled = false,
  trailingSlot,
  highlightId = null,
  showToggle = true,
  soldOverrideSet,
  compact = false,
  compactGridJustify = "center",
  showConfirmedBadge = true,
  className = "",
  gifDelayMultiplier = 3.5,
  entranceOnlyLatest = false,
}: SelectedSigsProps) {
  /** 고정 5·6열은 카드가 적을 때도 빈 칸이 남아 미리 깔린 것처럼 보임 → 실제 개수만큼 열만 사용 */
  const trailingActive = Boolean(trailingSlot);
  const cellCount = items.length + (trailingActive ? 1 : 0);
  const columnCount = Math.min(6, Math.max(1, cellCount));
  /** compact(오버레이): 1fr 이면 당첨 1개일 때 한 칸이 1120px까지 늘어나 이미지가 비정상적으로 큼 → 열 너비 상한 */
  const gridTemplateColumns = compact
    ? `repeat(${columnCount}, minmax(0, min(10.5rem, 46vw)))`
    : `repeat(${columnCount}, minmax(0, 1fr))`;
  const gridAlign = compact && trailingActive ? "items-start" : "";
  const justifyCompact =
    compact && compactGridJustify === "start" ? "justify-start" : compact ? "justify-center" : "";
  return (
    <section
      className={`grid w-full gap-1.5 ${justifyCompact} ${gridAlign} ${className}`.trim()}
      style={{ gridTemplateColumns }}
    >
      {items.map((item, idx) => {
        const canonId = canonicalSigIdFromWheelSliceId(item.id);
        const sold = soldOverrideSet
          ? soldOverrideSet.has(item.id) || soldOverrideSet.has(canonId)
          : manualSoldSet.has(item.id) || manualSoldSet.has(canonId);
        const isLatestConfirmed = highlightId === item.id;
        const latestIdx = items.length - 1;
        const isNewest = idx === latestIdx;
        const entrance =
          entranceOnlyLatest && !isNewest
            ? { initial: false as const, animate: undefined, transition: undefined }
            : {
                initial: { opacity: 0, y: 28, scale: 0.92 } as const,
                animate: { opacity: 1, y: 0, scale: 1 } as const,
                transition: { delay: entranceOnlyLatest ? 0 : idx * 0.08, duration: 0.35 },
              };
        return (
          <motion.article
            key={`${canonId}__slot_${idx}`}
            initial={entrance.initial}
            animate={entrance.animate}
            transition={entrance.transition}
            className={`relative overflow-hidden rounded-xl border bg-neutral-900/70 ${isLatestConfirmed ? "border-yellow-300 shadow-[0_0_24px_rgba(250,204,21,0.45)]" : "border-white/20"}`}
          >
            {showConfirmedBadge ? (
              <div className="absolute left-2 top-2 z-20 rounded bg-emerald-600/90 px-2 py-0.5 text-[10px] font-black text-white">
                확정
              </div>
            ) : null}
            {isLatestConfirmed ? (
              <motion.div
                className="pointer-events-none absolute inset-0 z-10 border-2 border-yellow-300/85"
                initial={{ opacity: 0.1 }}
                animate={{ opacity: [0.15, 0.9, 0.2] }}
                transition={{ duration: 0.9, repeat: 1 }}
              />
            ) : null}
            <div className={`relative overflow-hidden ${compact ? "aspect-[3/4]" : "aspect-[4/5]"}`}>
              <SigSaleMedia
                src={resolveSigImageUrl(item.name, item.imageUrl)}
                alt={item.name}
                fill
                sizes={compact ? "(max-width:768px) 40vw, 168px" : "240px"}
                className="object-cover object-center"
                gifDelayMultiplier={gifDelayMultiplier}
              />
              {sold ? (
                <>
                  <div className="absolute inset-0 z-[5] bg-black/45" aria-hidden />
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[min(12%,1rem)]">
                    <Image
                      src={soldOutStampUrl}
                      alt="판매 완료"
                      width={112}
                      height={112}
                      unoptimized
                      className="h-auto w-auto max-h-[min(7rem,55%)] max-w-[min(7rem,55%)] object-contain object-center"
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div className={`${compact ? "space-y-0 p-1" : "space-y-1 p-2"}`}>
              <div className={`truncate font-bold text-white ${compact ? "text-[9px]" : "text-sm"}`}>{item.name}</div>
              <div
                className={`${compact ? "text-[8px]" : "text-xs"} font-semibold tabular-nums text-neutral-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]`}
              >
                {formatWon(item.price)}
              </div>
              {showToggle ? (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleSold(item.id)}
                  className={`w-full rounded px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${sold ? "bg-rose-700/85 text-white" : "bg-emerald-700/85 text-white"}`}
                >
                  {sold ? "판매 취소" : "판매 완료"}
                </button>
              ) : null}
            </div>
          </motion.article>
        );
      })}
      {trailingSlot ? (
        <div className={compact ? "flex min-h-0 justify-center pt-0.5" : "min-h-[280px]"}>{trailingSlot}</div>
      ) : null}
    </section>
  );
}
