"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";

/** OBS 레거시 URL `/admin/sig-sales/overlay` → 공개 수동 오버레이로 이동 */
export default function AdminSigSalesOverlayRedirectPage() {
  const sp = useSearchParams();

  const target = useMemo(() => {
    const q = new URLSearchParams(sp.toString());
    q.set("u", getOverlayUserIdFromSearchParams(sp));
    q.delete("id");
    if (!q.get("mode")?.trim()) q.set("mode", "manual");
    if (!q.has("hideSigBoard")) q.set("hideSigBoard", "1");
    q.delete("overlay");
    return `/overlay/sig-sales?${q.toString()}`;
  }, [sp]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.location.replace(target);
  }, [target]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[960px] rounded-xl border border-rose-400/40 bg-black/70 p-4 text-center text-sm">
        <p className="font-semibold text-rose-100">OBS URL이 예전 관리자 경로입니다.</p>
        <p className="mt-2 text-xs text-rose-200/90">
          <code className="text-rose-50">/overlay/sig-sales</code> 로 이동 중…
        </p>
        <p className="mt-3 break-all font-mono text-[11px] text-yellow-100">{target}</p>
        <p className="mt-2 text-xs text-neutral-300">
          OBS 브라우저 소스 URL을 위 주소로 바꾼 뒤 「수동 오버레이 URL 복사」를 쓰는 것을 권장합니다.
        </p>
      </div>
    </main>
  );
}
