import dynamic from "next/dynamic";
import { Suspense } from "react";

function UiCompareShell() {
  return (
    <main className="min-h-[100dvh] bg-neutral-950 p-4 text-white">
      <p className="text-sm text-neutral-400">시그 판매 UI 비교 불러오는 중…</p>
    </main>
  );
}

const UiCompareClient = dynamic(() => import("./UiCompareClient"), {
  ssr: false,
  loading: () => <UiCompareShell />,
});

/** 로컬 전용 — 판매 가능 10·20칸 회전판 + 당첨 카드 줄 비교 */
export default function SigSalesUiComparePage() {
  return (
    <Suspense fallback={<UiCompareShell />}>
      <UiCompareClient />
    </Suspense>
  );
}
