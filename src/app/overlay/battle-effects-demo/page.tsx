import { Suspense } from "react";
import dynamic from "next/dynamic";

const BattleEffectsDemoClient = dynamic(() => import("./BattleEffectsDemoClient"), {
  ssr: false,
});

export default function BattleEffectsDemoPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[100dvh] bg-neutral-950 px-3 py-8 text-white sm:px-5">
          <div className="mx-auto max-w-6xl text-sm text-neutral-400">대전 연출 허브 로딩…</div>
        </main>
      }
    >
      <BattleEffectsDemoClient />
    </Suspense>
  );
}
