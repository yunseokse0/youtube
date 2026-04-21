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
