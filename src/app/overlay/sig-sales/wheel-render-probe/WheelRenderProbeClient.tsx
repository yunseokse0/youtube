"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { SigItem } from "@/types";
import {
  formatWheelSegmentLabel,
  resolveWheelSlicesForSpinVisual,
  sanitizeWheelDisplayName,
  type WheelRenderSyncReport,
} from "@/lib/sig-roulette";
import {
  WHEEL_DEMO_MENU_COUNT,
  WHEEL_DEMO_SIG_POOL,
} from "@/lib/sig-wheel-demo-pool";

const RouletteWheel = dynamic(() => import("@/components/sig-sales/RouletteWheel"), {
  ssr: false,
});

function getWheelLabel(item: SigItem, segmentCount: number): string {
  const raw = sanitizeWheelDisplayName(item.name) || item.id;
  return formatWheelSegmentLabel(raw, segmentCount);
}

function RenderSyncPanel({ report }: { report: WheelRenderSyncReport | null }) {
  if (!report) {
    return (
      <p className="text-sm text-neutral-500">
        아래 칸 버튼을 누르거나 「20칸 전체 검사」를 실행하세요.
      </p>
    );
  }
  const row = (label: string, value: string, ok?: boolean) => (
    <div className="flex justify-between gap-2 border-b border-white/10 py-1.5 text-[11px]">
      <span className="text-neutral-400">{label}</span>
      <span className={ok === true ? "text-emerald-300" : ok === false ? "text-rose-300" : "text-white"}>
        {value}
      </span>
    </div>
  );
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        report.ok ? "border-emerald-500/50 bg-emerald-950/30" : "border-rose-500/60 bg-rose-950/40"
      }`}
    >
      <div className={`text-base font-black ${report.ok ? "text-emerald-300" : "text-rose-300"}`}>
        {report.ok ? "렌더 동기화 OK" : "렌더 동기화 FAIL"}
        {report.failReason ? (
          <span className="ml-2 text-xs font-semibold text-rose-200">({report.failReason})</span>
        ) : null}
      </div>
      <div className="mt-2">
        {row("목표 칸", `#${report.sliceIndex + 1} ${report.sliceLabel}`)}
        {row("목표 각도 (mod 360)", `${report.expectedNormDeg.toFixed(1)}°`)}
        {row("MotionValue (mod 360)", `${report.motionModDeg.toFixed(1)}°`, report.motionVsExpectedDeg <= 0.5)}
        {row(
          "DOM matrix (mod 360)",
          report.domMatrixDeg != null ? `${report.domMatrixDeg.toFixed(1)}°` : "—",
          report.domVsExpectedDeg != null && report.domVsExpectedDeg <= 0.5
        )}
        {row(
          "① motion ↔ DOM desync",
          report.motionDomDesyncDeg != null ? `${report.motionDomDesyncDeg.toFixed(2)}°` : "—",
          report.renderSyncOk
        )}
        {row(
          "② 육안(▼ 아래 라벨) 칸",
          report.visualPointerIndex >= 0 ? `#${report.visualPointerIndex + 1}` : "—",
          report.visualAlignOk
        )}
        {row(
          "③ DOM 역산 칸",
          report.formulaIndexFromDom >= 0 ? `#${report.formulaIndexFromDom + 1}` : "—",
          report.formulaDomAlignOk
        )}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-neutral-500">
        ① 화면이 motion 각도대로 그려졌는지 · ② ▼ 아래 라벨이 목표 칸인지 · ③ DOM 행렬 역산이 목표와
        같은지. 셋 다 통과해야 착지 각도가 화면에 제대로 반영된 것입니다.
      </p>
    </div>
  );
}

