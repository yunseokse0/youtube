"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/** 예전 OBS URL 호환: 시그 오버레이는 `/overlay/sig-sales` 단일 경로로 통합됨 */
export default function SigBoardOverlayRedirectPage() {
  const sp = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(sp.toString());
    window.location.replace(`/overlay/sig-sales?${q.toString()}`);
  }, [sp]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[960px] rounded-xl border border-white/20 bg-black/40 p-4 text-center text-sm">
        <code>/overlay/sig-sales</code> 로 이동 중...
      </div>
    </main>
  );
}
