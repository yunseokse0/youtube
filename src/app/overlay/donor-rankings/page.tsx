"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import {
  defaultState,
  formatDonorsAmount,
  normalizeDonorRankingsOverlayConfig,
  normalizeDonorsFormat,
  type AppState,
} from "@/lib/state";
import type { DonorsAmountFormat } from "@/types";
import { resolveAnimatedSourceForEmbed } from "@/lib/gif-url";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { useDonorRankingsRemoteState } from "@/hooks/useDonorRankingsRemoteState";
import {
  buildDonorRankingsFromDonors,
  type DonorRankingRow,
} from "@/lib/donor-rankings-aggregate";

type DonorRow = DonorRankingRow;

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

/** 관리자 저장 테마를 실시간 반영(URL에 예전 색·크기가 남아 있어도 덮어쓰지 않음) */
function liveThemeNumber(
  ready: boolean,
  useTest: boolean,
  saved: number,
  sp: URLSearchParams,
  key: string,
  min: number,
  max: number
): number {
  if (ready && !useTest) return Math.max(min, Math.min(max, saved));
  return readNumber(sp, key, saved, min, max);
}

function liveThemeColor(
  ready: boolean,
  useTest: boolean,
  saved: string,
  sp: URLSearchParams,
  key: string,
  fallback: string
): string {
  if (ready && !useTest) {
    const s = (saved || "").trim();
    if (s && s.toLowerCase() !== "transparent") return s;
    return fallback;
  }
  const mergedFallback = (saved || "").trim() || fallback;
  return readColor(sp, key, mergedFallback);
}

/** URL 쿼리 `donorsB64` 최대 길이(과도한 쿼리 방지) */
const DONORS_B64_MAX_LEN = 24_000;

