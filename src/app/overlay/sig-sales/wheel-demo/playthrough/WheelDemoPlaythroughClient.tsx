"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { SigItem } from "@/types";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import ConfirmationModal from "@/components/sig-sales/ConfirmationModal";
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";
import { DEFAULT_SIG_SOLD_STAMP_URL, resolveSigImageUrl } from "@/lib/constants";
import {
  bindWheelAnimationToRoundWinner,
  formatWheelSegmentLabel,
  rememberUsedWheelSliceId,
  resolveWheelSlicesForSpinVisual,
  sanitizeWheelDisplayName,
  wheelSliceMatchesServerWinner,
} from "@/lib/sig-roulette";
import {
  WHEEL_DEMO_MENU_COUNT,
  WHEEL_DEMO_WIN_COUNT,
  buildWheelDemoOneShotFromWinners,
  buildWheelDemoWinnerQueueForAlignment,
  getSigSalesWheelDemoOverlayPath,
  getWheelDemoOverlayPath,
  WHEEL_DEMO_SIG_POOL,
} from "@/lib/sig-wheel-demo-pool";

const RouletteWheel = dynamic(() => import("@/components/sig-sales/RouletteWheel"), { ssr: false });

const STEP_PAUSE_MS = 2800;

type WheelPhase = "idle" | "spinning" | "settling" | "result";
const wheelReducer = (s: WheelPhase, a: { type: string }): WheelPhase => {
  switch (a.type) {
    case "START_SPIN":
      return "spinning";
    case "SETTLING":
      return s === "spinning" ? "settling" : s;
    case "LANDED":
      return "result";
    case "RESET":
      return "idle";
    default:
      return s;
  }
};

function getWheelLabel(item: SigItem, segmentCount: number): string {
  const raw = sanitizeWheelDisplayName(item.name) || item.id;
  return formatWheelSegmentLabel(raw, segmentCount);
}

