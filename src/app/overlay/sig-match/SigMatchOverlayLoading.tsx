/** 시그 대전 — SSR·iframe 미리보기용 공통 로딩 (hydration 불일치 방지) */
export default function SigMatchOverlayLoading() {
  return (
    <main className="min-h-[12rem] w-full bg-transparent p-4 text-white">
      <div className="mx-auto max-w-3xl rounded-xl border border-white/10 bg-black/40 p-4 text-center text-sm text-white/70">
        시그 대전 오버레이 로딩…
      </div>
    </main>
  );
}
