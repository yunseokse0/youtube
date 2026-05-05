"use client";

import { motion } from "framer-motion";
import Image from "next/image";
import type { ReactNode } from "react";
import type { SigItem } from "@/types";
import { canonicalSigIdFromWheelSliceId, formatWon } from "@/lib/sig-roulette";
import { resolveSigImageUrl } from "@/lib/constants";
import SigSaleMedia from "@/components/sig-sales/SigSaleMedia";
import {
  SIG_OVERLAY_CARD_MEDIA_BOX_CLASS,
  SIG_OVERLAY_CARD_MAX_PX,
  sigOverlayBroadcastCardShellStyle,
} from "@/components/sig-sales/sig-overlay-card-size";

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
  /** GIF 프레임 배수 (1=원본, 1 초과=느림). 오버레이 `sigGifDelay`와 동일 */
  gifDelayMultiplier?: number;
  /** true: 맨 마지막으로 추가된 카드만 등장 연출(순차 공개 시 이전 카드가 다시 튀지 않게) */
  entranceOnlyLatest?: boolean;
  /**
   * 방송 오버레이: 개별 시그 카드 폭·미디어 영역을 한방 시그(compact)와 동일하게 맞춤.
   * true면 한 줄 flex-wrap + 중앙 정렬(휠 아래 동일 밴드).
   */
  matchOneShotCardSize?: boolean;
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
  gifDelayMultiplier = 1,
  entranceOnlyLatest = false,
  matchOneShotCardSize = false,
}: SelectedSigsProps) {
  /** 고정 5·6열은 카드가 적을 때도 빈 칸이 남아 미리 깔린 것처럼 보임 → 실제 개수만큼 열만 사용 */
  const trailingActive = Boolean(trailingSlot);
  const cellCount = items.length + (trailingActive ? 1 : 0);
  const columnCount = Math.min(6, Math.max(1, cellCount));
  /** 방송 오버레이(compact·토글 숨김)는 한방 카드와 같은 폭·비율을 기본 적용 */
  const broadcastMatch = Boolean(compact && (matchOneShotCardSize || !showToggle));
  /**
   * 오버레이(compact): 열을 auto → 카드 실제 너비만 차지해 순서대로 붙음(1fr면 행 전체를 나눠 간격만 벌어짐).
   * 관리 화면 등: 1fr로 균등 분할 유지.
   */
  const gridTemplateColumns = compact
    ? `repeat(${columnCount}, auto)`
    : `repeat(${columnCount}, minmax(0, 1fr))`;
  const gridAlign = compact && trailingActive ? "items-start" : "";
  const justifyCompact =
    compact && compactGridJustify === "start" ? "justify-start" : compact ? "justify-center" : "";
  return (
    <section
      className={
        broadcastMatch
          ? `flex w-full min-w-0 max-w-full flex-wrap justify-center gap-1 sm:gap-1 ${className}`.trim()
          : `grid w-full min-w-0 max-w-full gap-2 ${justifyCompact} ${gridAlign} ${className}`.trim()
      }
      style={broadcastMatch ? undefined : { gridTemplateColumns }}
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
                /** 순차 공개: 첫 장이 화면을 과하게 채우지 않도록 등장 폭·이동 완화 */
                initial: {
                  opacity: 0,
                  y: entranceOnlyLatest ? 14 : 28,
                  scale: entranceOnlyLatest ? 0.97 : 0.92,
                } as const,
                animate: { opacity: 1, y: 0, scale: 1 } as const,
                transition: {
                  delay: entranceOnlyLatest ? 0 : idx * 0.08,
                  duration: entranceOnlyLatest ? 0.28 : 0.35,
                },
              };
        return (
          <motion.article
            key={`${canonId}__slot_${idx}`}
            initial={entrance.initial}
            animate={entrance.animate}
            transition={entrance.transition}
            style={broadcastMatch ? sigOverlayBroadcastCardShellStyle() : undefined}
            className={`relative overflow-hidden rounded-xl border bg-neutral-900/70 ${
              broadcastMatch ? "" : "min-w-0"
            } ${
              broadcastMatch
                ? "shrink-0 border-white/25 bg-neutral-900/85 px-1.5 py-2 shadow-[0_0_28px_rgba(0,0,0,0.55)]"
                : compact
                  ? "w-full max-w-[188px] justify-self-start"
                  : ""
            } ${isLatestConfirmed ? "border-yellow-300 shadow-[0_0_24px_rgba(250,204,21,0.45)]" : broadcastMatch ? "" : "border-white/20"}`}
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
            <div
              className={`relative overflow-hidden rounded-lg border border-white/20 bg-black/40 ${
                broadcastMatch
                  ? SIG_OVERLAY_CARD_MEDIA_BOX_CLASS
                  : compact
                    ? "aspect-[3/4]"
                    : "aspect-[4/5]"
              }`}
            >
              {sold ? (
                <div
                  className="absolute inset-0 z-[1] rounded-[inherit] bg-white/93"
                  aria-hidden
                />
              ) : null}
              <SigSaleMedia
                src={resolveSigImageUrl(item.name, item.imageUrl)}
                alt={item.name}
                fill
                sizes={
                  broadcastMatch
                    ? `${SIG_OVERLAY_CARD_MAX_PX}px`
                    : compact
                      ? "(max-width:768px) 45vw, 188px"
                      : "240px"
                }
                className={`relative z-[2] object-cover object-center ${sold ? "brightness-[1.02]" : ""}`}
                gifDelayMultiplier={gifDelayMultiplier}
              />
              {sold ? (
                <>
                  {/* 판매 완료에서도 원본 이미지가 충분히 보이도록 전체 딤은 약하게 유지 */}
                  <div className="absolute inset-0 z-[5] bg-black/18" aria-hidden />
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-[min(12%,1rem)]">
                    <Image
                      src={soldOutStampUrl}
                      alt="판매 완료"
                      width={112}
                      height={112}
                      unoptimized
                      className="relative h-auto w-auto max-h-[min(7.6rem,64%)] max-w-[min(7.6rem,64%)] object-contain object-center opacity-95 drop-shadow-[0_2px_6px_rgba(0,0,0,0.42)]"
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div
              className={`${
                broadcastMatch ? "space-y-0.5 px-1 pt-1" : compact ? "space-y-0 p-1" : "space-y-1 p-2"
              }`}
            >
              <div
                className={`truncate font-bold text-white ${broadcastMatch ? "text-[11px] leading-tight sm:text-[12px]" : compact ? "text-[10px]" : "text-sm"}`}
              >
                {item.name}
              </div>
              <div
                className={`${
                  broadcastMatch
                    ? "text-xs font-black tabular-nums text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.88)] sm:text-[13px]"
                    : compact
                      ? "text-[9px] font-semibold tabular-nums text-neutral-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
                      : "text-xs font-semibold tabular-nums text-neutral-50 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]"
                }`}
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
        <div
          style={broadcastMatch ? sigOverlayBroadcastCardShellStyle() : undefined}
          className={
            broadcastMatch
              ? "flex min-h-0 shrink-0 justify-center pt-0.5"
              : compact
                ? "flex min-h-0 min-w-0 max-w-full justify-start pt-0.5"
                : "min-h-[280px]"
          }
        >
          {trailingSlot}
        </div>
      ) : null}
    </section>
  );
}
