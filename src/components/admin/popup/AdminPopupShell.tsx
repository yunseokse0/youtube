"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type AdminPopupShellProps = {
  title: string;
  subtitle?: string;
  userId: string;
  accountMismatch?: boolean;
  sessionUserId?: string | null;
  urlUserId?: string;
  loading?: boolean;
  children: ReactNode;
};

export default function AdminPopupShell({
  title,
  subtitle,
  userId,
  accountMismatch,
  sessionUserId,
  urlUserId,
  loading,
  children,
}: AdminPopupShellProps) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-neutral-950/95 backdrop-blur px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold">{title}</h1>
            {subtitle ? <p className="mt-0.5 text-xs text-neutral-400">{subtitle}</p> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Link href="/admin" className="text-sky-400 hover:underline">
              관리자 홈
            </Link>
            <span className="text-neutral-600">·</span>
            <span className="text-neutral-500">u={userId}</span>
          </div>
        </div>
        {accountMismatch ? (
          <p className="mt-2 rounded border border-amber-500/40 bg-amber-950/40 px-2 py-1.5 text-[11px] text-amber-100">
            로그인({sessionUserId})과 URL(u={urlUserId}) 계정이 다릅니다.
          </p>
        ) : null}
      </header>
      <main className="p-4">
        {loading ? (
          <div className="py-16 text-center text-sm text-neutral-400">불러오는 중…</div>
        ) : (
          children
        )}
      </main>
    </div>
  );
}
