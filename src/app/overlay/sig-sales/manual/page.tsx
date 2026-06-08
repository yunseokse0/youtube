"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

/** OBS 오타 `/overlay/sig-sales/manual` → `/overlay/sig-sales-manual` */
export default function SigSalesManualSlashRedirectPage() {
  const sp = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(sp.toString());
    if (!q.get("u")?.trim() && !q.get("user")?.trim()) q.set("u", "finalent");
    if (!q.get("hideSigBoard")) q.set("hideSigBoard", "1");
    if (!q.get("host")?.trim()) q.set("host", "obs");
    window.location.replace(`/overlay/sig-sales-manual?${q.toString()}`);
  }, [sp]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[960px] rounded-xl border border-white/20 bg-transparent p-4 text-center text-sm md:bg-black/40">
        <code>/overlay/sig-sales-manual</code> 로 이동 중…
      </div>
    </main>
  );
}
