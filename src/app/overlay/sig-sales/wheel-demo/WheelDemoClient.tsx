"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { SigItem } from "@/types";
import {
  bindWheelAnimationToRoundWinner,
  buildWheelRoundAlignmentReport,
  canonicalSigIdFromWheelSliceId,
  formatWheelSegmentLabel,
  wheelRotationNormForSliceIndex,
  rememberUsedWheelSliceId,
  resolveWheelSlicesForSpinVisual,
  sanitizeWheelDisplayName,
  wheelRotationNormForTargetSlice,
  wheelSliceMatchesServerWinner,
  type WheelRoundAlignmentReport,
  type WheelRenderSyncReport,
} from "@/lib/sig-roulette";
import {
  WHEEL_DEMO_MENU_COUNT,
  WHEEL_DEMO_SIG_POOL,
  WHEEL_DEMO_WIN_COUNT,
  buildWheelDemoWinnerQueueForAlignment,
  getWheelDemoPlaythroughAutoPath,
  getWheelDemoPlaythroughPath,
  getSigSalesWheelDemoOverlayPath,
} from "@/lib/sig-wheel-demo-pool";

const RouletteWheel = dynamic(() => import("@/components/sig-sales/RouletteWheel"), {
  ssr: false,
});

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

type QueuePreset = "spread" | "duplicate2" | "duplicate3" | "random";

function getWheelLabel(item: SigItem, segmentCount: number): string {
  const raw = sanitizeWheelDisplayName(item.name) || item.id;
  return formatWheelSegmentLabel(raw, segmentCount);
}

