"use client";

import { useEffect } from "react";

/** OBS 텍스트 오버레이 — 502·청크·런타임 오류 시 방송 화면 안내 */
export default function ObsTextOverlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[overlay/obs-text]", error);
  }, [error]);

  const msg = String(error?.message || "").trim();
  const chunkMismatch = /Cannot find module|ChunkLoadError|Loading chunk/i.test(msg);

  return (
    <main className="flex min-h-[100dvh] w-full items-center justify-center bg-neutral-950 p-6 text-white">
      <div className="w-full max-w-md rounded-xl border border-yellow-400/35 bg-black/50 p-5 text-center">
        <h2 className="text-xl font-bold text-yellow-100">텍스트 오버레이 오류</h2>
        <p className="mt-2 text-sm text-neutral-300">
          페이지 실행 중 예외가 발생했습니다. nginx 502가 보이면 서버 배포·pm2 상태를 먼저 확인하세요.
        </p>
        {msg ? (
          <p className="mt-3 break-all rounded border border-white/10 bg-black/40 px-2 py-2 text-left text-[11px] text-rose-200/95">
            {msg}
            {error.digest ? `\n(digest: ${error.digest})` : ""}
          </p>
        ) : null}
        {chunkMismatch ? (
          <p className="mt-3 text-xs text-amber-200/90">
            빌드 청크 불일치 가능성이 있습니다. EC2에서{" "}
            <code className="text-emerald-300">bash deploy/deploy-on-ec2.sh</code> 후 OBS 소스를 새로고침하세요.
          </p>
        ) : null}
        <p className="mt-3 text-left text-[11px] leading-relaxed text-neutral-400">
          URL 예:{" "}
          <code className="text-neutral-200">/overlay/obs-text?u=계정ID&host=obs&textId=default</code>
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
