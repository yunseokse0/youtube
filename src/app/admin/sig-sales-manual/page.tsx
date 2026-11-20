"use client";

import Link from "next/link";
import ManualSigSalesSimple from "./ManualSigSalesSimple";

/** 수동 시그 판매 — 판매 중 5개 랜덤 + OBS (회전판·재고 UI 없음) */
export default function AdminSigSalesManualRoutePage() {
  return (
    <div className="min-h-screen bg-[#070b14] text-white">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/60 px-4 py-2.5 backdrop-blur-md flex items-center justify-between">
        <Link
          href="/admin#overlay-settings"
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 hover:text-white text-xs font-semibold border border-indigo-400/30 transition shadow-sm"
        >
          <span>←</span>
          <span>관리자 대시보드로 돌아가기</span>
        </Link>
        <span className="text-xs font-bold text-neutral-400">
          🎯 수동 시그 판매 (단독 집중 모드)
        </span>
      </header>
      <ManualSigSalesSimple />
    </div>
  );
}
