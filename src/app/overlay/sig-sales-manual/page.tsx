import { Suspense } from "react";
import ManualSigOverlaySimple from "./ManualSigOverlaySimple";

/** 수동 시그 OBS — 당첨 카드만 (회전판 오버레이와 분리) */
export const dynamic = "force-dynamic";

export default function SigSalesManualOverlayPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-0 bg-transparent p-4 text-center text-xs text-neutral-400">
          수동 시그 오버레이 불러오는 중…
        </main>
      }
    >
      <ManualSigOverlaySimple />
    </Suspense>
  );
}
