"use client";

import type { ReactNode } from "react";
import { formatSigSalesWon } from "@/lib/sig-sales-panel-ui";
import type { SigRollingTheme } from "@/lib/sig-rolling-theme";

export function SigSalesPanelChrome({
  tags = [],
  showGear = false,
  settingsOpen = false,
  onToggleSettings,
  settingsPanel,
  children,
  controlBar,
  totalAmount = 0,
  showTotalFooter = true,
  showHeader = true,
  totalLabel = "TOTAL SIG SALES",
  totalSub,
  className = "",
  theme,
}: {
  tags?: string[];
  showGear?: boolean;
  settingsOpen?: boolean;
  onToggleSettings?: () => void;
  settingsPanel?: ReactNode;
  children: ReactNode;
  controlBar?: ReactNode;
  totalAmount?: number;
  /** false면 하단 TOTAL 숨김(카드 아래 TOTAL만 쓸 때) */
  showTotalFooter?: boolean;
  /** false면 상단 헤더 숨김(방송 오버레이 등에서 표시하지 않을 때) */
  showHeader?: boolean;
  totalLabel?: string;
  totalSub?: ReactNode;
  className?: string;
  theme?: SigRollingTheme;
}) {
  return (
    <section
      className={`flex w-full max-w-full flex-col overflow-hidden rounded-2xl border ${className}`.trim()}
      style={{
        background: theme ? theme.shellBg : "rgba(20, 20, 25, 0.92)",
        borderColor: theme ? theme.shellBorder : "rgba(255, 255, 255, 0.1)",
        boxShadow: theme ? theme.shellShadow : "0 0 40px rgba(0,0,0,0.45)",
      }}
    >
      {showHeader ? (
        <header
          className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5"
          style={{
            borderColor: theme ? theme.shellBorder : "rgba(255, 255, 255, 0.1)",
            background: theme ? theme.footerBg : undefined,
          }}
        >
          <div className="min-w-0 flex-1">
            <div
              className="text-[11px] font-black tracking-[0.18em]"
              style={{
                color: theme ? theme.priceColor : "#f0abfc",
                textShadow: theme?.glowColor ? `0 0 10px ${theme.glowColor}` : undefined,
              }}
            >
              SIG SALES PANEL v2.0
            </div>
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
      ) : null}
      {settingsOpen && settingsPanel ? (
        <div className="border-b border-white/10 bg-black/35 px-4 py-3">{settingsPanel}</div>
      ) : null}
      <div className="px-3 py-3">{children}</div>
      {controlBar ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-black/30 px-3 py-2.5">
          {controlBar}
        </div>
      ) : null}
      {showTotalFooter ? (
        <footer className="flex w-full items-center justify-between gap-3 border-t border-yellow-300/35 bg-gradient-to-r from-black/80 via-[#1a1408] to-black/80 px-4 py-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold tracking-[0.16em] text-yellow-100/85">{totalLabel}</span>
            {totalSub ? <div className="text-[10px] font-semibold text-rose-300/90">{totalSub}</div> : null}
          </div>
          <span className="text-2xl font-black tabular-nums text-yellow-300 drop-shadow-[0_0_12px_rgba(250,204,21,0.45)] sm:text-3xl">
            {formatSigSalesWon(totalAmount)}
          </span>
        </footer>
      ) : null}
    </section>
  );
}
