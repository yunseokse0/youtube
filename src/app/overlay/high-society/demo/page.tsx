/** 미리보기 및 데모용. 상태는 `/api/shangliu?u=` 를 폴링한다. */
export default function HighSocietyDemoPage({
  searchParams,
}: {
  searchParams?: { u?: string; user?: string };
}) {
  const u = String(searchParams?.u || searchParams?.user || "finalent").trim() || "finalent";
  return (
    <div className="min-h-screen w-screen bg-[#06020c] text-white flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[1100px] bg-[#0e0717] border border-purple-800/40 rounded-2xl shadow-2xl p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-purple-800/30">
          <div>
            <h1 className="text-xl font-black text-amber-300 flex items-center gap-2">
              <span>👑 상류사회 오버레이 (High Society)</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">데모 / 미리보기</span>
            </h1>
            <p className="text-xs text-neutral-400 mt-1">
              실시간 영토 뺏기 방송 오버레이 · 방송 OBS 주소: <code className="text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded select-all">/overlay/high-society?u={u}</code>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/admin/high-society?u=${encodeURIComponent(u)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
            >
              🎮 관리자 조작창 열기
            </a>
            <a
              href={`/overlay.html?u=${encodeURIComponent(u)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
            >
              📺 OBS 단독 뷰 열기
            </a>
          </div>
        </div>

        {/* 오버레이 렌더링 프레임 */}
        <div className="w-full rounded-xl overflow-hidden bg-[#24182f] border border-purple-500/30 shadow-inner flex items-center justify-center py-6">
          <iframe
            src={`/overlay.html?u=${encodeURIComponent(u)}&preview=1`}
            title="상류사회 오버레이 미리보기"
            className="w-full h-[320px] border-0"
          />
        </div>
      </div>
    </div>
  );
}
