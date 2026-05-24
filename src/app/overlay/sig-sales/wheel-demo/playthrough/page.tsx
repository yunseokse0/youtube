import dynamic from "next/dynamic";
import { Suspense } from "react";

function Shell() {
  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <p className="flex min-h-[50dvh] items-center justify-center text-sm text-neutral-300">
        연출 데모 불러오는 중…
      </p>
    </main>
  );
}

const WheelDemoPlaythroughClient = dynamic(() => import("./WheelDemoPlaythroughClient"), {
  ssr: false,
  loading: () => <Shell />,
});

/** 20칸 휠 · 5회 순차 스핀 · 당첨 카드 · 한방 · 데모 판매 확정 */
export default function WheelDemoPlaythroughPage() {
  return (
    <Suspense fallback={<Shell />}>
      <WheelDemoPlaythroughClient />
    </Suspense>
  );
}
