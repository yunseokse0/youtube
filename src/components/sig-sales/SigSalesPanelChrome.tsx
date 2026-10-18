"use client";

import type { ReactNode } from "react";
import { formatSigSalesWon } from "@/lib/sig-sales-panel-ui";

export function SigSalesPanelChrome({
  tags = [],
  showGear = false,
  settingsOpen = false,
  onToggleSettings,
  settingsPanel,
  children,
  controlBar,
  totalAmount = 0,
  className = "",
}: {
  tags?: string[];
  showGear?: boolean;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  settingsPanel?: ReactNode;
  children: ReactNode;
  controlBar?: ReactNode;
  totalAmount?: number;
  className?: string;
}) {
  return (
    <section
      className={`flex w-full max-w-full flex-col overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_40px_rgba(0,0,0,0.45)] ${className}`.trim()}
      style={{ background: "rgba(20, 20, 25, 0.92)" }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-black tracking-[0.18em] text-fuchsia-300">SIG SALES PANEL v2.0</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {tags.filter(Boolean).map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-cyan-400/35 bg-cyan-400/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
        {showGear ? (
          <button
            type="button"
            onClick={onToggleSettings}
            className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-sm ${
              settingsOpen
                ? "border-yellow-300/60 bg-yellow-400/15 text-yellow-100"
                : "border-white/15 bg-white/5 text-neutral-200"
            }`}
            title="설정"
            aria-label="설정"
          >
            ⚙️
          </button>
        ) : null}
      </header>
      {settingsOpen && settingsPanel ? (
        <div className="border-b border-white/10 bg-black/35 px-4 py-3">{settingsPanel}</div>
      ) : null}
      <div className="px-3 py-3">{children}</div>
      {controlBar ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-black/30 px-3 py-2.5">
          {controlBar}
        </div>
      ) : null}
      <footer className="flex w-full items-center justify-between gap-3 border-t border-yellow-300/35 bg-gradient-to-r from-black/80 via-[#1a1408] to-black/80 px-4 py-2.5">
        <span className="text-[11px] font-bold tracking-[0.16em] text-yellow-100/85">TOTAL SIG SALES</span>
        <span className="text-2xl font-black tabular-nums text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.45)] sm:text-3xl">
          {formatSigSalesWon(totalAmount)}
        </span>
      </footer>
    </section>
  );
}
