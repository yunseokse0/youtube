"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ObsTextOverlayEditor from "@/components/obs-text/ObsTextOverlayEditor";

function ObsTextAdminInner() {
  const sp = useSearchParams();
  const userId = (sp.get("u") || sp.get("user") || "finalent").trim() || "finalent";
  const textId = sp.get("textId");
  const createOnMount = sp.get("new") === "1";
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: { id?: string } } | null) => {
        const id = data?.user?.id;
        setSessionUserId(typeof id === "string" && id.trim() ? id.trim() : null);
      })
      .catch(() => setSessionUserId(null));
  }, []);

  const accountMismatch =
    sessionUserId != null && sessionUserId.length > 0 && sessionUserId !== userId;

  return (
    <div className="min-h-screen bg-neutral-950">
      <nav className="border-b border-white/10 px-4 py-2 text-sm text-neutral-400">
        <Link href="/admin/sig-sales" className="text-sky-400 hover:underline">
          ← 시그 판매
        </Link>
        <span className="mx-2">·</span>
        <Link href="/admin" className="hover:text-white">
          관리자 홈
        </Link>
        <span className="ml-2 text-neutral-500">u={userId}</span>
      </nav>
      {accountMismatch ? (
        <div className="mx-4 mt-4 rounded-lg border border-amber-500/40 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
          로그인 계정({sessionUserId})과 URL 계정(u={userId})이 다릅니다. 저장·OBS URL의{" "}
          <code className="text-amber-200">u=</code> 값이 방송 계정과 일치하는지 확인하세요.
        </div>
      ) : null}
      <ObsTextOverlayEditor
        key={userId}
        userId={userId}
        initialInstanceId={textId}
        createOnMount={createOnMount}
      />
    </div>
  );
}

export default function AdminObsTextPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-400">
          로딩…
        </div>
      }
    >
      <ObsTextAdminInner />
    </Suspense>
  );
}
