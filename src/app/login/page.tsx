"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#1a1a1a]">
      <div className="w-[92%] max-w-sm rounded-xl border border-white/10 bg-[#252525] p-6 shadow-xl">
        <h1 className="text-xl font-bold text-white mb-1">로그인</h1>
        <p className="text-sm text-neutral-400 mb-6">방송 정산 시스템</p>
        {sessionReason === "expired" ? (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2.5 text-sm leading-snug text-amber-100"
          >
            로그인 세션이 만료되었습니다. 다시 로그인해 주세요.
          </div>
        ) : null}
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-neutral-400 mb-1">아이디</label>
            <input
              type="text"
              className="w-full px-3 py-2 rounded-lg bg-neutral-900/80 border border-white/10 text-white placeholder-neutral-500"
              placeholder="아이디"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
            />
          </div>
          <div>
            <label className="block text-xs text-neutral-400 mb-1">비밀번호</label>
            <input
              type="password"
              className="w-full px-3 py-2 rounded-lg bg-neutral-900/80 border border-white/10 text-white placeholder-neutral-500"
              placeholder="비밀번호"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-white font-medium disabled:opacity-60"
          >
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>
      </div>
    </main>
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
    <main className="flex min-h-screen items-center justify-center bg-[#1a1a1a]">
      <p className="text-sm text-neutral-400">로딩 중…</p>
    </main>
  );
}
