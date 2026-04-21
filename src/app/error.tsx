"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen w-full bg-neutral-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-xl border border-white/15 bg-black/30 p-5 text-center">
        <h2 className="text-xl font-bold">문제가 발생했습니다</h2>
        <p className="mt-2 text-sm text-neutral-300">잠시 후 다시 시도해주세요.</p>
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
