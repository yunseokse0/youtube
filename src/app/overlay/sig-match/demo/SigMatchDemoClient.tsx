"use client";



import { useMemo, useState } from "react";

import Link from "next/link";

import {

  SIG_MATCH_DEMO_SCENARIOS,

  buildSigMatchDemoOverlayPathFromScenario,

  getSigMatchDemoHubPath,

} from "@/lib/sig-match-demo";

import {

  appendBattleEffectsHubPreviewParams,

  SIG_MATCH_OVERLAY_UI_REV,

} from "@/lib/overlay-ui-revision";

import SigMatchDemoEmbeddedPreview from "./SigMatchDemoEmbeddedPreview";



function overlayPathForScenario(scenarioId: string): string {

  const scenario =

    SIG_MATCH_DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? SIG_MATCH_DEMO_SCENARIOS[0]!;

  return appendBattleEffectsHubPreviewParams(buildSigMatchDemoOverlayPathFromScenario(scenario), "sig");

}



export default function SigMatchDemoClient() {

  const [scenarioId, setScenarioId] = useState(SIG_MATCH_DEMO_SCENARIOS[0]!.id);

  const [previewKey, setPreviewKey] = useState(0);



  const scenario = useMemo(

    () => SIG_MATCH_DEMO_SCENARIOS.find((s) => s.id === scenarioId) ?? SIG_MATCH_DEMO_SCENARIOS[0]!,

    [scenarioId]

  );

  const overlayPath = useMemo(() => overlayPathForScenario(scenarioId), [scenarioId]);



  return (

    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5" suppressHydrationWarning>

      <header className="mx-auto mb-4 max-w-6xl">

        <h1 className="text-lg font-bold">시그 대전 · 오버레이 점검</h1>

        <p className="mt-1 text-xs leading-relaxed text-neutral-400">

          <strong className="text-amber-200">시그 판매(회전판)</strong>와 다릅니다. 후원·시그 점수로 팀/개인이

          대결하는 <code className="text-sky-300">/overlay/sig-match</code> 입니다. 미리보기는{" "}

          <strong className="text-emerald-200">같은 페이지에 직접 렌더</strong>하여 iframe·구 JS 캐시를 피합니다.

        </p>

        <p className="mt-2 text-[10px] text-amber-200/80">

          현재 빌드: <strong>{SIG_MATCH_OVERLAY_UI_REV}</strong> · 멤버별 세로 박스 · VS 합산 막대(핑크/블루) · 선두 팀만 👑

        </p>

        <p className="mt-1 text-[10px] text-emerald-300/90">

          초록 <strong>SIG DUEL {SIG_MATCH_OVERLAY_UI_REV}</strong> 배너와 <code>data-sig-team-box</code>가 보이면 최신 UI입니다.

        </p>

        <p className="mt-1 text-[10px] text-red-300/90">

          흰 화면·500·<code>fallback/*.js 404</code> → <code className="text-emerald-300">npm run dev:clean</code> 후 새로고침

        </p>

        <div className="mt-3 flex flex-wrap gap-2">

          <Link

            href={overlayPath}

            target="_blank"

            rel="noopener noreferrer"

            className="rounded bg-amber-700 px-3 py-1.5 text-xs font-semibold hover:bg-amber-600"

          >

            OBS용 URL (새 탭)

          </Link>

          <Link

            href="/admin"

            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"

          >

            관리자 (시그 대전 관리)

          </Link>

          <Link

            href="/overlay/battle-effects-demo"

            className="rounded border border-violet-400/40 px-3 py-1.5 text-xs text-violet-200 hover:bg-violet-950/40"

          >

            대전 연출 통합 허브

          </Link>

          <Link

            href="/overlay/battle-effects-demo/verify"

            className="rounded border border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-200 hover:bg-emerald-950/40"

          >

            UI 반영 확인 (식사+시그)

          </Link>

          <Link

            href="/overlay/meal-match/gauge-demo"

            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"

          >

            식사 대전 게이지 허브

          </Link>

          <Link

            href="/overlay/sig-sales/wheel-demo"

            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"

          >

            시그 판매(회전판) 허브

          </Link>

          <button

            type="button"

            className="rounded border border-white/20 px-3 py-1.5 text-xs hover:bg-white/10"

            onClick={() => setPreviewKey((k) => k + 1)}

          >

            미리보기 새로고침

          </button>

        </div>

      </header>



      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[minmax(0,280px)_1fr]">

        <aside className="space-y-2">

          <div className="text-xs font-semibold text-neutral-300">시나리오</div>

          <ul className="max-h-[min(70dvh,520px)] space-y-1 overflow-y-auto pr-1">

            {SIG_MATCH_DEMO_SCENARIOS.map((s) => (

              <li key={s.id}>

                <button

                  type="button"

                  onClick={() => {

                    setScenarioId(s.id);

                    setPreviewKey((k) => k + 1);

                  }}

                  className={`w-full rounded px-2 py-2 text-left text-xs transition ${

                    s.id === scenarioId

                      ? "bg-amber-900/50 ring-1 ring-amber-400/60"

                      : "bg-white/5 hover:bg-white/10"

                  }`}

                >

                  <div className="font-semibold text-amber-100">{s.label}</div>

                  <div className="mt-0.5 text-[10px] leading-snug text-neutral-500">{s.description}</div>

                </button>

              </li>

            ))}

          </ul>

          <div className="rounded border border-white/10 bg-black/40 p-2 text-[10px] text-neutral-500">

            <div className="font-medium text-neutral-400">실시간 OBS URL (서버 연동)</div>

            <code className="mt-1 block break-all text-sky-300/90">

              /overlay/sig-match?u=YOUR_USER_ID

            </code>

          </div>

        </aside>



        <section className="flex min-h-[min(75dvh,720px)] flex-col rounded-lg border border-white/10 bg-black/30 p-2">

          <div className="mb-2 flex items-center justify-between gap-2 px-1 text-[10px] text-neutral-500">

            <span>

              인라인 미리보기 (<code className="text-amber-300">{SIG_MATCH_OVERLAY_UI_REV}</code> · iframe 없음)

            </span>

            <a href={overlayPath} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">

              OBS snap URL ↗

            </a>

          </div>

          <SigMatchDemoEmbeddedPreview key={`${scenarioId}-${previewKey}`} scenario={scenario} />

        </section>

      </div>



      <footer className="mx-auto mt-6 max-w-6xl text-[10px] text-neutral-600">

        허브: {getSigMatchDemoHubPath()}

      </footer>

    </main>

  );

}

