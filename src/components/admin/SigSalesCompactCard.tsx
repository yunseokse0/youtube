"use client";

import Link from "next/link";
import type { SigSalesHybridTab } from "@/components/admin/SigSalesHybridModal";

type SigSalesCompactCardProps = {
  sigCount: number;
  activeCount: number;
  rollingCount: number;
  roulettePhase: string;
  uploadBusy?: boolean;
  onOpen: (tab?: SigSalesHybridTab) => void;
};

export default function SigSalesCompactCard({
  sigCount,
  activeCount,
  rollingCount,
  roulettePhase,
  uploadBusy = false,
  onOpen,
}: SigSalesCompactCardProps) {
  return (
    <div className="mt-4 rounded-xl border border-yellow-300/40 bg-gradient-to-r from-yellow-500/10 to-fuchsia-500/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="text-sm font-bold text-yellow-200">시그 판매 관리</div>
          <p className="text-xs text-neutral-300">
            등록 시그 <strong className="text-white">{sigCount}</strong>개 · 판매 활성{" "}
            <strong className="text-white">{activeCount}</strong>개 · 롤링{" "}
            <strong className="text-white">{rollingCount}</strong>개
          </p>
          <p className="text-[11px] text-neutral-400">
            회전판 상태: <span className="text-neutral-200">{roulettePhase}</span>
            {uploadBusy ? " · 업로드 진행 중…" : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-500"
            onClick={() => onOpen("inventory")}
          >
            시그 판매 관리 열기
          </button>
          <button
            type="button"
            className="rounded bg-violet-800 px-3 py-2 text-sm hover:bg-violet-700"
            onClick={() => onOpen("wheel")}
          >
            회전판
          </button>
          <Link
            href="/admin/sig-sales"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-white/20 bg-black/30 px-3 py-2 text-sm text-neutral-200 hover:bg-white/10"
          >
            새 탭
          </Link>
        </div>
      </div>
    </div>
  );
}
