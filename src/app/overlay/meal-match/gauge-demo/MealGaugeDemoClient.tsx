"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import {
  MEAL_GAUGE_DEMO_SCENARIOS,
  getMealGaugeDemoHubPath,
  getMealGaugeOverlayPath,
} from "@/lib/meal-gauge-demo-paths";

export default function MealGaugeDemoClient() {
  const [scenarioId, setScenarioId] = useState(MEAL_GAUGE_DEMO_SCENARIOS[0]!.id);
  const [iframeKey, setIframeKey] = useState(0);

  const scenario = useMemo(
    () => MEAL_GAUGE_DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? MEAL_GAUGE_DEMO_SCENARIOS[0]!,
    [scenarioId]
  );

  const overlayPath = getMealGaugeOverlayPath(scenario.opts);
  const overlaySrc = useMemo(() => {
    if (!overlayPath) return "";
    const sep = overlayPath.includes("?") ? "&" : "?";
    return `${overlayPath}${sep}_previewRev=${iframeKey}`;
  }, [overlayPath, iframeKey]);

  const overlayUrl =
    overlaySrc && typeof window !== "undefined" ? `${window.location.origin}${overlaySrc}` : overlaySrc;

  const reloadPreview = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <header className="mx-auto mb-4 max-w-6xl">
        <h1 className="text-lg font-bold">식사 대전 · 게이지 연출 점검</h1>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          서버 상태 없이 <code className="text-emerald-300">demo=true</code> 로 오버레이를 띄웁니다.{" "}
          <code className="text-emerald-300">gaugePreview=1</code> 이면 점수·리더·타이머가 자동으로 움직여
          플로팅·RANK UP·타이머 긴장을 확인할 수 있습니다. URL{" "}
          <code className="text-sky-300">fx</code> / <code className="text-sky-300">timerTheme</code> 가
          관리자 저장값보다 우선합니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={overlayPath}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-emerald-700 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-600"
          >
            오버레이만 새 탭
          </Link>
          <Link
            href="/overlay/battle-effects-demo"
            className="rounded border border-violet-400/40 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-950/40"
          >
            대전 연출 통합 허브
          </Link>
          <Link
            href="/overlay/sig-match/demo"
            className="rounded border border-amber-400/40 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40"
          >
            시그 대전 허브
          </Link>
          <Link
            href="/admin"
            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
          >
            관리자 (게이지 연출 체크박스)
          </Link>
          <button
            type="button"
            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
            onClick={reloadPreview}
          >
            미리보기 새로고침
          </button>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">
        <aside className="space-y-2">
          <div className="text-xs font-semibold text-neutral-300">시나리오</div>
          <ul className="max-h-[min(70dvh,520px)] space-y-1 overflow-y-auto pr-1">
            {MEAL_GAUGE_DEMO_SCENARIOS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => {
                    setScenarioId(s.id);
                    setIframeKey((k) => k + 1);
                  }}
                  className={`w-full rounded px-2 py-2 text-left text-xs transition ${
                    s.id === scenarioId
                      ? "bg-pink-900/50 ring-1 ring-pink-400/60"
                      : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="font-semibold text-pink-100">{s.label}</div>
                  <div className="mt-0.5 text-[10px] leading-snug text-neutral-500">{s.description}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="rounded border border-white/10 bg-black/40 p-2 text-[10px] text-neutral-500">
            <div className="font-medium text-neutral-400">현재 URL</div>
            <code className="mt-1 block break-all text-emerald-300/90">{overlayPath}</code>
          </div>
        </aside>

        <section className="flex min-h-[min(75dvh,720px)] flex-col rounded-lg border border-white/10 bg-black/30 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[10px] text-neutral-500">
            <span>미리보기 (OBS와 동일 경로)</span>
            <a href={overlayUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
              전체 화면 ↗
            </a>
          </div>
          <iframe
            key={iframeKey}
            title="meal-gauge-preview"
            src={overlaySrc}
            className="min-h-0 flex-1 w-full rounded bg-transparent"
            style={{ minHeight: "min(70dvh, 640px)" }}
          />
        </section>
      </div>

      <footer className="mx-auto mt-6 max-w-6xl text-[10px] text-neutral-600">
        허브: {getMealGaugeDemoHubPath()} · 단위 테스트:{" "}
        <code>npm test -- src/lib/meal-gauge-effects.test.ts</code>
      </footer>
    </main>
  );
}
