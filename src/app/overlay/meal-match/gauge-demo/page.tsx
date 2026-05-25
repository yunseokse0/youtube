import { Suspense } from "react";
import dynamic from "next/dynamic";

const MealGaugeDemoClient = dynamic(() => import("./MealGaugeDemoClient"), {
  ssr: false,
});

export default function MealGaugeDemoPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[100dvh] bg-neutral-950 px-3 py-8 text-white sm:px-5">
          <div className="mx-auto max-w-6xl text-sm text-neutral-400">식사 대전 게이지 허브 로딩…</div>
        </main>
      }
    >
      <MealGaugeDemoClient />
    </Suspense>
  );
}
