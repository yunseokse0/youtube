"use client";

import { useEffect, useState } from "react";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";

const DEFAULT_TARGET = "/overlay/sig-sales-manual?u=finalent&hideSigBoard=1";

function targetFromWindowSearch(search: string): string {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  q.set("u", getOverlayUserIdFromSearchParams(q));
  q.delete("id");
  if (!q.has("hideSigBoard")) q.set("hideSigBoard", "1");
  q.delete("overlay");
  return `/overlay/sig-sales-manual?${q.toString()}`;
}

/** OBS 레거시 URL `/admin/sig-sales/overlay` → 공개 수동 오버레이로 이동 */
export default function AdminSigSalesOverlayRedirectPage() {
  const [target, setTarget] = useState(DEFAULT_TARGET);

  useEffect(() => {
    const t = targetFromWindowSearch(window.location.search);
    setTarget(t);
    window.location.replace(t);
  }, []);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[960px] rounded-xl border border-rose-400/40 bg-black/70 p-4 text-center text-sm">
        <p className="font-semibold text-rose-100">OBS URL이 예전 관리자 경로입니다.</p>
        <p className="mt-2 text-xs text-rose-200/90">
          <code className="text-rose-50">/overlay/sig-sales-manual</code> 로 이동 중…
        </p>
        <p className="mt-3 break-all font-mono text-[11px] text-yellow-100">{target}</p>
        <p className="mt-2 text-xs text-neutral-300">
          OBS 브라우저 소스 URL을 위 주소로 바꾼 뒤 「수동 오버레이 URL 복사」를 쓰는 것을 권장합니다.
        </p>
      </div>
    </main>
  );
}
