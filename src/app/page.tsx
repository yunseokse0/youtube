import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { AUTH_COOKIE } from "@/lib/auth";
import { HeyobAuthChrome, HeyobAuthHero } from "@/components/heyob/HeyobAuthChrome";

export default async function Home() {
  const cookieStore = await cookies();
  const userCookie = cookieStore.get(AUTH_COOKIE)?.value;
  const headerStore = await headers();
  const host = (headerStore.get("host") || "").toLowerCase().split(":")[0];
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";
  const isLanDev =
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host.endsWith(".local");
  /** 로컬·LAN: 휠 데모 20칸·5당첨·한방 자동 스핀으로 바로 점검 */
  if (isLocal || isLanDev) {
    redirect("/overlay/sig-sales?u=finalent&wheelDemo=1&menuCount=20&wheelDemoWins=5&wheelDemoAuto=1");
  }
  if (userCookie) redirect("/admin");

  return (
    <HeyobAuthChrome>
      <HeyobAuthHero />
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1524]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.28em] text-white/35">DIN STUDIO</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-[#5ec8ff]">EXCEL</h2>
            <p className="mt-1 text-sm text-white/50">멤버 엑셀 집계, 플레이어 시그 보드, 방송 오버레이와 정산을 한 화면에서.</p>
          </div>
          <span className="rounded-full border border-[#5ec8ff]/40 bg-[#5ec8ff]/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-[#5ec8ff]">
            EXCEL v1.0
          </span>
        </div>
        <Link
          className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-[#3aa4f0] py-2.5 text-sm font-bold tracking-wide text-[#071018] hover:bg-[#5ec8ff]"
          href="/login"
        >
          로그인
        </Link>
        <p className="mt-3 text-center text-xs text-white/35">오버레이 설정 및 정산은 로그인 후 관리자에서 진행하세요.</p>
      </div>
    </HeyobAuthChrome>
  );
}
