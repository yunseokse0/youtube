"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";

type DonorRow = {
  name: string;
  amount: number;
};

const TEST_ACCOUNT_ROWS: DonorRow[] = [
  { name: "artaiker", amount: 3849000 },
  { name: "서동", amount: 2614000 },
  { name: "fgojin", amount: 1116000 },
  { name: "wlkgf", amount: 819000 },
  { name: "브라운", amount: 542900 },
  { name: "동네형", amount: 420000 },
  { name: "푸른별", amount: 315000 },
];

const TEST_TOON_ROWS: DonorRow[] = [
  { name: "대폭군", amount: 700000 },
  { name: "슈퍼고양이", amount: 115000 },
  { name: "도깨비", amount: 108000 },
  { name: "동하", amount: 84000 },
  { name: "쌍남", amount: 70000 },
  { name: "초승달", amount: 50000 },
  { name: "콩콩", amount: 10000 },
];

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);

  const readLocalStateIfExists = useCallback((): AppState | null => {
    if (typeof window === "undefined") return null;
    try {
      const key = storageKey(userId);
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return loadState(userId ?? undefined);
    } catch {
      return null;
    }
  }, [userId]);

  useEffect(() => {
    const local = readLocalStateIfExists();
    if (local) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
    } else {
      const fallback = defaultState();
      setState(fallback);
      lastUpdatedRef.current = fallback.updatedAt || 0;
    }

    const syncFromApi = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const remote = await loadStateFromApi(userId);
        if (!remote) return;
        const remoteUpdatedAt = remote.updatedAt || 0;
        if (remoteUpdatedAt >= lastUpdatedRef.current) {
          lastUpdatedRef.current = remoteUpdatedAt;
          setState(remote);
        }
      } finally {
        syncingRef.current = false;
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const localNow = readLocalStateIfExists();
      if (!localNow) return;
      const localUpdatedAt = localNow.updatedAt || 0;
      if (localUpdatedAt >= lastUpdatedRef.current) {
        lastUpdatedRef.current = localUpdatedAt;
        setState(localNow);
      }
    };

    const timer = window.setInterval(() => {
      void syncFromApi();
    }, 2500);

    window.addEventListener("storage", onStorage);
    void syncFromApi();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [readLocalStateIfExists, userId]);

  return { state, ready: state !== null };
}

function normalizeTarget(donor: Record<string, unknown>): "account" | "toon" {
  const rawType = String(donor.type || "").trim();
  if (rawType === "계좌") return "account";
  if (rawType === "투네이션") return "toon";
  const rawTarget = String(donor.target || "").trim().toLowerCase();
  return rawTarget === "toon" ? "toon" : "account";
}

function aggregateTopN(rows: DonorRow[], limit: number): DonorRow[] {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const key = row.name.trim() || "무명";
    byName.set(key, (byName.get(key) || 0) + Math.max(0, row.amount || 0));
  }
  return Array.from(byName.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, Math.max(1, limit));
}

