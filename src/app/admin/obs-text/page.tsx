"use client";

export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ObsTextOverlayEditor from "@/components/obs-text/ObsTextOverlayEditor";

function ObsTextAdminInner() {
  const sp = useSearchParams();
  const userId = (sp.get("u") || sp.get("user") || "finalent").trim() || "finalent";

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
      <ObsTextOverlayEditor userId={userId} />
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
