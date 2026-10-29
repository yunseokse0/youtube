"use client";

import { sigNeonMenuColumnCount } from "@/lib/sig-sales-overlay-urls";
import { formatSigSalesWon } from "@/lib/sig-sales-panel-ui";

export type SigNeonMenuItem = {
  id: string;
  name: string;
  price: number;
  sold?: boolean;
  buyerName?: string;
};

const NEON_PALETTE = [
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#a3e635", // lime
  "#fbbf24", // gold
  "#c084fc", // purple
  "#fb7185", // rose
  "#34d399", // emerald
  "#60a5fa", // blue
  "#f97316", // orange
  "#e879f9", // fuchsia
] as const;

function neonColorAt(index: number): string {
  return NEON_PALETTE[index % NEON_PALETTE.length]!;
}

function formatMenuPrice(price: number): string {
  return Math.max(0, Math.floor(Number(price) || 0)).toLocaleString("ko-KR");
}

function sumNeonBoardTotals(items: SigNeonMenuItem[]) {
  let boardTotal = 0;
  let soldTotal = 0;
  let soldCount = 0;
  for (const item of items) {
    const price = Math.max(0, Math.floor(Number(item.price) || 0));
    boardTotal += price;
    if (item.sold) {
      soldTotal += price;
      soldCount += 1;
    }
  }
  return { boardTotal, soldTotal, soldCount };
}

export default function SigNeonMenuBoard({
  items,
  className = "",
  showTotal = true,
}: {
  items: SigNeonMenuItem[];
  className?: string;
  /** 보드 하단 총액 바 (기본 on) */
  showTotal?: boolean;
}) {
  const cols = sigNeonMenuColumnCount(items.length);
  const { boardTotal, soldTotal, soldCount } = sumNeonBoardTotals(items);

  if (items.length === 0) {
    return (
      <div
        className={`rounded-xl border border-white/20 bg-black/55 px-4 py-3 text-center text-sm font-semibold text-neutral-200 ${className}`.trim()}
      >
        판매 중 시그가 없습니다
      </div>
    );
  }

  return (
    <div className={`flex w-full max-w-[1280px] flex-col gap-2.5 ${className}`.trim()}>
      <div
        className="grid w-full gap-2 sm:gap-2.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {items.map((item, idx) => {
          const neon = item.sold ? "#fb7185" : neonColorAt(idx);
          const buyer = String(item.buyerName || "").trim();
          return (
            <div
              key={item.id}
              className="relative flex min-h-[5.5rem] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl px-2 py-2.5 text-center"
              style={{
                background: item.sold ? "rgba(40, 8, 16, 0.88)" : "rgba(8, 6, 16, 0.78)",
                border: `3px solid ${neon}`,
                boxShadow: `0 0 10px ${neon}99, 0 0 22px ${neon}55, inset 0 0 18px ${neon}22`,
                opacity: item.sold ? 0.96 : 1,
              }}
            >
              <div
                className="line-clamp-2 w-full px-0.5 text-[11px] font-black leading-tight tracking-tight sm:text-xs md:text-[13px]"
                style={{
                  color: neon,
                  textShadow: `-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 10px ${neon}`,
                }}
                title={item.name}
              >
                {item.name}
              </div>
              <div
                className="w-full truncate text-lg font-black tabular-nums leading-none sm:text-xl md:text-2xl"
                style={{
                  color: "#fff",
                  textShadow: `-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 12px ${neon}, 0 0 4px #fff`,
                  textDecoration: item.sold ? "line-through" : undefined,
                  opacity: item.sold ? 0.55 : 1,
                }}
              >
                {formatMenuPrice(item.price)}
              </div>
              {item.sold ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/60 px-1">
                  <span
                    className="rotate-[-10deg] border-2 border-rose-400 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-rose-300 sm:text-[11px]"
                    style={{ textShadow: "0 0 8px rgba(251,113,133,0.9)" }}
                  >
                    SOLD
                  </span>
                  {buyer ? (
                    <span
                      className="max-w-full truncate px-1 text-center text-[clamp(18px,2.8vw,32px)] font-black leading-none tracking-tight text-white"
                      style={{
                        textShadow:
                          "-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 14px rgba(255,255,255,0.55)",
                      }}
                      title={buyer}
                    >
                      {buyer}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {showTotal ? (
        <div
          className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-yellow-300/45 bg-black/80 px-3 py-2.5 sm:px-4"
          style={{ boxShadow: "0 0 18px rgba(250,204,21,0.28)" }}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[11px] font-bold tracking-[0.14em] text-yellow-100/90">TOTAL</span>
            {soldCount > 0 ? (
              <span className="text-[10px] font-semibold text-rose-200/90">
                판매 {soldCount}칸 · {formatSigSalesWon(soldTotal)}
              </span>
            ) : null}
          </div>
          <span className="text-[clamp(22px,3.2vw,36px)] font-black tabular-nums leading-none text-yellow-300">
            {formatSigSalesWon(boardTotal)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
