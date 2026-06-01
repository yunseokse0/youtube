"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { normalizeDonationListsOverlayConfig, type AppState } from "@/lib/state";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { readDonationListsOverlayPollMs } from "@/lib/overlay-pull-policy";
import { resolveAnimatedSourceForEmbed } from "@/lib/gif-url";
import { sortMembersForRanking } from "@/lib/utils";

function RankingTable({
  items,
}: {
  items: ReturnType<typeof sortMembersForRanking>;
}) {
  const outlinedText = {
    textShadow:
      "-1px -1px 0 rgba(0,0,0,0.7),1px -1px 0 rgba(0,0,0,0.7),-1px 1px 0 rgba(0,0,0,0.7),1px 1px 0 rgba(0,0,0,0.7)",
  } as const;

  return (
    <section className="relative z-10 w-full max-w-[980px] overflow-hidden rounded-2xl border border-white/60 bg-white/30 shadow-sm backdrop-blur-sm">
      <div className="grid grid-cols-[minmax(0,1.4fr)_120px_150px_150px_160px] gap-2 border-b border-white/70 bg-pink-pastel px-4 py-3 text-[15px] font-extrabold text-pink-deep">
        <span style={outlinedText}>멤버</span>
        <span style={outlinedText}>직급</span>
        <span className="text-right" style={outlinedText}>계좌</span>
        <span className="text-right" style={outlinedText}>투네</span>
        <span className="text-right" style={outlinedText}>합계</span>
      </div>
      <div className="space-y-2 p-3">
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
              className={`grid grid-cols-[minmax(0,1.4fr)_120px_150px_150px_160px] items-center gap-2 rounded-xl px-4 py-3 text-white shadow-sm ${
                item.isRepresentative
                  ? "border-2 border-white bg-pink-accent"
                  : idx % 2 === 0
                    ? "border border-white/70 bg-pink-light"
                    : "border border-white/70 bg-white/80"
              }`}
            >
              <span className="truncate text-[18px] font-extrabold" style={outlinedText}>{item.name}</span>
              <span className="text-[14px] font-bold" style={outlinedText}>{item.position}</span>
              <span className="text-right font-extrabold tabular-nums" style={outlinedText}>
                {item.accountAmount.toLocaleString("ko-KR")}
              </span>
              <span className="text-right font-extrabold tabular-nums" style={outlinedText}>
                {item.toonAmount.toLocaleString("ko-KR")}
              </span>
              <span className="text-right font-black tabular-nums text-[17px] text-pastel-yellow" style={outlinedText}>
                {item.totalAmount.toLocaleString("ko-KR")}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {items.length === 0 && (
          <div className="rounded-xl border border-white/70 bg-pink-light px-3 py-6 text-center text-white shadow-sm">
            <span className="font-bold" style={outlinedText}>표시할 멤버 데이터가 없습니다.</span>
          </div>
        )}
      </div>
    </section>
  );
}

export default function DonationListsOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useOverlayRemoteState(userId, {
    overlayPollMs: readDonationListsOverlayPollMs(),
  });

  const overlayCfg = useMemo(
    () => normalizeDonationListsOverlayConfig(state?.donationListsOverlayConfig),
    [state?.donationListsOverlayConfig]
  );
  const showBgLayer = overlayCfg.isBgEnabled && Boolean(overlayCfg.bgGifUrl.trim());
  const bgAnimated = useMemo(() => resolveAnimatedSourceForEmbed(overlayCfg.bgGifUrl), [overlayCfg.bgGifUrl]);
  const bgOpacityPct = Math.max(0, Math.min(100, overlayCfg.bgOpacity)) / 100;

  const ranking = useMemo(
    () =>
      sortMembersForRanking(state?.members || [], state?.memberPositions || {}, {
        mode: "fixed",
        rankPositionLabels: state?.rankPositionLabels || [],
      }),
    [state?.members, state?.memberPositions, state?.rankPositionLabels]
  );

  if (!ready) return null;

  return (
    <main className="relative min-h-screen w-full overflow-hidden bg-transparent p-6 text-white">
      {showBgLayer ? (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
          {bgAnimated.kind === "video" ? (
            <video
              src={bgAnimated.src.trim()}
              className="h-full w-full object-cover"
              style={{ opacity: bgOpacityPct }}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgAnimated.src.trim()}
                alt=""
                width={1920}
                height={1080}
                className="h-full w-full object-cover"
                style={{ opacity: bgOpacityPct }}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
            </>
          )}
        </div>
      ) : null}
      <div className="relative z-10 mx-auto max-w-[1020px]">
        <h1
          className="mb-4 text-center text-3xl font-black text-pink-deep"
          style={{
            textShadow:
              "-1px -1px 0 rgba(255,255,255,0.92),1px -1px 0 rgba(255,255,255,0.92),-1px 1px 0 rgba(255,255,255,0.92),1px 1px 0 rgba(255,255,255,0.92)",
          }}
        >
          후원 랭킹 보드
        </h1>
        <RankingTable items={ranking} />
      </div>
    </main>
  );
}

