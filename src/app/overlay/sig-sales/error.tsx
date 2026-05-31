"use client";

import { useEffect } from "react";

/**
 * 시그 판매 OBS 소스 전용 오류 UI — 상위 `app/error.tsx`와 동일 계열이나
 * URL·Interact 콘솔 안내를 붙여 방송 중 원인 파악을 돕는다.
 */
export default function SigSalesOverlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[overlay/sig-sales]", error);
  }, [error]);

  const msg = String(error?.message || "").trim();
  const chunkMismatch = /8948\.js|Cannot find module|ChunkLoadError|Loading chunk/i.test(msg);

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-neutral-950 p-6 text-white">
      <div className="w-full max-w-md rounded-xl border border-yellow-400/35 bg-black/50 p-5 text-center">
        <h2 className="text-xl font-bold text-yellow-100">시그 판매 오버레이 오류</h2>
        <p className="mt-2 text-sm text-neutral-300">
          페이지 실행 중 예외가 발생했습니다. OBS에서 이 소스만 이 창이 보이면 URL·배포 버전을 확인하세요.
        </p>
        {msg ? (
          <p className="mt-3 break-all rounded border border-white/10 bg-black/40 px-2 py-2 text-left text-[11px] text-rose-200/95">
            {msg}
            {error.digest ? `\n(digest: ${error.digest})` : ""}
          </p>
        ) : null}
        {chunkMismatch ? (
          <p className="mt-3 text-xs text-amber-200/90">
            빌드 청크 불일치 가능성이 있습니다. 서버에서{" "}
            <code className="text-emerald-300">git pull && npm run build && pm2 restart youtube</code> 후 OBS
            소스를 새로고침하세요.
          </p>
        ) : null}
        <p className="mt-3 text-left text-[11px] leading-relaxed text-neutral-400">
          올바른 주소 예:{" "}
          <code className="text-neutral-200">/overlay/sig-sales?u=계정ID</code>
          <br />
          (<code className="text-neutral-200">/sig-sales</code> 는 이 앱에 없습니다)
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded bg-indigo-600 px-4 py-2 text-sm font-semibold hover:bg-indigo-500"
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
