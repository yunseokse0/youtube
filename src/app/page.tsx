import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center">
      <div className="glass p-8 w-[92%] max-w-2xl text-center">
        <h1 className="text-2xl font-bold mb-3">Final Entertainment 방송 정산 시스템</h1>
        <p className="text-neutral-300 mb-6">사용할 메뉴를 선택하세요.</p>
        <div className="flex gap-4 justify-center">
          <Link className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700" href="/admin">관리자 페이지</Link>
          <Link className="px-4 py-2 rounded bg-neutral-800 hover:bg-neutral-700" href="/settlements">정산 기록</Link>
        </div>
        <div className="mt-1 text-sm text-neutral-400">
          오버레이 설정 및 정산 관리는 관리자 페이지에서 진행하세요.
        </div>
      </div>
    </main>
  );
}
