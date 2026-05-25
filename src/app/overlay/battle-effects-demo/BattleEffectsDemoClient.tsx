"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  BATTLE_EFFECTS_DEMO_SCENARIOS,
  getBattleEffectsDemoHubPath,
  getBattleEffectsScenarioPath,
  getMealGaugeDemoHubPath,
  getSigMatchDemoHubPath,
  type BattleEffectsBattle,
} from "@/lib/battle-effects-demo";
import { getBattleEffectsVerifyPath } from "@/lib/battle-effects-verify";
import { SIG_MATCH_OVERLAY_UI_REV } from "@/lib/overlay-ui-revision";

type Filter = "all" | BattleEffectsBattle;

const FILTER_LABELS: Record<Filter, string> = {
  all: "전체",
  meal: "식사 대전",
  sig: "시그 대전",
};

export default function BattleEffectsDemoClient() {
  const [filter, setFilter] = useState<Filter>("all");
  const [scenarioId, setScenarioId] = useState(
    BATTLE_EFFECTS_DEMO_SCENARIOS.find((s) => s.recommended)?.id ?? BATTLE_EFFECTS_DEMO_SCENARIOS[0]!.id
  );
  const [iframeKey, setIframeKey] = useState(0);
  const [overlayPath, setOverlayPath] = useState("");

  const filteredScenarios = useMemo(
    () =>
      filter === "all"
        ? BATTLE_EFFECTS_DEMO_SCENARIOS
        : BATTLE_EFFECTS_DEMO_SCENARIOS.filter((s) => s.battle === filter),
    [filter]
  );

  const scenario = useMemo(
    () =>
      BATTLE_EFFECTS_DEMO_SCENARIOS.find((s) => s.id === scenarioId) ??
      filteredScenarios[0] ??
      BATTLE_EFFECTS_DEMO_SCENARIOS[0]!,
    [scenarioId, filteredScenarios]
  );

  useEffect(() => {
    if (filter !== "all" && !filteredScenarios.some((s) => s.id === scenarioId)) {
      setScenarioId(filteredScenarios[0]?.id ?? BATTLE_EFFECTS_DEMO_SCENARIOS[0]!.id);
    }
  }, [filter, filteredScenarios, scenarioId]);

  useEffect(() => {
    setOverlayPath(getBattleEffectsScenarioPath(scenario));
  }, [scenario]);

  const overlaySrc = useMemo(() => {
    if (!overlayPath) return "";
    const sep = overlayPath.includes("?") ? "&" : "?";
    return `${overlayPath}${sep}_previewRev=${iframeKey}&_chunk=${SIG_MATCH_OVERLAY_UI_REV}`;
  }, [overlayPath, iframeKey]);

  const overlayUrl =
    overlaySrc && typeof window !== "undefined" ? `${window.location.origin}${overlaySrc}` : overlaySrc;

  const reloadPreview = useCallback(() => {
    setIframeKey((k) => k + 1);
  }, []);

  const pickScenario = useCallback((id: string) => {
    setScenarioId(id);
    setIframeKey((k) => k + 1);
  }, []);

  const mealCount = BATTLE_EFFECTS_DEMO_SCENARIOS.filter((s) => s.battle === "meal").length;
  const sigCount = BATTLE_EFFECTS_DEMO_SCENARIOS.filter((s) => s.battle === "sig").length;

  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <header className="mx-auto mb-4 max-w-6xl">
        <h1 className="text-lg font-bold">대전 연출 · 통합 점검 허브</h1>
        <p className="mt-1 text-xs leading-relaxed text-neutral-400">
          <span className="text-pink-200">식사 대전</span> 게이지 연출({mealCount}개)과{" "}
          <span className="text-amber-200">시그 대전</span> VS UI({sigCount}개)를 한 화면에서 고릅니다. 서버·Redis
          없이 URL·스냅샷만으로 미리보기합니다. 시그 판매 회전판은{" "}
          <Link href="/overlay/sig-sales/wheel-demo" className="text-sky-400 hover:underline">
            별도 허브
          </Link>
          입니다.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={overlayPath || "#"}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded px-3 py-1.5 text-xs font-semibold ${
              scenario.battle === "meal"
                ? "bg-pink-700 hover:bg-pink-600"
                : "bg-amber-700 hover:bg-amber-600"
            }`}
          >
            오버레이만 새 탭
          </Link>
          <Link
            href={getMealGaugeDemoHubPath()}
            className="rounded border border-pink-400/40 px-3 py-1.5 text-xs text-pink-200 hover:bg-pink-950/40"
          >
            식사 대전 허브
          </Link>
          <Link
            href={getSigMatchDemoHubPath()}
            className="rounded border border-amber-400/40 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-950/40"
          >
            시그 대전 허브
          </Link>
          <Link href="/admin" className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10">
            관리자
          </Link>
          <Link
            href={getBattleEffectsVerifyPath()}
            className="rounded border border-emerald-500/50 bg-emerald-950/50 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/50"
          >
            UI 반영 확인 ✓
          </Link>
          <button
            type="button"
            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"
            onClick={reloadPreview}
          >
            미리보기 새로고침
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                filter === f
                  ? f === "meal"
                    ? "bg-pink-800 text-pink-50 ring-1 ring-pink-400/50"
                    : f === "sig"
                      ? "bg-amber-800 text-amber-50 ring-1 ring-amber-400/50"
                      : "bg-white/15 text-white ring-1 ring-white/30"
                  : "bg-white/5 text-neutral-400 hover:bg-white/10"
              }`}
            >
              {FILTER_LABELS[f]}
              {f === "meal" ? ` (${mealCount})` : f === "sig" ? ` (${sigCount})` : ` (${BATTLE_EFFECTS_DEMO_SCENARIOS.length})`}
            </button>
          ))}
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,300px)_1fr]">
        <aside className="space-y-2">
          <div className="text-xs font-semibold text-neutral-300">시나리오</div>
          <ul className="max-h-[min(70dvh,560px)] space-y-1 overflow-y-auto pr-1">
            {filteredScenarios.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => pickScenario(s.id)}
                  className={`w-full rounded px-2 py-2 text-left text-xs transition ${
                    s.id === scenarioId
                      ? s.battle === "meal"
                        ? "bg-pink-900/50 ring-1 ring-pink-400/60"
                        : "bg-amber-900/50 ring-1 ring-amber-400/60"
                      : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase ${
                        s.battle === "meal" ? "bg-pink-600/80 text-white" : "bg-amber-600/80 text-white"
                      }`}
                    >
                      {s.battle === "meal" ? "식사" : "시그"}
                    </span>
                    <span className={`font-semibold ${s.battle === "meal" ? "text-pink-100" : "text-amber-100"}`}>
                      {s.label}
                    </span>
                  </div>
                  <div className="mt-0.5 pl-0.5 text-[10px] leading-snug text-neutral-500">{s.description}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="rounded border border-white/10 bg-black/40 p-2 text-[10px] text-neutral-500">
            <div className="font-medium text-neutral-400">현재 URL</div>
            <code className="mt-1 block max-h-24 overflow-y-auto break-all text-emerald-300/90">
              {overlayPath || "…"}
            </code>
          </div>
        </aside>

        <section className="flex min-h-[min(75dvh,720px)] flex-col rounded-lg border border-white/10 bg-black/30 p-2">
          <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[10px] text-neutral-500">
            <span>
              미리보기 · {scenario.battle === "meal" ? "식사 대전" : "시그 대전"}
              {scenario.battle === "meal" && scenario.mealOpts?.gaugePreview ? " · 자동 연출" : ""}
              {scenario.battle === "sig" && scenario.sigScenario?.sigPreview ? " · 자동 연출" : ""}
            </span>
            {overlayUrl ? (
              <a href={overlayUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">
                전체 화면 ↗
              </a>
            ) : null}
          </div>
          {overlayPath ? (
            <iframe
              key={iframeKey}
              title="battle-effects-preview"
              src={overlaySrc}
              className="min-h-0 w-full flex-1 rounded border-0 bg-transparent"
              style={{ minHeight: "min(70dvh, 680px)", height: "100%" }}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-neutral-500">미리보기 준비 중…</div>
          )}
        </section>
      </div>

      <footer className="mx-auto mt-6 max-w-6xl text-[10px] text-neutral-600">
        허브: {getBattleEffectsDemoHubPath()} · 식사 {getMealGaugeDemoHubPath()} · 시그 {getSigMatchDemoHubPath()}
      </footer>
    </main>
  );
}