export default function WheelDemoPlaythroughClient() {
  const sp = useSearchParams();
  const autoRun = sp.get("auto") === "1";
  const menuSlices = useMemo(
    () =>
      resolveWheelSlicesForSpinVisual({
        menuPool: WHEEL_DEMO_SIG_POOL,
        menuCount: WHEEL_DEMO_MENU_COUNT,
        winnersOnly: false,
        winnerQueue: [],
        pinnedSlices: null,
      }),
    []
  );

  const [winners] = useState<SigItem[]>(() =>
    buildWheelDemoWinnerQueueForAlignment({ preset: "spread" })
  );
  const [roundIndex, setRoundIndex] = useState(0);
  const [revealed, setRevealed] = useState<SigItem[]>([]);
  const [oneShotReveal, setOneShotReveal] = useState(false);
  const [salesDone, setSalesDone] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [manualSold, setManualSold] = useState<Set<string>>(new Set());
  const [oneShotSold, setOneShotSold] = useState(false);
  const [demoInventory, setDemoInventory] = useState<SigItem[]>(() =>
    WHEEL_DEMO_SIG_POOL.map((x) => ({ ...x }))
  );
  const [wheelPhase, dispatch] = useReducer(wheelReducer, "idle");
  const [spinStartedAt, setSpinStartedAt] = useState(0);
  const [spinReplayNonce, setSpinReplayNonce] = useState(0);
  const [sessionStarted, setSessionStarted] = useState(false);
  const usedSliceIdsRef = useRef<Set<string>>(new Set());
  const landCommittedRef = useRef(false);
  const nextSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allRoundsComplete = revealed.length >= winners.length;
  const currentWinner = winners[roundIndex] ?? null;
  const priorWinners = useMemo(() => winners.slice(0, roundIndex), [winners, roundIndex]);
  const oneShot = useMemo(() => buildWheelDemoOneShotFromWinners(winners), [winners]);
  const resultRowLayout = useMemo(
    () =>
      layoutSigOverlayResultRow({
        cellCount: revealed.length + (oneShotReveal ? 1 : 0),
        userScalePct: 78,
      }),
    [revealed.length, oneShotReveal]
  );
  const oneShotImageUrl = useMemo(
    () => resolveSigImageUrl(oneShot.name, undefined, "finalent"),
    [oneShot.name]
  );

  const wheelBinding = useMemo(() => {
    if (!currentWinner || !sessionStarted) {
      return {
        items: menuSlices,
        animationResultId: null as string | null,
        targetSliceIndex: null as number | null,
        sliceId: null as string | null,
      };
    }
    const bound = bindWheelAnimationToRoundWinner({
      wheelSlices: menuSlices,
      roundWinner: currentWinner,
      roundIndex,
      usedSliceIds: usedSliceIdsRef.current,
      priorWinners,
    });
    return {
      items: bound.items,
      animationResultId: bound.animationResultId,
      targetSliceIndex: bound.targetSliceIndex,
      sliceId: bound.sliceId,
    };
  }, [menuSlices, currentWinner, roundIndex, priorWinners, sessionStarted]);

  const targetIndex = wheelBinding.targetSliceIndex ?? -1;
  const wheelSpinning = wheelPhase === "spinning" || wheelPhase === "settling";
  const wheelKeepsMounted =
    wheelSpinning || (wheelPhase === "result" && Boolean(wheelBinding.animationResultId));

  const resetAll = useCallback(() => {
    if (nextSpinTimerRef.current) {
      clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = null;
    }
    setRoundIndex(0);
    setRevealed([]);
    setOneShotReveal(false);
    setSalesDone(false);
    setShowConfirm(false);
    setManualSold(new Set());
    setOneShotSold(false);
    setDemoInventory(WHEEL_DEMO_SIG_POOL.map((x) => ({ ...x })));
    usedSliceIdsRef.current = new Set();
    landCommittedRef.current = false;
    setSpinStartedAt(0);
    setSpinReplayNonce(0);
    setSessionStarted(false);
    dispatch({ type: "RESET" });
  }, []);

  const startRound = useCallback(
    (idx: number) => {
      const winner = winners[idx];
      if (!winner) return;
      const bound = bindWheelAnimationToRoundWinner({
        wheelSlices: menuSlices,
        roundWinner: winner,
        roundIndex: idx,
        usedSliceIds: usedSliceIdsRef.current,
        priorWinners: winners.slice(0, idx),
      });
      if (
        !bound.animationResultId ||
        !wheelSliceMatchesServerWinner(bound.animationResultId, winner)
      ) {
        console.error("[playthrough] 바인딩 실패", winner.name);
        return;
      }
      setRoundIndex(idx);
      landCommittedRef.current = false;
      setSpinStartedAt(Date.now());
      setSpinReplayNonce((n) => n + 1);
      dispatch({ type: "START_SPIN" });
    },
    [winners, menuSlices]
  );

  const beginSession = useCallback(() => {
    resetAll();
    setSessionStarted(true);
    startRound(0);
  }, [resetAll, startRound]);

  const commitLand = useCallback(
    (landedId: string | null | undefined) => {
      if (!currentWinner || landCommittedRef.current) return;
      landCommittedRef.current = true;
      const trusted = wheelBinding.sliceId || landedId || wheelBinding.animationResultId;
      rememberUsedWheelSliceId(usedSliceIdsRef.current, trusted);
      setRevealed((prev) => {
        if (prev.some((x) => x.id === currentWinner.id)) return prev;
        return [...prev, { ...currentWinner }];
      });
      dispatch({ type: "LANDED" });

      const isLast = roundIndex >= winners.length - 1;
      if (isLast) {
        window.setTimeout(() => setOneShotReveal(true), 400);
        return;
      }
      if (nextSpinTimerRef.current) clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = setTimeout(() => {
        const next = roundIndex + 1;
        setRoundIndex(next);
        startRound(next);
      }, STEP_PAUSE_MS);
    },
    [currentWinner, wheelBinding, roundIndex, winners.length, startRound]
  );

  const confirmDemoSale = useCallback(() => {
    setShowConfirm(false);
    const canon = new Set(revealed.map((x) => x.id));
    setDemoInventory((prev) =>
      prev.map((item) => {
        if (!canon.has(item.id)) return item;
        return {
          ...item,
          soldCount: Math.min(item.maxCount, Math.max(0, item.soldCount) + 1),
        };
      })
    );
    setManualSold(new Set(revealed.map((x) => x.id)));
    setOneShotSold(true);
    setSalesDone(true);
    dispatch({ type: "RESET" });
  }, [revealed]);

  useEffect(() => {
    if (!autoRun) return;
    if (sessionStarted) return;
    beginSession();
  }, [autoRun, sessionStarted, beginSession]);

  useEffect(
    () => () => {
      if (nextSpinTimerRef.current) clearTimeout(nextSpinTimerRef.current);
    },
    []
  );

  const canConfirm = allRoundsComplete && oneShotReveal && !salesDone;

  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <header className="mx-auto mb-4 max-w-5xl">
        <h1 className="text-lg font-bold">시그 판매 연출 데모</h1>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          회전판 {WHEEL_DEMO_MENU_COUNT}칸 · 당첨 {WHEEL_DEMO_WIN_COUNT}회 순차 스핀 · 한방 시그 · 데모 판매
          확정. 서버/API 없이 로컬만 동작합니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40"
            disabled={wheelSpinning || (sessionStarted && !allRoundsComplete && !salesDone)}
            onClick={() => (salesDone || allRoundsComplete ? resetAll() : beginSession())}
          >
            {!sessionStarted ? "5회전 + 한방 시작" : salesDone || allRoundsComplete ? "처음부터 다시" : "진행 중…"}
          </button>
          <Link
            href={getWheelDemoOverlayPath()}
            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            착지 정합 점검
          </Link>
          <Link
            href={getSigSalesWheelDemoOverlayPath("finalent")}
            className="rounded border border-sky-500/40 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-950/40"
            target="_blank"
            rel="noopener noreferrer"
          >
            OBS 통합 오버레이
          </Link>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          자동 시작: <code className="text-neutral-300">?auto=1</code> · 관리자 판매 연습:{" "}
          <Link href="/admin/sig-sales" className="text-emerald-300 underline">
            /admin/sig-sales
          </Link>{" "}
          (로컬에서 휠 데모 모드 자동)
        </p>
        <ul className="mt-2 text-[11px] text-neutral-400">
          {winners.map((w, i) => (
            <li key={w.id}>
              R{i + 1}: {sanitizeWheelDisplayName(w.name)}
            </li>
          ))}
          <li className="text-yellow-200/90">
            한방: {oneShot.price.toLocaleString("ko-KR")}원 (합산)
          </li>
        </ul>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="flex flex-col items-center">
          <p className="mb-2 text-center text-sm text-neutral-300">
            회차 {Math.min(roundIndex + 1, winners.length)} / {winners.length}
            {currentWinner && wheelSpinning ? (
              <>
                {" "}
                · <span className="text-yellow-200">{sanitizeWheelDisplayName(currentWinner.name)}</span>
              </>
            ) : null}
            {salesDone ? <span className="text-emerald-400"> · 판매 확정 완료</span> : null}
          </p>
          {sessionStarted ? (
            <RouletteWheel
              spinReplayNonce={spinReplayNonce}
              items={wheelBinding.items}
              getLabel={(item) => getWheelLabel(item, wheelBinding.items.length)}
              isRolling={wheelSpinning}
              resultId={wheelKeepsMounted ? wheelBinding.animationResultId : null}
              targetSliceIndex={targetIndex >= 0 ? targetIndex : null}
              startedAt={spinStartedAt}
              scalePct={100}
              volume={0}
              muted
              onTransitionEnd={() => {
                if (wheelPhase !== "spinning") return;
                if (landCommittedRef.current) return;
                dispatch({ type: "SETTLING" });
              }}
              onLanded={(landedId) => {
                commitLand(landedId ?? wheelBinding.animationResultId);
              }}
            />
          ) : (
            <div className="flex h-[360px] w-full max-w-md items-center justify-center rounded-xl border border-dashed border-white/15 text-sm text-neutral-500">
              「5회전 + 한방 시작」을 누르세요
            </div>
          )}

          {revealed.length > 0 ? (
            <div className="mt-4 w-full max-w-full px-1" style={resultRowLayout.bandStyle}>
              <SelectedSigs
                items={revealed}
                sigImageUserId="finalent"
                soldOutStampUrl={DEFAULT_SIG_SOLD_STAMP_URL}
                manualSoldSet={manualSold}
                disabled={salesDone}
                highlightId={revealed[revealed.length - 1]?.id ?? null}
                compact
                matchOneShotCardSize
                cardScalePct={resultRowLayout.cardScalePct}
                compactGridJustify="center"
                className="w-full max-w-full"
                trailingSlot={
                  oneShotReveal ? (
                    <OneShotSigCard
                      name={oneShot.name}
                      price={oneShot.price}
                      imageUrl={oneShotImageUrl}
                      sigImageUserId="finalent"
                      sold={oneShotSold}
                      soldOutStampUrl={DEFAULT_SIG_SOLD_STAMP_URL}
                      selectedSigCount={revealed.length}
                      disabled={salesDone}
                      compact
                      matchSigCardSize
                      cardScalePct={resultRowLayout.cardScalePct}
                      showToggle
                      onToggleSold={() => setOneShotSold((v) => !v)}
                    />
                  ) : null
                }
                onToggleSold={(id) =>
                  setManualSold((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
            </div>
          ) : null}

          {canConfirm ? (
            <button
              type="button"
              className="mt-4 rounded bg-emerald-600 px-5 py-2.5 text-sm font-bold hover:bg-emerald-500"
              onClick={() => setShowConfirm(true)}
            >
              판매 확정 (데모)
            </button>
          ) : null}
        </section>

        <aside className="space-y-3 text-xs">
          <div className="rounded-lg border border-white/15 bg-neutral-900/80 p-3">
            <div className="font-semibold text-neutral-200">진행</div>
            <p className="mt-2 text-neutral-400">
              {sessionStarted
                ? allRoundsComplete && oneShotReveal
                  ? salesDone
                    ? "판매 확정 완료"
                    : "5회 착지 + 한방 — 판매 확정 가능"
                  : wheelSpinning
                    ? "회전 중…"
                    : "다음 회차 대기"
                : "대기"}
            </p>
          </div>
          <div className="rounded-lg border border-white/15 bg-neutral-900/80 p-3">
            <div className="mb-2 font-semibold text-neutral-200">데모 재고 (+1 반영)</div>
            <ul className="max-h-[320px] space-y-1 overflow-y-auto text-[10px] text-neutral-300">
              {demoInventory.map((item) => (
                <li key={item.id} className="flex justify-between gap-2">
                  <span className="truncate">{item.name}</span>
                  <span className="shrink-0 tabular-nums">
                    {item.soldCount}/{item.maxCount}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      <ConfirmationModal
        open={showConfirm}
        loading={false}
        onCancel={() => setShowConfirm(false)}
        onConfirm={confirmDemoSale}
      />
    </main>
  );
}
