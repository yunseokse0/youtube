"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import {
  defaultState,
  loadState,
  loadStateFromApi,
  normalizeDonorRankingsOverlayConfig,
  storageKey,
  type AppState,
} from "@/lib/state";
import { resolveGifUrlForEmbed } from "@/lib/gif-url";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";

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
        lastUpdatedRef.current = remoteUpdatedAt;
        setState(remote);
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

function aggregateAll(rows: DonorRow[]): DonorRow[] {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const key = row.name.trim() || "무명";
    byName.set(key, (byName.get(key) || 0) + Math.max(0, row.amount || 0));
  }
  return Array.from(byName.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);
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

/** 저장값이 `transparent`일 때 밝은 카메라 배경에서도 보이도록 방송용 기본값 사용(URL로 덮어쓰기 가능) */
function resolveThemeColor(
  sp: URLSearchParams,
  key: string,
  saved: string | undefined,
  broadcastDefault: string
): string {
  const fromUrl = (sp.get(key) || "").trim();
  if (fromUrl) return fromUrl;
  const s = (saved || "").trim();
  if (s && s.toLowerCase() !== "transparent") return s;
  return broadcastDefault;
}

function RankingColumn({
  title,
  items,
  suffix,
  headerBg,
  panelBg,
  borderColor,
  titleSize,
  rowSize,
  rankSize,
  rankColor,
  nameColor,
  amountColor,
  outlineColor,
  headerOpacity,
  unified,
  showColumnDivider,
}: {
  title: string;
  items: DonorRow[];
  suffix?: string;
  headerBg: string;
  panelBg: string;
  borderColor: string;
  titleSize: number;
  rowSize: number;
  rankSize: number;
  rankColor: string;
  nameColor: string;
  amountColor: string;
  outlineColor: string;
  headerOpacity: number;
  /** true: 단일 외곽 패널 안의 칼럼(관리자 미리보기와 동일한 한 덩어리 레이아웃) */
  unified?: boolean;
  /** unified일 때 좌측 칼럼 오른쪽 구분선(md 이상) */
  showColumnDivider?: boolean;
}) {
  const outlined = { textShadow: `-1px -1px 0 ${outlineColor},1px -1px 0 ${outlineColor},-1px 1px 0 ${outlineColor},1px 1px 0 ${outlineColor},0 2px 6px rgba(0,0,0,0.38)` } as const;
  const rankLabel = (idx: number): string => {
    if (idx === 0) return "🥇";
    if (idx === 1) return "🥈";
    if (idx === 2) return "🥉";
    return String(idx + 1);
  };
  const outerClass = unified
    ? `flex min-w-0 flex-1 flex-col overflow-hidden ${
        showColumnDivider
          ? "border-b border-solid border-r-0 md:border-b-0 md:border-r md:border-solid"
          : ""
      }`
    : "w-full overflow-hidden rounded-2xl border shadow-[0_10px_28px_rgba(76,5,25,0.32)] backdrop-blur-md";
  const outerStyle: CSSProperties | undefined = unified
    ? { borderColor }
    : {
        background: panelBg,
        borderColor,
      };

  return (
    <section className={outerClass} style={outerStyle}>
      <div
        className="relative overflow-hidden px-4 py-3 font-black border-b text-center"
        style={{
          borderColor: "rgba(255, 232, 244, 0.55)",
          color: "#fff7fb",
          fontSize: `${titleSize}px`,
          ...outlined,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: headerBg,
            opacity: Math.max(0, Math.min(100, headerOpacity)) / 100,
          }}
        />
        <span className="relative z-10">{title}</span>
      </div>
      <div className={`space-y-1 ${unified ? "flex-1 px-3 py-2.5" : "p-2.5"}`}>
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <motion.div
              key={item.name}
              layout
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
              className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2 px-1 py-1"
              style={{
                fontSize: `${rowSize}px`,
              }}
            >
              <span className="font-black text-center" style={{ color: rankColor, fontSize: `${rankSize}px`, ...outlined }}>
                {rankLabel(idx)}
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
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useRemoteState(userId);
  const overlayCfg = useMemo(
    () => normalizeDonorRankingsOverlayConfig(state?.donorRankingsOverlayConfig),
    [state?.donorRankingsOverlayConfig]
  );

  const useTest = (sp.get("test") || "false").toLowerCase() === "true";
  const savedTheme = state?.donorRankingsTheme || defaultState().donorRankingsTheme;

  const titleSize = readNumber(sp, "titleSize", savedTheme.titleSize, 14, 80);
  const rowSize = readNumber(sp, "rowSize", savedTheme.rowSize, 12, 64);
  const rankSize = readNumber(sp, "rankSize", savedTheme.rankSize, 12, 72);
  const overlayOpacity = readNumber(sp, "overlayOpacity", savedTheme.overlayOpacity, 0, 100);
  const zoomPct = Math.floor(readNumber(sp, "zoomPct", 100, 30, 300));
  const zoomScale = zoomPct / 100;
  const bg = readColor(sp, "bg", savedTheme.bg) || "transparent";
  const panelBg = resolveThemeColor(
    sp,
    "panelBg",
    savedTheme.panelBg,
    "linear-gradient(180deg, rgba(26,10,22,0.88) 0%, rgba(14,6,14,0.84) 100%)"
  );
  const borderColor = resolveThemeColor(
    sp,
    "border",
    savedTheme.borderColor,
    "rgba(255, 210, 232, 0.42)"
  );
  const headerAccountBg =
    readColor(sp, "headerAccountBg", savedTheme.headerAccountBg) ||
    "linear-gradient(135deg, #ffd6ea 0%, #ff9ec8 56%, #f75c9c 100%)";
  const headerToonBg =
    readColor(sp, "headerToonBg", savedTheme.headerToonBg) ||
    "linear-gradient(135deg, #ffd2e8 0%, #ff8ebf 56%, #ef4f96 100%)";
  const rankColor = readColor(sp, "rankColor", savedTheme.rankColor) || "#fff5f9";
  const nameColor = readColor(sp, "nameColor", savedTheme.nameColor) || "#fff7fb";
  const amountColor = readColor(sp, "amountColor", savedTheme.amountColor) || "#fff7ed";
  const outlineColor = readColor(sp, "outline", savedTheme.outlineColor) || "rgba(58, 6, 28, 0.85)";
  const showBgLayer = overlayCfg.isBgEnabled && Boolean(overlayCfg.bgGifUrl.trim());
  const bgGifSrc = useMemo(() => resolveGifUrlForEmbed(overlayCfg.bgGifUrl), [overlayCfg.bgGifUrl]);
  const bgOpacityPct = Math.max(0, Math.min(100, overlayCfg.bgOpacity)) / 100;

  const { accountTop, toonTop } = useMemo(() => {
    if (useTest) {
      return {
        accountTop: [...TEST_ACCOUNT_ROWS],
        toonTop: [...TEST_TOON_ROWS],
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
      accountTop: aggregateAll(accountRows),
      toonTop: aggregateAll(toonRows),
    };
  }, [state?.donors, useTest]);

  if (!ready && !useTest) return null;

  return (
    <main className="relative min-h-screen w-full overflow-hidden p-5" style={{ backgroundColor: bg }}>
      {showBgLayer ? (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={bgGifSrc.trim()}
            alt=""
            width={1920}
            height={1080}
            className="h-full w-full object-cover"
            style={{ opacity: bgOpacityPct }}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        </div>
      ) : null}
      <div
        className="relative z-10 mx-auto max-w-[1500px]"
        style={{
          transform: `scale(${zoomScale})`,
          transformOrigin: "top center",
          width: `${100 / zoomScale}%`,
        }}
      >
        {useTest && (
          <div className="mb-2 inline-block rounded bg-amber-600/85 px-2 py-1 text-xs font-bold text-black">
            TEST MODE
          </div>
        )}
        <div
          className="grid grid-cols-1 overflow-hidden rounded-2xl border shadow-[0_10px_28px_rgba(76,5,25,0.32)] backdrop-blur-md md:grid-cols-2 md:gap-0"
          style={{
            background: panelBg,
            borderColor,
          }}
        >
          <RankingColumn
            title="계좌 후원 순위"
            items={accountTop}
            headerBg={headerAccountBg}
            panelBg={panelBg}
            borderColor={borderColor}
            titleSize={titleSize}
            rowSize={rowSize}
            rankSize={rankSize}
            rankColor={rankColor}
            nameColor={nameColor}
            amountColor={amountColor}
            outlineColor={outlineColor}
            headerOpacity={overlayOpacity}
            unified
            showColumnDivider
          />
          <RankingColumn
            title="투네 후원 순위"
            items={toonTop}
            suffix="캐시"
            headerBg={headerToonBg}
            panelBg={panelBg}
            borderColor={borderColor}
            titleSize={titleSize}
            rowSize={rowSize}
            rankSize={rankSize}
            rankColor={rankColor}
            nameColor={nameColor}
            amountColor={amountColor}
            outlineColor={outlineColor}
            headerOpacity={overlayOpacity}
            unified
          />
        </div>
      </div>
    </main>
  );
}
