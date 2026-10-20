"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HeyobAuthChrome, HeyobAuthHero } from "@/components/heyob/HeyobAuthChrome";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionReason = searchParams.get("reason");
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "로그인에 실패했습니다.");
        return;
      }
      const back = searchParams.get("from");
      const safeBack =
        back && back.startsWith("/") && !back.startsWith("//") && !back.includes(":")
          ? back
          : "/admin";
      router.push(safeBack);
      router.refresh();
    } catch {
      setError("로그인 처리 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const fieldClass =
    "w-full rounded-xl border border-white/10 bg-[#0b1220] px-3 py-2.5 text-white placeholder-white/30 outline-none transition focus:border-[#5ec8ff]/70 focus:ring-2 focus:ring-[#5ec8ff]/20";

  return (
    <HeyobAuthChrome>
      <HeyobAuthHero />
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0d1524]/90 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] tracking-[0.28em] text-white/35">DIN STUDIO</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight text-[#5ec8ff]">EXCEL</h2>
            <p className="mt-1 text-sm text-white/50">엑셀 방송 정산</p>
          </div>
          <span className="rounded-full border border-[#5ec8ff]/40 bg-[#5ec8ff]/10 px-2.5 py-0.5 text-[10px] font-semibold tracking-wide text-[#5ec8ff]">
            EXCEL v1.0
          </span>
        </div>
        {sessionReason === "expired" ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-amber-400/40 bg-amber-500/15 px-3 py-2.5 text-sm leading-snug text-amber-100"
          >
            로그인 세션이 만료되었습니다. 다시 로그인해 주세요.
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-[11px] tracking-wide text-white/40">아이디</label>
            <input
              type="text"
              className={fieldClass}
              placeholder="아이디"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] tracking-wide text-white/40">비밀번호</label>
            <input
              type="password"
              className={fieldClass}
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <div className="text-sm text-rose-400">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-[#3aa4f0] py-2.5 text-sm font-bold tracking-wide text-[#071018] transition hover:bg-[#5ec8ff] disabled:opacity-60"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </HeyobAuthChrome>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFallback() {
  return (
    <HeyobAuthChrome>
      <HeyobAuthHero />
      <p className="text-sm text-white/40">로딩 중…</p>
    </HeyobAuthChrome>
  );
}
