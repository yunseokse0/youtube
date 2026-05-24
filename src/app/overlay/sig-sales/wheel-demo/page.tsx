import dynamic from "next/dynamic";
import { Suspense } from "react";

function WheelDemoHydrationShell() {
  return (
    <main className="min-h-[100dvh] bg-neutral-950 px-3 py-4 text-white sm:px-5">
      <p className="flex min-h-[50dvh] items-center justify-center text-sm text-neutral-300">
        휠 데모 불러오는 중…
      </p>
    </main>
  );
}

const WheelDemoClient = dynamic(() => import("./WheelDemoClient"), {
  ssr: false,
  loading: () => <WheelDemoHydrationShell />,
});

/** 로컬 전용 휠 착지 정합 점검 */
export default function WheelDemoPage() {
  return (
    <Suspense fallback={<WheelDemoHydrationShell />}>
      <WheelDemoClient />
    </Suspense>
  );
}
