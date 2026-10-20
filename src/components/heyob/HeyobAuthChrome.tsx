const HUB_URL = process.env.NEXT_PUBLIC_HUB_URL || "https://heyob.co.kr";

/** HEYOB 허브 랜딩과 같은 네이비·시안 톤 */
export function HeyobAuthChrome({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#070b14] text-white">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(56, 168, 255, 0.16), transparent 55%)",
        }}
      />
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <a href={HUB_URL} className="block no-underline">
          <div className="text-[13px] font-semibold tracking-[0.32em] text-white">HEYOB</div>
          <div className="mt-1 text-[10px] tracking-wide text-white/40">Broadcasting tools · Din Studio</div>
        </a>
        <nav className="flex items-center gap-6 text-[11px] font-medium tracking-[0.22em] text-white/40">
          <a className="hover:text-white/80" href={HUB_URL}>
            SIG
          </a>
          <span className="text-[#5ec8ff]">EXCEL</span>
        </nav>
      </header>
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 pb-16 pt-4 lg:flex-row lg:items-center lg:justify-between lg:pt-10">
        {children}
      </div>
    </main>
  );
}

export function HeyobAuthHero() {
  return (
    <div className="max-w-xl">
      <p className="text-[11px] font-medium tracking-[0.35em] text-white/35">HEYOB.CO.KR</p>
      <h1 className="mt-4 text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl">
        HELP
        <br />
        YOUR
        <br />
        <span className="text-[#5ec8ff]">BROADCASTING</span>
      </h1>
      <p className="mt-6 max-w-sm text-sm leading-relaxed text-white/55">
        후원 알림과 방송 정산을 한 도메인에서.
        <br />
        엑셀 방송 정산은 <span className="font-semibold text-[#5ec8ff]">EXCEL</span>
      </p>
    </div>
  );
}
