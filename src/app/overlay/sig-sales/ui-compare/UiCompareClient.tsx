"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import ResultOverlay from "@/components/sig-sales/ResultOverlay";
import { DEFAULT_SIG_SOLD_STAMP_URL, resolveSigImageUrl } from "@/lib/constants";
import {
  buildWheelSlicesOnePerSig,
  canonicalSigIdFromWheelSliceId,
  ONE_SHOT_SIG_ID,
} from "@/lib/sig-roulette";
import { WHEEL_DEMO_SIG_POOL } from "@/lib/sig-wheel-demo-pool";
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";
import type { SigItem } from "@/types";

const RouletteWheel = dynamic(() => import("@/components/sig-sales/RouletteWheel"), {
  ssr: false,
});

const DUMMY_SIG_IMAGE = "/images/sigs/dummy-sig.svg";

function slicePool(n: number): SigItem[] {
  return WHEEL_DEMO_SIG_POOL.slice(0, Math.max(1, Math.min(WHEEL_DEMO_SIG_POOL.length, n)));
}

function buildWinners(pool: SigItem[], winCount: number): SigItem[] {
  const n = Math.max(1, Math.min(pool.length, winCount));
  return Array.from({ length: n }, (_, i) => ({
    id: `preview_win_${i + 1}`,
    name: pool[i]?.name || `시그 ${i + 1}`,
    price: pool[i]?.price || (i + 1) * 35000,
    imageUrl: pool[i]?.imageUrl || DUMMY_SIG_IMAGE,
    memberId: "",
    maxCount: 1,
    soldCount: 0,
    isRolling: true,
    isActive: true,
  }));
}

function CompareColumn({ poolSize, winCount }: { poolSize: number; winCount: number }) {
  const pool = useMemo(() => slicePool(poolSize), [poolSize]);
  const wheelSlices = useMemo(() => buildWheelSlicesOnePerSig(pool), [pool]);
  const winners = useMemo(() => buildWinners(pool, winCount), [pool, winCount]);
  const oneShot = useMemo(() => {
    if (winCount < 2) return null;
    const price = winners.reduce((s, x) => s + x.price, 0);
    return { name: "한방 시그", price };
  }, [winCount, winners]);
  const cardCount = winners.length + (oneShot ? 1 : 0);
  const rowLayout = useMemo(
    () => layoutSigOverlayResultRow({ cellCount: cardCount, userScalePct: 78, maxRowWidthPx: 1080 }),
    [cardCount]
  );
  const soldSet = useMemo(() => {
    const next = new Set<string>();
    for (const w of winners) {
      next.add(w.id);
      next.add(canonicalSigIdFromWheelSliceId(w.id));
    }
    if (oneShot) {
      next.add(ONE_SHOT_SIG_ID);
      next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
    }
    return next;
  }, [winners, oneShot]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-white/15 bg-black/40 p-4">
      <header>
        <h2 className="text-lg font-black text-yellow-200">
          판매 가능 {poolSize}개 · 당첨 {winCount}개
        </h2>
        <p className="text-xs text-neutral-400">
          회전판 {wheelSlices.length}칸(판매 가능 전체) · 당첨 카드 {winners.length}개 · scale{" "}
          {rowLayout.cardScalePct}% · 한방 {oneShot ? "표시" : "없음"}
        </p>
      </header>
      <div className="flex justify-center">
        <RouletteWheel
          items={wheelSlices}
          isRolling={false}
          resultId={null}
          startedAt={0}
          hideSliceLabels
          scalePct={100}
          volume={0}
          muted
        />
      </div>
      <div className="mx-auto w-full max-w-[1080px] overflow-x-auto">
        <ResultOverlay
          visible
          selectedSigs={winners}
          soldOutStampUrl={DEFAULT_SIG_SOLD_STAMP_URL}
          soldOverrideSet={soldSet}
          oneShot={oneShot}
          signImageUrl={resolveSigImageUrl("한방 시그", DUMMY_SIG_IMAGE)}
          showOneShotReveal={Boolean(oneShot)}
          cardScalePct={rowLayout.cardScalePct}
          disableCardMotion
          skipHanbangSignLoadingOverlay
          className="w-full"
        />
      </div>
    </section>
  );
}

export default function UiCompareClient() {
  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-6 text-white sm:px-6">
      <header className="mx-auto mb-6 max-w-[2200px]">
        <h1 className="text-2xl font-black text-sky-200">시그 판매 UI 비교 (로컬)</h1>
        <p className="mt-1 text-sm text-neutral-400">
          회전판 = 판매 가능 시그 전체 · 당첨 카드만 개수(10/20)에 따라 달라짐
        </p>
        <p className="mt-2 text-xs text-neutral-500">
          <Link href="/overlay/sig-sales/result-preview?count=10" className="text-sky-300 underline">
            결과만 10개
          </Link>
          {" · "}
          <Link href="/overlay/sig-sales/result-preview?count=20" className="text-sky-300 underline">
            결과만 20개
          </Link>
          {" · "}
          <Link href="/overlay/sig-sales/wheel-demo" className="text-sky-300 underline">
            휠 데모
          </Link>
        </p>
      </header>
      <div className="mx-auto grid max-w-[2200px] gap-6 lg:grid-cols-2">
        <CompareColumn poolSize={20} winCount={10} />
        <CompareColumn poolSize={20} winCount={20} />
      </div>
    </main>
  );
}
