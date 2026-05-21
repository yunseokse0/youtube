"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState, type ReactNode } from "react";

export type SigSalesHybridTab = "wheel" | "rolling" | "inventory";

const TABS: { id: SigSalesHybridTab; label: string }[] = [
  { id: "wheel", label: "회전판 · 추첨" },
  { id: "rolling", label: "롤링 · 이미지" },
  { id: "inventory", label: "시그 목록 · 가격" },
];

type SigSalesHybridModalProps = {
  open: boolean;
  activeTab: SigSalesHybridTab;
  onTabChange: (tab: SigSalesHybridTab) => void;
  onClose: () => void;
  newTabHref?: string;
  children: ReactNode;
};

export default function SigSalesHybridModal({
  open,
  activeTab,
  onTabChange,
  onClose,
  newTabHref = "/admin/sig-sales",
  children,
}: SigSalesHybridModalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[450] flex flex-col bg-[#141414]/98 backdrop-blur-sm">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-lg font-bold text-yellow-200">시그 판매 관리</h2>
          <p className="text-xs text-neutral-400">회전판 · 롤링 · 목록·가격·엑셀을 한곳에서 관리</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={newTabHref}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-yellow-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-yellow-400"
          >
            새 탭에서 열기
          </Link>
          <button
            type="button"
            className="rounded bg-neutral-700 px-3 py-1.5 text-xs text-white hover:bg-neutral-600"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
      </header>
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "bg-indigo-600 text-white"
                : "bg-white/5 text-neutral-300 hover:bg-white/10"
            }`}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6">{children}</div>
    </div>,
    document.body
  );
}
