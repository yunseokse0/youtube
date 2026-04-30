"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function SigSalesResultOverlayPage() {
  const sp = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(sp.toString());
    const nextUrl = `/overlay/sig-sales?${q.toString()}`;
    window.location.replace(nextUrl);
  }, [sp]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[960px] rounded-xl border border-white/20 bg-black/40 p-4 text-center text-sm">
        단일 오버레이로 통합되어 <code>/overlay/sig-sales</code>로 이동 중...
      </div>
    </main>
  );
}