function readNumber(sp: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = sp.get(key);
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readColor(sp: URLSearchParams, key: string, fallback: string): string {
  const raw = (sp.get(key) || "").trim();
  return raw || fallback;
}

function RankingColumn({
  title,
  items,
  suffix,
  headerBg,
  rowEvenBg,
  rowOddBg,
  panelBg,
  borderColor,
  titleSize,
  rowSize,
  rankSize,
  rankColor,
  nameColor,
  amountColor,
  outlineColor,
}: {
  title: string;
  items: DonorRow[];
  suffix?: string;
  headerBg: string;
  rowEvenBg: string;
  rowOddBg: string;
  panelBg: string;
  borderColor: string;
  titleSize: number;
  rowSize: number;
  rankSize: number;
  rankColor: string;
  nameColor: string;
  amountColor: string;
  outlineColor: string;
}) {
  const outlined = { textShadow: `-1px -1px 0 ${outlineColor},1px -1px 0 ${outlineColor},-1px 1px 0 ${outlineColor},1px 1px 0 ${outlineColor}` } as const;
  return (
    <section
      className="w-full overflow-hidden rounded-xl border"
      style={{ backgroundColor: panelBg, borderColor }}
    >
      <div
        className="px-4 py-3 font-black"
        style={{ backgroundColor: headerBg, fontSize: `${titleSize}px`, ...outlined }}
      >
        {title}
      </div>
      <div className="space-y-1.5 p-2.5">
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <motion.div
              key={item.name}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
              className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2"
              style={{
                borderColor,
                backgroundColor: idx % 2 === 0 ? rowEvenBg : rowOddBg,
                fontSize: `${rowSize}px`,
              }}
            >
              <span className="font-black text-center" style={{ color: rankColor, fontSize: `${rankSize}px`, ...outlined }}>
                {idx + 1}
              </span>
              <span className="truncate font-bold" style={{ color: nameColor, ...outlined }}>
                {item.name}
              </span>
              <span className="font-black tabular-nums text-right" style={{ color: amountColor, ...outlined }}>
                {item.amount.toLocaleString("ko-KR")}
                {suffix ? ` ${suffix}` : " 원"}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

export default function DonorRankingsOverlayPage() {
  const sp = useSearchParams();
  const userId = sp.get("u") || "finalent";
  const { state, ready } = useRemoteState(userId);

  const useTest = (sp.get("test") || "false").toLowerCase() === "true";
  const savedTheme = state?.donorRankingsTheme || defaultState().donorRankingsTheme;

  const topN = Math.floor(readNumber(sp, "top", savedTheme.top, 1, 20));
  const titleSize = readNumber(sp, "titleSize", savedTheme.titleSize, 14, 80);
  const rowSize = readNumber(sp, "rowSize", savedTheme.rowSize, 12, 64);
  const rankSize = readNumber(sp, "rankSize", savedTheme.rankSize, 12, 72);
  const bg = readColor(sp, "bg", savedTheme.bg);
  const panelBg = readColor(sp, "panelBg", savedTheme.panelBg);
  const borderColor = readColor(sp, "border", savedTheme.borderColor);
  const headerAccountBg = readColor(sp, "headerAccountBg", savedTheme.headerAccountBg);
  const headerToonBg = readColor(sp, "headerToonBg", savedTheme.headerToonBg);
  const rowEvenBg = readColor(sp, "rowEvenBg", savedTheme.rowEvenBg);
  const rowOddBg = readColor(sp, "rowOddBg", savedTheme.rowOddBg);
  const rankColor = readColor(sp, "rankColor", savedTheme.rankColor);
  const nameColor = readColor(sp, "nameColor", savedTheme.nameColor);
  const amountColor = readColor(sp, "amountColor", savedTheme.amountColor);
  const outlineColor = readColor(sp, "outline", savedTheme.outlineColor);

  const { accountTop, toonTop } = useMemo(() => {
    if (useTest) {
      return {
        accountTop: TEST_ACCOUNT_ROWS.slice(0, topN),
        toonTop: TEST_TOON_ROWS.slice(0, topN),
      };
    }
    const donors = (state?.donors || []) as Array<Record<string, unknown>>;
    const accountRows: DonorRow[] = [];
    const toonRows: DonorRow[] = [];
    for (const d of donors) {
      const row = {
        name: String(d.name || "무명"),
        amount: Number(d.amount || 0),
      };
      if (normalizeTarget(d) === "toon") toonRows.push(row);
      else accountRows.push(row);
    }
    return {
      accountTop: aggregateTopN(accountRows, topN),
      toonTop: aggregateTopN(toonRows, topN),
    };
  }, [state?.donors, topN, useTest]);

  if (!ready && !useTest) return null;

  return (
    <main className="min-h-screen w-full p-5" style={{ backgroundColor: bg }}>
      <div className="mx-auto max-w-[1500px]">
        {useTest && (
          <div className="mb-2 inline-block rounded bg-amber-600/85 px-2 py-1 text-xs font-bold text-black">
            TEST MODE
          </div>
        )}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <RankingColumn
            title={`계좌 후원 순위 TOP ${topN}`}
            items={accountTop}
            headerBg={headerAccountBg}
            rowEvenBg={rowEvenBg}
            rowOddBg={rowOddBg}
            panelBg={panelBg}
            borderColor={borderColor}
            titleSize={titleSize}
            rowSize={rowSize}
            rankSize={rankSize}
            rankColor={rankColor}
            nameColor={nameColor}
            amountColor={amountColor}
            outlineColor={outlineColor}
          />
          <RankingColumn
            title={`투네 후원 순위 TOP ${topN}`}
            items={toonTop}
            suffix="캐시"
            headerBg={headerToonBg}
            rowEvenBg={rowEvenBg}
            rowOddBg={rowOddBg}
            panelBg={panelBg}
            borderColor={borderColor}
            titleSize={titleSize}
            rowSize={rowSize}
            rankSize={rankSize}
            rankColor={rankColor}
            nameColor={nameColor}
            amountColor={amountColor}
            outlineColor={outlineColor}
          />
        </div>
      </div>
    </main>
  );
}
