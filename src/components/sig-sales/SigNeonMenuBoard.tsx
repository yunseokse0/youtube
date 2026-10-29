"use client";

import { sigNeonMenuColumnCount } from "@/lib/sig-sales-overlay-urls";

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

export default function SigNeonMenuBoard({
  items,
  className = "",
}: {
  items: SigNeonMenuItem[];
  className?: string;
}) {
  const cols = sigNeonMenuColumnCount(items.length);

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
    <div
      className={`grid w-full max-w-[1280px] gap-2 sm:gap-2.5 ${className}`.trim()}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {items.map((item, idx) => {
        const neon = item.sold ? "#fb7185" : neonColorAt(idx);
        return (
          <div
            key={item.id}
            className="relative flex min-h-[5.5rem] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl px-2 py-2.5 text-center"
            style={{
              background: item.sold ? "rgba(40, 8, 16, 0.88)" : "rgba(8, 6, 16, 0.78)",
              border: `3px solid ${neon}`,
              boxShadow: `0 0 10px ${neon}99, 0 0 22px ${neon}55, inset 0 0 18px ${neon}22`,
              opacity: item.sold ? 0.92 : 1,
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
              }}
            >
              {formatMenuPrice(item.price)}
            </div>
            {item.sold ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/55">
                <span
                  className="rotate-[-12deg] border-2 border-rose-400 px-1.5 py-0.5 text-[10px] font-black tracking-wider text-rose-300"
                  style={{ textShadow: "0 0 8px rgba(251,113,133,0.9)" }}
                >
                  SOLD
                </span>
                {item.buyerName ? (
                  <span className="rounded bg-black/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {item.buyerName}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