export default function WheelRenderProbeClient() {
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
  const n = menuSlices.length;

  const [probeIndex, setProbeIndex] = useState(0);
  const [probeNonce, setProbeNonce] = useState(0);
  const [latestReport, setLatestReport] = useState<WheelRenderSyncReport | null>(null);
  const [scanRows, setScanRows] = useState<WheelRenderSyncReport[]>([]);
  const [scanning, setScanning] = useState(false);
  const scanWaitRef = useRef<((r: WheelRenderSyncReport) => void) | null>(null);

  const triggerProbe = useCallback((idx: number) => {
    setProbeIndex(idx);
    setProbeNonce((v) => v + 1);
  }, []);

  const handleReport = useCallback((report: WheelRenderSyncReport) => {
    setLatestReport(report);
    scanWaitRef.current?.(report);
    scanWaitRef.current = null;
  }, []);

  const waitForReport = useCallback(
    () =>
      new Promise<WheelRenderSyncReport>((resolve) => {
        scanWaitRef.current = resolve;
      }),
    []
  );

  const runFullScan = useCallback(async () => {
    setScanning(true);
    setScanRows([]);
    const rows: WheelRenderSyncReport[] = [];
    for (let i = 0; i < n; i++) {
      const reportPromise = Promise.race([
        waitForReport(),
        new Promise<WheelRenderSyncReport>((_, reject) =>
          window.setTimeout(() => reject(new Error("timeout")), 4000)
        ),
      ]);
      triggerProbe(i);
      const report = await reportPromise.catch(() => null);
      if (report) rows.push(report);
      await new Promise((r) => window.setTimeout(r, 120));
    }
    setScanRows(rows);
    setScanning(false);
    if (rows.length) setLatestReport(rows[rows.length - 1]!);
  }, [n, triggerProbe, waitForReport]);

  const passCount = scanRows.filter((r) => r.ok).length;
  const failCount = scanRows.length - passCount;

  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <header className="mx-auto mb-4 max-w-5xl">
        <h1 className="text-lg font-bold">휠 렌더 동기화 점검</h1>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          스핀 없이 <strong className="text-white">수식 착지각 → 실제 화면</strong>만 검증합니다. 각 칸을
          누르면 해당 칸 중심각으로 즉시 스냅한 뒤, MotionValue·DOM 행렬·▼ 아래 라벨이 일치하는지
          표시합니다.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Link
            href="/overlay/sig-sales/wheel-demo"
            className="rounded border border-white/20 px-2 py-1 text-sky-300 hover:bg-white/10"
          >
            ← 착지 정합(스핀) 데모
          </Link>
          <button
            type="button"
            className="rounded bg-violet-700 px-3 py-1 font-semibold hover:bg-violet-600 disabled:opacity-40"
            disabled={scanning}
            onClick={() => void runFullScan()}
          >
            {scanning ? "검사 중…" : "20칸 전체 자동 검사"}
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="flex flex-col items-center">
          <div className="flex w-full max-w-md justify-center">
            <RouletteWheel
              items={menuSlices}
              getLabel={(item) => getWheelLabel(item, n)}
              isRolling={false}
              resultId={null}
              startedAt={0}
              probeSliceIndex={probeIndex}
              probeNonce={probeNonce}
              onRenderSyncReport={handleReport}
              volume={0}
              muted
            />
          </div>
          <div className="mt-4 grid w-full max-w-md grid-cols-5 gap-1.5">
            {menuSlices.map((item, idx) => {
              const label = getWheelLabel(item, n);
              const scanned = scanRows.find((r) => r.sliceIndex === idx);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={scanning}
                  className={`rounded border px-1 py-1.5 text-[10px] font-semibold leading-tight ${
                    scanned
                      ? scanned.ok
                        ? "border-emerald-500/60 bg-emerald-950/40 text-emerald-200"
                        : "border-rose-500/60 bg-rose-950/40 text-rose-200"
                      : latestReport?.sliceIndex === idx
                        ? "border-sky-400 bg-sky-950/40 text-sky-100"
                        : "border-white/15 bg-neutral-900/80 hover:bg-white/10"
                  }`}
                  onClick={() => triggerProbe(idx)}
                >
                  #{idx + 1}
                  <br />
                  <span className="font-normal opacity-90">{label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="space-y-3">
          <RenderSyncPanel report={latestReport} />
          {scanRows.length > 0 ? (
            <div className="rounded-lg border border-white/15 bg-neutral-900/80 p-3 text-xs">
              <div className="font-semibold text-neutral-200">전체 검사 요약</div>
              <div className="mt-2 flex gap-3">
                <span className="text-emerald-400">OK {passCount}</span>
                <span className="text-rose-400">FAIL {failCount}</span>
                <span className="text-neutral-500">/ {scanRows.length}</span>
              </div>
              {failCount === 0 && scanRows.length === n ? (
                <p className="mt-2 font-bold text-emerald-300">20칸 모두 렌더 동기화 통과</p>
              ) : failCount > 0 ? (
                <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-rose-200">
                  {scanRows
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <li key={r.sliceIndex}>
                        #{r.sliceIndex + 1} {r.sliceLabel}: {r.failReason}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
