"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/** OBS·안내 문구 호환: 회전판 통합 오버레이는 `/overlay/sig-sales` 단일 경로 — 쿼리 보존 리다이렉트 */
export default function SigSelectOverlayRedirectPage() {
  const sp = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(sp.toString());
    window.location.replace(`/overlay/sig-sales?${q.toString()}`);
  }, [sp]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[960px] rounded-xl border border-white/20 bg-black/40 p-4 text-center text-sm">
        회전판 오버레이가 <code>/overlay/sig-sales</code>로 통합되었습니다. 이동 중…
      </div>
    </main>
  );
}
