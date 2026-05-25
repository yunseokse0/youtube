"use client";

export default function SigMatchDemoError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const staleChunk =
    /8948\.js|Cannot find module|fallback\/|MODULE_NOT_FOUND/i.test(String(error?.message ?? ""));

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-neutral-950 p-6 text-white">
      <div className="max-w-md rounded-xl border border-rose-500/40 bg-rose-950/30 p-5 text-center">
        <h2 className="text-lg font-bold text-rose-100">시그 대전 데모 로드 실패</h2>
        <p className="mt-2 text-xs text-neutral-300">{error.message || "알 수 없는 오류"}</p>
        {staleChunk ? (
          <p className="mt-3 text-xs text-amber-200/90">
            개발 서버 청크가 깨진 상태입니다. 터미널에서{" "}
            <code className="text-emerald-300">npm run dev:clean</code> 실행 후{" "}
            <strong>Ctrl+Shift+R</strong>로 새로고침하세요.
          </p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded bg-amber-700 px-4 py-2 text-sm font-semibold hover:bg-amber-600"
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
