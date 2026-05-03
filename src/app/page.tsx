import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { AUTH_COOKIE } from "@/lib/auth";

export default async function Home() {
  const cookieStore = await cookies();
  const userCookie = cookieStore.get(AUTH_COOKIE)?.value;
  const headerStore = await headers();
  const host = (headerStore.get("host") || "").toLowerCase().split(":")[0];
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  /** 로컬에서는 루트가 관리자로만 가면 회전판 데모를 못 봄 → `/wheel` 데모로 우선 연결 */
  if (isLocal) {
    redirect("/wheel");
  }
  if (userCookie) redirect("/admin");

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#1a1a1a]">
      <div className="glass p-8 w-[92%] max-w-2xl text-center">
        <h1 className="text-2xl font-bold mb-3">방송 정산 시스템</h1>
        <p className="text-neutral-300 mb-6">로그인 후 사용하세요.</p>
        <div className="flex gap-4 justify-center">
          <Link className="px-4 py-2 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-white" href="/login">로그인</Link>
        </div>
        <div className="mt-1 text-sm text-neutral-400">
          오버레이 설정 및 정산 관리는 로그인 후 관리자 페이지에서 진행하세요.
        </div>
      </div>
    </main>
  );
}
