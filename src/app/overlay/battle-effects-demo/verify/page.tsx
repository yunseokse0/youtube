import ClientOnly from "@/components/ClientOnly";
import BattleEffectsVerifyClient from "./BattleEffectsVerifyClient";

function VerifyPageFallback() {
  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <div className="mx-auto max-w-6xl text-sm text-neutral-400">UI 반영 확인 페이지 로딩…</div>
    </main>
  );
}

export default function BattleEffectsVerifyPage() {
  return (
    <ClientOnly fallback={<VerifyPageFallback />}>
      <BattleEffectsVerifyClient />
    </ClientOnly>
  );
}
