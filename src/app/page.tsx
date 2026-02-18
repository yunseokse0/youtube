import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="glass p-8 w-[92%] max-w-2xl text-center">
        <h1 className="text-2xl font-bold mb-3">엑셀방송 정산 시스템</h1>
        <p className="text-neutral-300 mb-6">관리자 패널과 방송용 오버레이를 선택하세요.</p>
        <div className="flex gap-4 justify-center">
          <Link className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700" href="/admin">/admin</Link>
          <Link className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700" href="/overlay">/overlay</Link>
        </div>
      </div>
    </main>
  );
}

