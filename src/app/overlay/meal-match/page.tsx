"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import MealMatchOverlayInner from "./MealMatchOverlayInner";
import { MEAL_MATCH_OVERLAY_UI_REV } from "@/lib/overlay-ui-revision";

function MealMatchOverlayPageInner() {
  const sp = useSearchParams();
  const revKey = sp.get("overlayUiRev") || sp.get("_build") || MEAL_MATCH_OVERLAY_UI_REV;
  return <MealMatchOverlayInner key={revKey} />;
}

export default function MealMatchOverlayPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen w-full bg-transparent p-8 text-white/60">
          <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-transparent p-6 text-center text-sm md:bg-black/20">
            식사 대전 오버레이 로딩…
          </div>
        </main>
      }
    >
      <MealMatchOverlayPageInner />
    </Suspense>
  );
}
