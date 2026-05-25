"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  console.error(error);

  return (
    <html lang="ko">
      <body className="min-h-screen w-full bg-black text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-xl border border-white/20 bg-white/5 p-5 text-center">
          <h2 className="text-xl font-bold">치명적 오류가 발생했습니다</h2>
          <p className="mt-2 text-sm text-neutral-300">페이지를 다시 불러오거나 아래 버튼을 눌러주세요.</p>
          {/8948\.js|Cannot find module/i.test(String(error?.message ?? "")) ? (
            <p className="mt-3 text-xs text-amber-200/90">
              개발 서버 청크 불일치입니다. 터미널에서{" "}
              <code className="text-emerald-300">npm run dev:clean</code> 실행 후 브라우저를{" "}
              <strong>Ctrl+Shift+R</strong>로 새로고침하세요.
            </p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="mt-4 rounded bg-rose-600 px-4 py-2 text-sm font-semibold hover:bg-rose-500"
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  );
}
