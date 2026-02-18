import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="glass p-8 w-[92%] max-w-2xl text-center">
        <h1 className="text-2xl font-bold mb-3">엑셀방송 정산 시스템</h1>
        <p className="text-neutral-300 mb-6">관리자 패널과 유튜브 방송 모니터를 선택하세요.</p>
        <div className="flex gap-4 justify-center">
          <Link className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700" href="/admin">/admin</Link>
          <Link className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700" href="/youtube">/youtube</Link>
        </div>
        <div className="mt-3 text-sm text-neutral-400">
          금지어 알림 전용 페이지: <Link className="underline hover:text-neutral-300" href="/alerts">/alerts</Link>
        </div>
      </div>
    </main>
  );
}
