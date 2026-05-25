"use client";

import dynamic from "next/dynamic";
import { Suspense, useMemo } from "react";
import {
  buildSigMatchDemoAppState,
  type SigMatchDemoScenario,
} from "@/lib/sig-match-demo";
import { SIG_MATCH_OVERLAY_UI_REV } from "@/lib/overlay-ui-revision";

const SigMatchDuelOverlay = dynamic(() => import("../SigMatchDuelOverlay"), {
  ssr: false,
  loading: () => (
    <div className="flex min-h-[min(70dvh,640px)] items-center justify-center text-xs text-neutral-500">
      오버레이 로딩… ({SIG_MATCH_OVERLAY_UI_REV})
    </div>
  ),
});

function SigMatchDemoOverlayInner({ scenario }: { scenario: SigMatchDemoScenario }) {
  const embeddedDemo = useMemo(
    () => ({
      frozenState: buildSigMatchDemoAppState(scenario),
      hubPreview: true,
      sigPreview: scenario.sigPreview ?? false,
      previewGuide: scenario.previewGuide ?? false,
      scalePct: 100,
      contentWidthPct: 100,
    }),
    [scenario]
  );

  return <SigMatchDuelOverlay embeddedDemo={embeddedDemo} />;
}

export default function SigMatchDemoEmbeddedPreview({
  scenario,
}: {
  scenario: SigMatchDemoScenario;
}) {
  return (
    <div
      className="relative min-h-0 flex-1 overflow-auto rounded border border-amber-500/20 bg-[#0a0a0a]"
      style={{ minHeight: "min(70dvh, 640px)" }}
      data-sig-demo-inline="true"
      data-overlay-ui={SIG_MATCH_OVERLAY_UI_REV}
    >
      <Suspense
        fallback={
          <div className="flex min-h-[min(70dvh,640px)] items-center justify-center text-xs text-neutral-500">
            미리보기 준비 중… ({SIG_MATCH_OVERLAY_UI_REV})
          </div>
        }
      >
        <SigMatchDemoOverlayInner scenario={scenario} />
      </Suspense>
    </div>
  );
}