function decodeDonorsB64Param(b64: string): Array<Record<string, unknown>> {
  const t = b64.trim();
  if (!t || t.length > DONORS_B64_MAX_LEN) return [];
  try {
    const pad = t.length % 4 === 0 ? "" : "=".repeat(4 - (t.length % 4));
    const bin = atob(t.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const parsed = JSON.parse(bin) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const arr = o.donors ?? o.items;
      if (Array.isArray(arr)) return arr.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
    }
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * `donorsSrc` / `donorsB64`로 후원 행을 URL에서 가져올 때 사용.
 * - `donorsB64`: base64(JSON 배열 또는 `{ donors: [...] }`) — OBS·링크만으로 주입 가능
 * - `donorsSrc`: 같은 오리진 JSON URL — `donorsPollMs` 지정 시에만 폴링(기본 0, SSE·후원 변경 시 동기화)
 * @returns `undefined`면 `/api/state`의 donors 사용. 배열이면 그걸로만 집계.
 */
function useDonorsOverrideFromUrl(sp: URLSearchParams): Array<Record<string, unknown>> | undefined {
  const donorsB64 = (sp.get("donorsB64") || "").trim();
  const donorsSrc = (sp.get("donorsSrc") || "").trim();
  const pollMs = Math.floor(readNumber(sp, "donorsPollMs", 0, 0, 120_000));

  const b64Rows = useMemo(() => {
    if (!donorsB64) return undefined;
    return decodeDonorsB64Param(donorsB64);
  }, [donorsB64]);

  const [srcRows, setSrcRows] = useState<Array<Record<string, unknown>> | undefined>(undefined);

  useEffect(() => {
    if (donorsB64) {
      setSrcRows(undefined);
      return;
    }
    if (!donorsSrc) {
      setSrcRows(undefined);
      return;
    }

    let cancelled = false;
    const tick = async () => {
      if (typeof window === "undefined") return;
      let href: string;
      try {
        const u = new URL(donorsSrc, window.location.origin);
        if (u.origin !== window.location.origin) return;
        href = u.href;
      } catch {
        return;
      }
      try {
        const res = await fetch(href, { cache: "no-store", credentials: "omit" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as unknown;
        let arr: unknown[] = [];
        if (Array.isArray(data)) arr = data;
        else if (data && typeof data === "object") {
          const o = data as Record<string, unknown>;
          if (Array.isArray(o.donors)) arr = o.donors;
          else if (Array.isArray(o.items)) arr = o.items;
        }
        const rows = arr.filter((x) => x && typeof x === "object") as Array<Record<string, unknown>>;
        if (!cancelled) setSrcRows(rows);
      } catch {
        if (!cancelled) setSrcRows([]);
      }
    };

    void tick();
    if (pollMs <= 0) return;
    const id = window.setInterval(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [donorsB64, donorsSrc, pollMs]);

  if (donorsB64) return b64Rows;
  if (donorsSrc) return srcRows;
  return undefined;
}

/**
 * 패널 등: 저장값이 `transparent`일 때 방송 기본 채색(URL 덮어쓰기 가능).
 * 구버전은 여기서 알파가 큰 그라데이션을 넣어 슬라이더와 무관하게 항상 어둡게 보였음 → 기본은 불투명 단색으로 두고,
 * 헤더(`headerBg`)·목록(`panelBg`) 배경에 동일하게 `overlayOpacity`를 곱한다.
 */
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

function resolveThemeColorLive(
  ready: boolean,
  useTest: boolean,
  sp: URLSearchParams,
  key: string,
  saved: string | undefined,
  broadcastDefault: string
): string {
  if (ready && !useTest) {
    const s = (saved || "").trim();
    if (s && s.toLowerCase() !== "transparent") return s;
    return broadcastDefault;
  }
  return resolveThemeColor(sp, key, saved, broadcastDefault);
}

/**
 * 슬라이더 불투명도를 배경에 반영. hex/rgb/rgba는 알파를 색에 직접 넣어 헤더·목록이 동일 규칙으로 섞이게 하고,
 * linear-gradient 등은 레이어 opacity 유지(OBS·backdrop-blur 조합에서 안정적).
 */
function backgroundWithOpacityFrac(
  bg: string,
  frac: number
): { background: string; opacity?: number } {
  const f = Math.max(0, Math.min(1, frac));
  if (f <= 0) return { background: "transparent" };
  const t = (bg || "").trim();
  if (!t || t.toLowerCase() === "transparent") return { background: "transparent" };

  if (/^linear-gradient\s*\(/i.test(t) || /^radial-gradient\s*\(/i.test(t) || /^url\s*\(/i.test(t)) {
    return { background: t, opacity: f };
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{8}|[0-9a-f]{6})$/i.exec(t);
  if (hex) {
    const h = hex[1];
    const expand = (s: string) =>
      s.length === 3 ? s.split("").map((c) => c + c).join("") : s;
    const full = expand(h);
    if (full.length === 8) {
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      const aByte = parseInt(full.slice(6, 8), 16) / 255;
      return { background: `rgba(${r},${g},${b},${aByte * f})` };
    }
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return { background: `rgba(${r},${g},${b},${f})` };
  }

  const rgb = /^rgb\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i.exec(t);
  if (rgb) {
    return { background: `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${f})` };
  }

  const rgbaM = /^rgba\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*\)$/i.exec(t);
  if (rgbaM) {
    const a = Number(rgbaM[4]) * f;
    return { background: `rgba(${rgbaM[1]},${rgbaM[2]},${rgbaM[3]},${a})` };
  }

  return { background: t, opacity: f };
}

function RankingColumn({
  title,
  items,
  suffix,
  amountFormat,
  headerBg,
  panelBg,
  borderColor,
  titleSize,
  rowSize,
  rankSize,
  rankColor,
  nameColor,
  amountColor,
  titleColor,
  outlineColor,
  headerOpacity,
  unified,
  showColumnDivider,
  panelOpacityFrac,
}: {
  title: string;
  items: DonorRow[];
  suffix?: string;
  amountFormat: DonorsAmountFormat;
  headerBg: string;
  panelBg: string;
  borderColor: string;
  titleSize: number;
  rowSize: number;
  rankSize: number;
  rankColor: string;
  nameColor: string;
  amountColor: string;
  titleColor: string;
  outlineColor: string;
  headerOpacity: number;
  /** true: 단일 외곽 패널 안의 칼럼(관리자 미리보기와 동일한 한 덩어리 레이아웃) */
  unified?: boolean;
  /** unified일 때 좌측 칼럼 오른쪽 구분선(md 이상) */
  showColumnDivider?: boolean;
  /** unified: 헤더·목록 배경에 동일하게 `panelBg`/`headerBg`×투명도 */
  panelOpacityFrac?: number;
}) {
  const outlined = { textShadow: `-1px -1px 0 ${outlineColor},1px -1px 0 ${outlineColor},-1px 1px 0 ${outlineColor},1px 1px 0 ${outlineColor},0 2px 6px rgba(0,0,0,0.38)` } as const;
  const rankLabel = (idx: number): string => {
    if (idx === 0) return "🥇";
    if (idx === 1) return "🥈";
    if (idx === 2) return "🥉";
    return String(idx + 1);
  };
  const outerClass = unified
    ? `relative z-[1] flex min-w-0 flex-1 flex-col overflow-visible ${
        showColumnDivider
          ? "border-b border-solid border-r-0 md:border-b-0 md:border-r md:border-solid"
          : ""
      }`
    : "relative z-[1] w-full overflow-visible rounded-2xl border shadow-[0_12px_32px_rgba(236,72,153,0.14)] backdrop-blur-md";
  const outerStyle: CSSProperties | undefined = unified
    ? { borderColor }
    : {
        background: panelBg,
        borderColor,
      };

  const headerOpacityFrac = unified
    ? Math.max(0, Math.min(1, panelOpacityFrac ?? 1))
    : Math.max(0, Math.min(100, headerOpacity)) / 100;
  const headerBgResolved = backgroundWithOpacityFrac(headerBg, headerOpacityFrac);

  const rowList = (
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
          <span className="break-words font-bold leading-tight" style={{ color: nameColor, ...outlined }}>
            {item.name}
          </span>
          <span className="font-black tabular-nums text-right" style={{ color: amountColor, ...outlined }}>
            {amountFormat === "short"
              ? `${formatDonorsAmount(item.amount, "short")}만`
              : `${formatDonorsAmount(item.amount, "full")}${suffix ? ` ${suffix}` : " 원"}`}
          </span>
        </motion.div>
      ))}
    </AnimatePresence>
  );

  return (
    <section className={outerClass} style={outerStyle}>
      <div
        className="relative overflow-hidden px-4 py-3 font-black border-b text-center"
        style={{
          borderColor: "rgba(255, 232, 244, 0.55)",
          color: titleColor,
          fontSize: `${titleSize}px`,
          ...outlined,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: headerBgResolved.background,
            ...(headerBgResolved.opacity !== undefined ? { opacity: headerBgResolved.opacity } : {}),
          }}
        />
        <span className="relative z-10">{title}</span>
      </div>
      {unified ? (
        <div className="relative min-h-0 flex-1">
          <div
            className="pointer-events-none absolute inset-0 z-0 rounded-none"
            aria-hidden
            style={backgroundWithOpacityFrac(panelBg, Math.max(0, Math.min(1, panelOpacityFrac ?? 1)))}
          />
          <div className="relative z-[1] space-y-1 px-3 py-2.5">{rowList}</div>
        </div>
      ) : (
        <div className="space-y-1 p-2.5">{rowList}</div>
      )}
    </section>
  );
}

export default function DonorRankingsOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useDonorRankingsRemoteState(userId);
  const overlayCfg = useMemo(
    () => normalizeDonorRankingsOverlayConfig(state?.donorRankingsOverlayConfig),
    [state?.donorRankingsOverlayConfig]
  );

  const useTest = (sp.get("test") || "false").toLowerCase() === "true";
  const layoutDual = (sp.get("layout") || "").toLowerCase() === "dual";
  const savedTheme = state?.donorRankingsTheme || defaultState().donorRankingsTheme;

  const showAllDonors =
    (sp.get("all") || "").trim() === "1" || (sp.get("top") || "").trim() === "0";
  const topN = showAllDonors
    ? 0
    : liveThemeNumber(ready, useTest, savedTheme.top, sp, "top", 1, 50);
  const titleSize = liveThemeNumber(ready, useTest, savedTheme.titleSize, sp, "titleSize", 14, 80);
  const rowSize = liveThemeNumber(ready, useTest, savedTheme.rowSize, sp, "rowSize", 12, 64);
  const rankSize = liveThemeNumber(ready, useTest, savedTheme.rankSize, sp, "rankSize", 12, 72);
  const overlayOpacity = liveThemeNumber(ready, useTest, savedTheme.overlayOpacity, sp, "overlayOpacity", 0, 100);
  const zoomPct = Math.floor(readNumber(sp, "zoomPct", 100, 30, 300));
  const zoomScale = zoomPct / 100;
  const bg =
    ready && !useTest
      ? (savedTheme.bg || "").trim() || "transparent"
      : readColor(sp, "bg", savedTheme.bg) || "transparent";
  /** 어두운 기본값 + 투명도 시 방송 화면과 섞여 버건디로 보이므로 밝은 파스텔 핑크를 기본으로 */
  const panelBg = resolveThemeColorLive(ready, useTest, sp, "panelBg", savedTheme.panelBg, "rgba(255, 248, 252, 1)");
  const borderColor = resolveThemeColorLive(
    ready,
    useTest,
    sp,
    "border",
    savedTheme.borderColor,
    "rgba(255, 210, 232, 0.42)"
  );
  const headerAccountBg = liveThemeColor(
    ready,
    useTest,
    savedTheme.headerAccountBg,
    sp,
    "headerAccountBg",
    "linear-gradient(135deg, #fff5fa 0%, #ffd6ea 48%, #ffb7d6 100%)"
  );
  const headerToonBg = liveThemeColor(
    ready,
    useTest,
    savedTheme.headerToonBg,
    sp,
    "headerToonBg",
    "linear-gradient(135deg, #fff4f9 0%, #ffc8e6 48%, #ffa3cf 100%)"
  );
  const headerUnifiedBg = readColor(sp, "headerBg", headerAccountBg) || headerAccountBg;
  const rankingTitle = (sp.get("title") || "").trim() || "후원 순위";
  const rankColor = liveThemeColor(ready, useTest, savedTheme.rankColor, sp, "rankColor", "#fff5f9");
  const nameColor = liveThemeColor(ready, useTest, savedTheme.nameColor, sp, "nameColor", "#fff7fb");
  const amountColor = liveThemeColor(ready, useTest, savedTheme.amountColor, sp, "amountColor", "#fff7ed");
  const titleColor = liveThemeColor(ready, useTest, savedTheme.titleColor, sp, "titleColor", "#fff7fb");
  const outlineColor = liveThemeColor(
    ready,
    useTest,
    savedTheme.outlineColor,
    sp,
    "outline",
    "rgba(58, 6, 28, 0.85)"
  );
  const showBgLayer = overlayCfg.isBgEnabled && Boolean(overlayCfg.bgGifUrl.trim());
  const bgAnimated = useMemo(() => resolveAnimatedSourceForEmbed(overlayCfg.bgGifUrl), [overlayCfg.bgGifUrl]);
  const bgOpacityPct = Math.max(0, Math.min(100, overlayCfg.bgOpacity)) / 100;
  const overlayOpacityFrac = Math.max(0, Math.min(100, overlayOpacity)) / 100;
  const amountFormat = normalizeDonorsFormat(state?.donorsFormat, "full");

  const donorsOverride = useDonorsOverrideFromUrl(sp);

  const { accountTop, toonTop, unifiedTop } = useMemo(() => {
    if (useTest) {
      return buildDonorRankingsFromDonors(
        [
          ...TEST_ACCOUNT_ROWS.map((row) => ({ name: row.name, amount: row.amount, target: "account" })),
          ...TEST_TOON_ROWS.map((row) => ({ name: row.name, amount: row.amount, target: "toon" })),
        ],
        topN
      );
    }
    const donors = (donorsOverride !== undefined ? donorsOverride : state?.donors || []) as Array<
      Record<string, unknown>
    >;
    return buildDonorRankingsFromDonors(donors, topN);
  }, [state?.donors, useTest, donorsOverride, topN]);

  if (!ready && !useTest) return null;

  return (
    <main
      className="relative min-h-screen w-full overflow-visible bg-transparent p-5 md:[background:var(--ov-donor-bg)]"
      style={{ ["--ov-donor-bg" as string]: bg } as CSSProperties}
    >
      {showBgLayer ? (
        <div className="pointer-events-none fixed inset-0 z-0" aria-hidden>
          {bgAnimated.kind === "video" ? (
            <video
              src={bgAnimated.src.trim()}
              className="h-full w-full object-cover"
              style={{ opacity: bgOpacityPct }}
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
            />
          ) : (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={bgAnimated.src.trim()}
                alt=""
                width={1920}
                height={1080}
                className="h-full w-full object-cover"
                style={{ opacity: bgOpacityPct }}
                loading="eager"
                decoding="async"
                fetchPriority="high"
              />
            </>
          )}
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
        {layoutDual ? (
          <div
            className="relative grid grid-cols-1 overflow-visible rounded-2xl border shadow-[0_12px_32px_rgba(236,72,153,0.14)] backdrop-blur-md md:grid-cols-2 md:gap-0"
            style={{
              borderColor,
              backgroundColor: "transparent",
            }}
          >
            <RankingColumn
              title="계좌 후원 순위"
              items={accountTop}
              amountFormat={amountFormat}
              headerBg={headerAccountBg}
              panelBg={panelBg}
              borderColor={borderColor}
              titleSize={titleSize}
              rowSize={rowSize}
              rankSize={rankSize}
              rankColor={rankColor}
              nameColor={nameColor}
              amountColor={amountColor}
              titleColor={titleColor}
              outlineColor={outlineColor}
              headerOpacity={overlayOpacity}
              unified
              showColumnDivider
              panelOpacityFrac={overlayOpacityFrac}
            />
            <RankingColumn
              title="투네 후원 순위"
              items={toonTop}
              suffix="캐시"
              amountFormat={amountFormat}
              headerBg={headerToonBg}
              panelBg={panelBg}
              borderColor={borderColor}
              titleSize={titleSize}
              rowSize={rowSize}
              rankSize={rankSize}
              rankColor={rankColor}
              nameColor={nameColor}
              amountColor={amountColor}
              titleColor={titleColor}
              outlineColor={outlineColor}
              headerOpacity={overlayOpacity}
              unified
              panelOpacityFrac={overlayOpacityFrac}
            />
          </div>
        ) : (
          <div
            className="relative mx-auto max-w-[760px] overflow-visible rounded-2xl border shadow-[0_12px_32px_rgba(236,72,153,0.14)] backdrop-blur-md"
            style={{
              borderColor,
              backgroundColor: "transparent",
            }}
          >
            <RankingColumn
              title={rankingTitle}
              items={unifiedTop}
              amountFormat={amountFormat}
              headerBg={headerUnifiedBg}
              panelBg={panelBg}
              borderColor={borderColor}
              titleSize={titleSize}
              rowSize={rowSize}
              rankSize={rankSize}
              rankColor={rankColor}
              nameColor={nameColor}
              amountColor={amountColor}
              titleColor={titleColor}
              outlineColor={outlineColor}
              headerOpacity={overlayOpacity}
              unified
              panelOpacityFrac={overlayOpacityFrac}
            />
          </div>
        )}
      </div>
    </main>
  );
}