export default function WheelDemoClient() {
  const sp = useSearchParams();
  const autoRun = sp.get("auto") === "1";
  const [queuePreset, setQueuePreset] = useState<QueuePreset>("spread");
  const [winners, setWinners] = useState<SigItem[]>(() =>
    buildWheelDemoWinnerQueueForAlignment({ preset: "spread" })
  );
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
  const segmentCount = menuSlices.length;

  const [roundIndex, setRoundIndex] = useState(0);
  const [reports, setReports] = useState<WheelRoundAlignmentReport[]>([]);
  const [pendingReport, setPendingReport] = useState<WheelRoundAlignmentReport | null>(null);
  const [renderSyncReport, setRenderSyncReport] = useState<WheelRenderSyncReport | null>(null);
  const [wheelPhase, dispatch] = useReducer(wheelReducer, "idle");
  const [spinStartedAt, setSpinStartedAt] = useState(0);
  const [spinReplayNonce, setSpinReplayNonce] = useState(0);
  const usedSliceIdsRef = useRef<Set<string>>(new Set());
  const landCommittedRef = useRef(false);
  const sessionDone = roundIndex >= winners.length;

  const currentWinner = winners[roundIndex] ?? null;
  const priorWinners = useMemo(
    () => winners.slice(0, roundIndex),
    [winners, roundIndex]
  );

  const wheelBinding = useMemo(() => {
    if (!currentWinner) {
      return {
        items: menuSlices,
        sliceId: null as string | null,
        targetSliceIndex: null as number | null,
        animationResultId: null as string | null,
        duplicatePick: 0,
      };
    }
    return bindWheelAnimationToRoundWinner({
      wheelSlices: menuSlices,
      roundWinner: currentWinner,
      roundIndex,
      usedSliceIds: usedSliceIdsRef.current,
      priorWinners,
    });
  }, [menuSlices, currentWinner, roundIndex, priorWinners]);

  const targetIndex = wheelBinding.targetSliceIndex ?? -1;

  /** 확정 시그(서버 큐) ↔ 이번 회전 `resultId` — 일치할 때만 스핀 */
  const spinTargetReady =
    Boolean(currentWinner) &&
    Boolean(wheelBinding.animationResultId) &&
    wheelSliceMatchesServerWinner(wheelBinding.animationResultId, currentWinner);

  const targetWheelLabel =
    targetIndex >= 0
      ? getWheelLabel(wheelBinding.items[targetIndex]!, wheelBinding.items.length)
      : "—";

  const sliceMap = useMemo(() => {
    return wheelBinding.items.map((item, idx) => {
      const isTarget = idx === targetIndex && wheelPhase !== "idle";
      const isLanded =
        pendingReport?.pointerIndex === idx ||
        reports.some((r) => r.roundIndex < roundIndex && r.pointerIndex === idx);
      return {
        idx,
        id: item.id,
        canon: canonicalSigIdFromWheelSliceId(item.id),
        label: getWheelLabel(item, wheelBinding.items.length),
        isTarget,
        isLanded,
      };
    });
  }, [wheelBinding.items, targetIndex, wheelPhase, pendingReport, reports, roundIndex]);

  const passCount = reports.filter((r) => r.ok).length;
  const failCount = reports.length - passCount;

  const resetSession = useCallback((preset: QueuePreset) => {
    const next =
      preset === "random"
        ? buildWheelDemoWinnerQueueForAlignment()
        : buildWheelDemoWinnerQueueForAlignment({ preset });
    setQueuePreset(preset);
    setWinners(next);
    setRoundIndex(0);
    setReports([]);
    setPendingReport(null);
    setRenderSyncReport(null);
    usedSliceIdsRef.current = new Set();
    setSpinStartedAt(0);
    setSpinReplayNonce(0);
    dispatch({ type: "RESET" });
  }, []);

  const startRound = useCallback(
    (idx: number) => {
      if (idx >= winners.length) return;
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
        console.error("[wheel-demo] 확정 시그와 휠 착지 칸이 맞지 않아 스핀을 시작하지 않습니다.", {
          winner: winner.name,
          animationResultId: bound.animationResultId,
        });
        return;
      }
      setRoundIndex(idx);
      setPendingReport(null);
      landCommittedRef.current = false;
      setRenderSyncReport(null);
      setSpinStartedAt(Date.now());
      setSpinReplayNonce((n) => n + 1);
      dispatch({ type: "START_SPIN" });
    },
    [winners, menuSlices]
  );

  const commitLand = useCallback(
    (
      landedId: string | null | undefined,
      pointerRotationDeg?: number,
      visualPointerIndex?: number,
      motionDesyncDeg?: number | null,
      renderSync?: WheelRenderSyncReport | null
    ) => {
      if (!currentWinner) return;
      if (landCommittedRef.current) return;
      landCommittedRef.current = true;
      const landDeg =
        pointerRotationDeg != null && Number.isFinite(pointerRotationDeg)
          ? pointerRotationDeg
          : wheelRotationNormForTargetSlice(
              wheelBinding.items,
              wheelBinding.sliceId ?? landedId ?? wheelBinding.animationResultId
            ) ?? undefined;
      const resolvedVisual =
        visualPointerIndex != null && Number.isFinite(visualPointerIndex)
          ? Math.floor(visualPointerIndex)
          : -1;
      const report = buildWheelRoundAlignmentReport({
        wheelItems: wheelBinding.items,
        serverWinner: currentWinner,
        targetSliceId: wheelBinding.sliceId,
        animationResultId: wheelBinding.animationResultId,
        landedSliceId: wheelBinding.sliceId ?? landedId ?? null,
        pointerRotationDeg: landDeg,
        visualPointerIndex: resolvedVisual,
        motionDesyncDeg,
        roundIndex,
        getLabel: (item) => getWheelLabel(item, wheelBinding.items.length),
      });
      setPendingReport(report);
      setRenderSyncReport(renderSync ?? null);
      setReports((prev) => [...prev, report]);
      const trusted =
        report.matchesWinner && landedId
          ? landedId
          : wheelBinding.sliceId || wheelBinding.animationResultId;
      rememberUsedWheelSliceId(usedSliceIdsRef.current, trusted);
      dispatch({ type: "LANDED" });
    },
    [currentWinner, wheelBinding, roundIndex]
  );

  useEffect(() => {
    if (!autoRun) return;
    if (sessionDone) return;
    if (wheelPhase !== "idle") return;
    if (roundIndex === 0 && reports.length === 0) {
      startRound(0);
    }
  }, [autoRun, sessionDone, wheelPhase, roundIndex, reports.length, startRound]);

  /** 스핀·감속·착지 검증이 끝날 때까지 resultId 유지 (`result` 에서만 연출 종료) */
  const wheelActive =
    wheelPhase !== "idle" && Boolean(wheelBinding.animationResultId);
  const wheelSpinning = wheelPhase === "spinning" || wheelPhase === "settling";
  const wheelKeepsWheelMounted =
    wheelSpinning || (wheelPhase === "result" && Boolean(wheelBinding.animationResultId));

  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <header className="mx-auto mb-4 max-w-5xl">
        <h1 className="text-lg font-bold text-white">휠 착지 정합 점검</h1>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          <strong className="text-white">확정 시그</strong>를 먼저 정한 뒤, 프로덕션과 동일한{" "}
          <code className="text-emerald-300">bindWheelAnimationToRoundWinner</code> 로 착지 칸·
          <code className="text-emerald-300">resultId</code>를 고정하고 그때만 회전합니다. 포인터(▼)
          아래 라벨이 확정 시그와 같은지 확인합니다. {WHEEL_DEMO_MENU_COUNT}칸 · 당첨 {winners.length}
          회.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-600 disabled:opacity-40"
            disabled={sessionDone || wheelSpinning || !spinTargetReady}
            onClick={() => startRound(roundIndex)}
          >
            {reports.length === 0 ? "1회차 스핀" : "이 회차 스핀"}
          </button>
          <button
            type="button"
            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10 disabled:opacity-40"
            disabled={wheelPhase !== "result" || sessionDone}
            onClick={() => startRound(roundIndex + 1)}
          >
            다음 회차
          </button>
          <button
            type="button"
            className={`rounded border px-3 py-1.5 text-xs ${queuePreset === "spread" ? "border-sky-400 text-sky-200" : "border-white/20"}`}
            onClick={() => resetSession("spread")}
          >
            시나리오: 서로 다른 5종
          </button>
          <button
            type="button"
            className={`rounded border px-3 py-1.5 text-xs ${queuePreset === "duplicate2" ? "border-amber-400 text-amber-200" : "border-white/20"}`}
            onClick={() => resetSession("duplicate2")}
          >
            시나리오: 동일 시그 2연속
          </button>
          <button
            type="button"
            className={`rounded border px-3 py-1.5 text-xs ${queuePreset === "duplicate3" ? "border-amber-400 text-amber-200" : "border-white/20"}`}
            onClick={() => resetSession("duplicate3")}
          >
            시나리오: 동일 시그 3연속
          </button>
          <button
            type="button"
            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
            onClick={() => resetSession("random")}
          >
            무작위 5종
          </button>
        </div>
        <p className="mt-2 text-[11px] text-neutral-500">
          수동 점검: 「1회차 스핀」→ 착지 후 포인터 아래 이름과 표의 「확정 시그」를 눈으로 비교 → 「다음
          회차」. 자동 연속: URL에 <code className="text-neutral-300">?auto=1</code>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          <Link
            href={getWheelDemoPlaythroughPath()}
            className="font-semibold text-emerald-300 underline hover:text-emerald-200"
          >
            5회전 + 한방 + 판매 연출 데모 →
          </Link>
          <Link
            href={getWheelDemoPlaythroughAutoPath()}
            className="text-emerald-400/80 underline hover:text-emerald-300"
          >
            (자동 시작)
          </Link>
          <Link
            href={getSigSalesWheelDemoOverlayPath("finalent")}
            className="text-sky-300 underline hover:text-sky-200"
            target="_blank"
            rel="noopener noreferrer"
          >
            OBS 통합 오버레이 →
          </Link>
          <Link
            href="/overlay/sig-sales/wheel-render-probe"
            className="text-violet-300 underline hover:text-violet-200"
          >
            렌더 동기화 점검 →
          </Link>
        </p>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex flex-col items-center">
          <div className="mb-2 text-center text-sm text-neutral-300">
            회차 {Math.min(roundIndex + 1, winners.length)} / {winners.length}
            {currentWinner ? (
              <>
                {" "}
                · 확정 시그:{" "}
                <span className="font-bold text-yellow-200">{sanitizeWheelDisplayName(currentWinner.name)}</span>
                {spinTargetReady ? (
                  <>
                    {" "}
                    → 착지 예정:{" "}
                    <span className="font-semibold text-sky-200">{targetWheelLabel}</span>
                    <span className="text-neutral-500">
                      {" "}
                      (#{targetIndex + 1})
                    </span>
                  </>
                ) : (
                  <span className="text-rose-400"> · 휠 바인딩 실패</span>
                )}
              </>
            ) : null}
          </div>
          <div className="flex w-full max-w-md justify-center">
            <RouletteWheel
              spinReplayNonce={spinReplayNonce}
              items={wheelBinding.items}
              getLabel={(item) => getWheelLabel(item, wheelBinding.items.length)}
              isRolling={wheelSpinning}
              resultId={wheelKeepsWheelMounted ? wheelBinding.animationResultId : null}
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
              onLanded={(landedId, pointerRotationDeg, visualPointerIndex, motionDesyncDeg, renderSync) => {
                commitLand(
                  landedId ?? wheelBinding.animationResultId,
                  pointerRotationDeg,
                  visualPointerIndex,
                  motionDesyncDeg,
                  renderSync
                );
              }}
            />
          </div>

          {pendingReport ? (
            <div
              className={`mt-4 w-full max-w-md rounded-lg border px-4 py-3 text-center ${
                pendingReport.ok
                  ? "border-emerald-500/60 bg-emerald-950/40"
                  : "border-rose-500/70 bg-rose-950/50"
              }`}
            >
              <div className="text-lg font-black">
                {pendingReport.ok ? "정합 OK" : "불일치"}
                {!pendingReport.ok && pendingReport.failReason ? (
                  <span className="text-sm font-semibold text-rose-200">
                    {" "}
                    ({pendingReport.failReason})
                  </span>
                ) : null}
              </div>
              <div className="mt-2 grid gap-1 text-left text-[11px] text-neutral-200">
                <div>
                  확정 시그: <span className="text-yellow-200">{pendingReport.winnerName}</span> (
                  {pendingReport.winnerCanon})
                </div>
                <div>
                  목표 칸 #{pendingReport.targetIndex >= 0 ? pendingReport.targetIndex + 1 : "?"} ·{" "}
                  <span className="text-sky-200">{pendingReport.targetLabel}</span>
                </div>
                <div>
                  ▼ 아래 라벨:{" "}
                  {pendingReport.visualPointerIndex >= 0 ? (
                    <span
                      className={
                        pendingReport.visualPointerIndex === pendingReport.targetIndex
                          ? "text-sky-200"
                          : "text-rose-300"
                      }
                    >
                      {getWheelLabel(
                        wheelBinding.items[pendingReport.visualPointerIndex]!,
                        wheelBinding.items.length
                      )}{" "}
                      (#{pendingReport.visualPointerIndex + 1})
                    </span>
                  ) : (
                    <span className="text-amber-200">
                      미측정
                      {pendingReport.formulaPointerIndex === pendingReport.targetIndex
                        ? " (수식·각도는 목표와 일치)"
                        : ""}
                    </span>
                  )}
                  {pendingReport.formulaPointerIndex >= 0 &&
                  pendingReport.formulaPointerIndex !== pendingReport.visualPointerIndex ? (
                    <span className="text-amber-300">
                      {" "}
                      · 수식 #{pendingReport.formulaPointerIndex + 1}{" "}
                      {pendingReport.targetLabel}
                    </span>
                  ) : null}
                </div>
                <div>
                  애니 id 칸 #{pendingReport.landedIndex >= 0 ? pendingReport.landedIndex + 1 : "?"} ·{" "}
                  <span className="text-neutral-400">{pendingReport.landedLabel}</span>
                </div>
                <div className="truncate text-neutral-500">
                  slice: {pendingReport.targetSliceId} → landed: {pendingReport.landedSliceId}
                </div>
                <div className="text-neutral-500">
                  착지 각도(mod 360):{" "}
                  {pendingReport.pointerRotationDeg != null
                    ? `${((pendingReport.pointerRotationDeg % 360) + 360) % 360}°`
                    : "—"}
                  {pendingReport.targetIndex >= 0 ? (
                    <>
                      {" "}
                      · 목표{" "}
                      {wheelRotationNormForSliceIndex(
                        pendingReport.targetIndex,
                        wheelBinding.items.length
                      ).toFixed(0)}
                      °
                    </>
                  ) : null}
                  {pendingReport.formulaPointerIndex >= 0
                    ? ` → 수식 역산 #${pendingReport.formulaPointerIndex + 1}`
                    : ""}
                  {pendingReport.motionDesyncDeg != null
                    ? ` · desync ${pendingReport.motionDesyncDeg.toFixed(2)}°`
                    : ""}
                </div>
                {renderSyncReport ? (
                  <div
                    className={`mt-2 rounded border px-2 py-1.5 text-[10px] ${
                      renderSyncReport.ok
                        ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-100"
                        : "border-rose-500/50 bg-rose-950/40 text-rose-100"
                    }`}
                  >
                    <div className="font-bold">
                      렌더 동기화: {renderSyncReport.ok ? "OK" : "FAIL"}
                      {renderSyncReport.failReason ? ` (${renderSyncReport.failReason})` : ""}
                    </div>
                    <div className="mt-1 text-neutral-300">
                      motion {renderSyncReport.motionModDeg.toFixed(1)}° · DOM{" "}
                      {renderSyncReport.domMatrixDeg?.toFixed(1) ?? "—"}° · desync{" "}
                      {renderSyncReport.motionDomDesyncDeg?.toFixed(2) ?? "—"}° · 육안 #
                      {renderSyncReport.visualPointerIndex + 1}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-neutral-500">스핀 후 착지 결과가 여기 표시됩니다.</p>
          )}
        </section>

        <aside className="space-y-3 text-xs">
          <div className="rounded-lg border border-white/15 bg-neutral-900/80 p-3">
            <div className="font-semibold text-neutral-200">결과 요약</div>
            <div className="mt-2 flex gap-3">
              <span className="text-emerald-400">OK {passCount}</span>
              <span className="text-rose-400">FAIL {failCount}</span>
              <span className="text-neutral-400">/ {winners.length}회</span>
            </div>
            {sessionDone && reports.length === winners.length ? (
              <p className={`mt-2 font-bold ${failCount === 0 ? "text-emerald-300" : "text-rose-300"}`}>
                {failCount === 0 ? "전 회차 정합 통과" : `${failCount}회 불일치 — 콘솔·slice 표 확인`}
              </p>
            ) : null}
          </div>

          <div className="rounded-lg border border-white/15 bg-neutral-900/80 p-3">
            <div className="mb-2 font-semibold text-neutral-200">
              휠 칸 맵 ({wheelBinding.items.length}칸)
            </div>
            <p className="mb-2 text-[10px] text-neutral-500">
              하이라이트: 주황=이번 목표 칸 · 초록 테두리=이전 착지
            </p>
            <div className="max-h-[220px] overflow-y-auto">
              <table className="w-full border-collapse text-[10px]">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="py-0.5 text-left">#</th>
                    <th className="py-0.5 text-left">라벨</th>
                    <th className="py-0.5 text-left">slice id</th>
                  </tr>
                </thead>
                <tbody>
                  {sliceMap.map((row) => (
                    <tr
                      key={row.id}
                      className={
                        row.isTarget
                          ? "bg-amber-900/40 text-amber-100"
                          : row.isLanded
                            ? "text-emerald-200"
                            : "text-neutral-300"
                      }
                    >
                      <td className="py-0.5 pr-1 tabular-nums">{row.idx + 1}</td>
                      <td className="max-w-[72px] truncate py-0.5 pr-1">{row.label}</td>
                      <td className="max-w-[100px] truncate py-0.5 font-mono text-[9px] opacity-80">
                        {row.id}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border border-white/15 bg-neutral-900/80 p-3">
            <div className="mb-2 font-semibold text-neutral-200">회차 로그</div>
            <ul className="max-h-[200px] space-y-2 overflow-y-auto">
              {reports.length === 0 ? (
                <li className="text-neutral-500">아직 없음</li>
              ) : (
                reports.map((r) => (
                  <li
                    key={r.roundIndex}
                    className={`rounded border px-2 py-1.5 ${r.ok ? "border-emerald-800/80" : "border-rose-800/80"}`}
                  >
                    <span className={r.ok ? "text-emerald-400" : "text-rose-400"}>
                      {r.ok ? "OK" : "FAIL"}
                    </span>{" "}
                    R{r.roundIndex + 1}: {r.winnerName} → 포인터{" "}
                    {r.pointerIndex >= 0
                      ? `#${r.pointerIndex + 1} ${r.pointerLabel}`
                      : "(각도 없음)"}
                  </li>
                ))
              )}
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
