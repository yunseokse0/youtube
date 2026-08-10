"use client";

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import {
  defaultState,
  formatDonorsAmount,
  normalizeDonorRankingsOverlayConfig,
  normalizeDonorsFormat,
  type AppState,
} from "@/lib/state";
import type { DonorsAmountFormat } from "@/types";
import { resolveAnimatedSourceForEmbed } from "@/lib/gif-url";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import { useDonorRankingsRemoteState } from "@/hooks/useDonorRankingsRemoteState";
import {
  buildDonorRankingsFromDonors,
  type DonorRankingRow,
} from "@/lib/donor-rankings-aggregate";
import {
  buildBroadcastTextOutlineShadowCss,
  buildOverlayCellOutlineStyle,
  DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR,
} from "@/lib/text-outline-style";
import { resolveBroadcastZoomScale } from "@/lib/overlay-mobile-fit";
import { useOverlayViewportSize } from "@/hooks/useOverlayViewportSize";

function readOutlineWidth(sp: URLSearchParams, key: string, fallback: number): number {
  const raw = sp.get(key);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(3, n));
}

function liveThemeOutlineWidth(
  ready: boolean,
  useTest: boolean,
  saved: number,
  sp: URLSearchParams
): number {
  if (ready && !useTest) return Math.max(0, Math.min(3, saved));
  return readOutlineWidth(sp, "outlineWidth", saved);
}

function donorRankingsOutlineCssBlock(outlineColor: string, outlineWidthPx?: number): string {
  const resolved = outlineColor.trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR;
  const shadow = buildBroadcastTextOutlineShadowCss({
    outlineColor: resolved,
    outlineWidthPx,
  });
  if (!shadow) return "";
  return `
    .donor-rankings-overlay-root .overlay-cell-text-inner {
      display: inline-block;
      overflow: visible;
      white-space: inherit;
      vertical-align: middle;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
      paint-order: stroke fill !important;
      text-shadow: ${shadow} !important;
    }
    /* 트로피·이모지 순위 아이콘에는 외곽선 링을 먹지 않게 (깨져 보이는 원인) */
    .donor-rankings-overlay-root .overlay-rank-icon,
    .donor-rankings-overlay-root .overlay-rank-icon .overlay-cell-text-inner {
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
      paint-order: normal !important;
    }
  `;
}

/** 웹후원 스타일 1~3위 트로피 (금/은/동 + 별) */
function RankTrophyIcon({ place, sizePx }: { place: 1 | 2 | 3; sizePx: number }) {
  const size = Math.max(18, Math.round(sizePx * 1.15));
  const cup =
    place === 1 ? { fill: "#ffc107", stroke: "#b45309" } : place === 2 ? { fill: "#e8eef5", stroke: "#64748b" } : { fill: "#d97706", stroke: "#7c2d12" };
  const base =
    place === 1 ? "#dc2626" : place === 2 ? "#2563eb" : "#78350f";
  const star = place === 1 ? "#fff7ed" : place === 2 ? "#dbeafe" : "#fef3c7";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className="overlay-rank-icon mx-auto block shrink-0"
      aria-hidden
    >
      <path
        d="M8 6h16v2.2c0 5.2-3.2 9.2-8 10.2-4.8-1-8-5-8-10.2V6z"
        fill={cup.fill}
        stroke={cup.stroke}
        strokeWidth="1.4"
      />
      <path d="M8 8H5.2c0 3.2 1.4 5.4 3.4 6.4" fill="none" stroke={cup.stroke} strokeWidth="1.3" />
      <path d="M24 8h2.8c0 3.2-1.4 5.4-3.4 6.4" fill="none" stroke={cup.stroke} strokeWidth="1.3" />
      <rect x="13.2" y="18.2" width="5.6" height="3.2" rx="0.8" fill={cup.stroke} />
      <path d="M10 26.5h12l-1.2-3.6H11.2L10 26.5z" fill={base} />
      <rect x="9" y="26.5" width="14" height="2.4" rx="0.7" fill={base} />
      <path
        d="M16 9.2l1.1 2.2 2.4.4-1.7 1.7.4 2.4-2.2-1.1-2.2 1.1.4-2.4-1.7-1.7 2.4-.4L16 9.2z"
        fill={star}
        stroke={cup.stroke}
        strokeWidth="0.6"
      />
    </svg>
  );
}

type DonorRow = DonorRankingRow;

const TEST_ACCOUNT_ROWS: DonorRow[] = [
  { name: "샘플후원A", amount: 3849000 },
  { name: "샘플후원B", amount: 2614000 },
  { name: "샘플후원C", amount: 1116000 },
  { name: "샘플후원D", amount: 819000 },
  { name: "샘플후원E", amount: 542900 },
  { name: "샘플후원F", amount: 420000 },
  { name: "샘플후원G", amount: 315000 },
];

const TEST_TOON_ROWS: DonorRow[] = [
  { name: "테스트투네1", amount: 700000 },
  { name: "테스트투네2", amount: 115000 },
  { name: "테스트투네3", amount: 108000 },
  { name: "테스트투네4", amount: 84000 },
  { name: "테스트투네5", amount: 70000 },
  { name: "테스트투네6", amount: 50000 },
  { name: "테스트투네7", amount: 10000 },
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

function liveThemeTitle(
  ready: boolean,
  useTest: boolean,
  saved: string,
  sp: URLSearchParams,
  fallback: string
): string {
  const fromUrl = (sp.get("title") || "").trim();
  /** 관리자 미리보기: 입력 중인 제목(URL)을 우선 — 원격 기본값과 어긋나지 않게 */
  const adminPreview =
    sp.get("adminPreviewEmbed") === "1" || sp.get("hubPreview") === "1";
  if (adminPreview && fromUrl) return fromUrl.slice(0, 60);
  if (ready && !useTest) {
    const s = (saved || "").trim();
    return s || fallback;
  }
  return fromUrl || (saved || "").trim() || fallback;
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

function RankingRow({
  item,
  idx,
  rowSize,
  rankSize,
  rankColor,
  nameColor,
  amountColor,
  outlineColor,
  outlineWidthPx,
  rowEvenBg,
  rowOddBg,
  amountFormat,
  suffix,
  disableMotion,
}: {
  item: DonorRow;
  idx: number;
  rowSize: number;
  rankSize: number;
  rankColor: string;
  nameColor: string;
  amountColor: string;
  outlineColor: string;
  outlineWidthPx?: number;
  rowEvenBg?: string;
  rowOddBg?: string;
  amountFormat: DonorsAmountFormat;
  suffix?: string;
  disableMotion?: boolean;
}) {
  const resolvedOutlineColor = outlineColor.trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR;
  const rankOutline = buildOverlayCellOutlineStyle({
    fontSizePx: rankSize,
    outlineColor: resolvedOutlineColor,
    outlineWidthPx,
  });
  const rowOutline = buildOverlayCellOutlineStyle({
    fontSizePx: rowSize,
    outlineColor: resolvedOutlineColor,
    outlineWidthPx,
  });
  const isTrophy = idx <= 2;
  const rowStyle: CSSProperties = {
    fontSize: `${rowSize}px`,
    backgroundColor: idx % 2 === 0 ? rowEvenBg || "transparent" : rowOddBg || "transparent",
  };
  const inner = (
    <>
      <span className="flex items-center justify-center leading-none">
        {isTrophy ? (
          <RankTrophyIcon place={(idx + 1) as 1 | 2 | 3} sizePx={rankSize} />
        ) : (
          <span
            className="overlay-cell-text-inner font-black text-center leading-none"
            style={{ color: rankColor, fontSize: `${rankSize}px`, ...rankOutline }}
          >
            {`${idx + 1}등`}
          </span>
        )}
      </span>
      <span
        className="overlay-cell-text-inner break-words font-bold leading-tight"
        style={{ color: nameColor, ...rowOutline }}
      >
        {item.name}
      </span>
      <span
        className="overlay-cell-text-inner font-black tabular-nums text-right whitespace-nowrap"
        style={{ color: amountColor, ...rowOutline }}
      >
        {amountFormat === "short"
          ? `${formatDonorsAmount(item.amount, "short")}만`
          : `${formatDonorsAmount(item.amount, "full")}${suffix ? ` ${suffix}` : " 원"}`}
      </span>
    </>
  );
  const rowClass =
    "grid grid-cols-[2.75em_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0 px-2.5 py-1.5 border-b border-white/40 last:border-b-0";
  if (disableMotion) {
    return (
      <div className={rowClass} style={rowStyle}>
        {inner}
      </div>
    );
  }
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
      className={rowClass}
      style={rowStyle}
    >
      {inner}
    </motion.div>
  );
}

function DonorRankingsBodyImage({ url, opacityPct }: { url: string; opacityPct: number }) {
  const animated = useMemo(() => resolveAnimatedSourceForEmbed(url), [url]);
  const opacity = Math.max(0, Math.min(100, opacityPct)) / 100;
  const src = animated.src.trim();
  if (!src) return null;
  return (
    <div className="relative z-[1] flex w-full items-center justify-center px-3 py-2" aria-hidden>
      {animated.kind === "video" ? (
        <video
          src={src}
          className="max-h-[220px] w-auto max-w-full object-contain"
          style={{ opacity }}
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
            src={src}
            alt=""
            className="max-h-[220px] w-auto max-w-full object-contain"
            style={{ opacity }}
            loading="eager"
            decoding="async"
          />
        </>
      )}
    </div>
  );
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
  outlineWidthPx,
  headerOpacity,
  unified,
  showColumnDivider,
  panelOpacityFrac,
  rowEvenBg,
  rowOddBg,
  disableMotion,
  bodyImageBelowTitle,
  bodyImageBelowList,
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
  outlineWidthPx?: number;
  headerOpacity: number;
  /** true: 단일 외곽 패널 안의 칼럼(관리자 미리보기와 동일한 한 덩어리 레이아웃) */
  unified?: boolean;
  /** unified일 때 좌측 칼럼 오른쪽 구분선(md 이상) */
  showColumnDivider?: boolean;
  /** unified: 목록은 `panelBg`, 헤더는 `headerBg`에 각각 투명도 적용 */
  panelOpacityFrac?: number;
  rowEvenBg?: string;
  rowOddBg?: string;
  /** OBS CEF: framer-motion initial opacity 0 이 고착되면 전체가 안 보임 */
  disableMotion?: boolean;
  bodyImageBelowTitle?: ReactNode;
  bodyImageBelowList?: ReactNode;
}) {
  const titleOutline = buildOverlayCellOutlineStyle({
    fontSizePx: titleSize,
    outlineColor: outlineColor.trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR,
    outlineWidthPx,
  });
  const outerClass = unified
    ? `relative z-[1] flex min-w-0 flex-1 flex-col overflow-visible ${
        showColumnDivider
          ? "border-b border-solid border-r-0 md:border-b-0 md:border-r md:border-solid"
          : ""
      }`
    : "relative z-[1] w-full overflow-visible rounded-2xl border shadow-[0_8px_28px_rgba(15,23,42,0.18)] backdrop-blur-md";
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

  const rowList = disableMotion ? (
    <div className="space-y-0">
      {items.map((item, idx) => (
        <RankingRow
          key={item.name}
          item={item}
          idx={idx}
          rowSize={rowSize}
          rankSize={rankSize}
          rankColor={rankColor}
          nameColor={nameColor}
          amountColor={amountColor}
          outlineColor={outlineColor}
          outlineWidthPx={outlineWidthPx}
          rowEvenBg={rowEvenBg}
          rowOddBg={rowOddBg}
          amountFormat={amountFormat}
          suffix={suffix}
          disableMotion
        />
      ))}
    </div>
  ) : (
    <AnimatePresence initial={false}>
      {items.map((item, idx) => (
        <RankingRow
          key={item.name}
          item={item}
          idx={idx}
          rowSize={rowSize}
          rankSize={rankSize}
          rankColor={rankColor}
          nameColor={nameColor}
          amountColor={amountColor}
          outlineColor={outlineColor}
          outlineWidthPx={outlineWidthPx}
          rowEvenBg={rowEvenBg}
          rowOddBg={rowOddBg}
          amountFormat={amountFormat}
          suffix={suffix}
        />
      ))}
    </AnimatePresence>
  );

  return (
    <section className={outerClass} style={outerStyle}>
      <div
        className={`relative overflow-hidden px-4 py-2.5 font-black text-center ${
          unified ? "border-b border-white/40" : "border-b border-white/28"
        }`}
        style={{
          color: titleColor,
          fontSize: `${titleSize}px`,
          ...titleOutline,
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background: headerBgResolved.background,
            ...(headerBgResolved.opacity !== undefined ? { opacity: headerBgResolved.opacity } : {}),
          }}
        />
        <span className="overlay-cell-text-inner relative z-10 tracking-tight">{title}</span>
      </div>
      {bodyImageBelowTitle}
      {unified ? (
        <div className="relative min-h-0 flex-1">
          <div
            className="pointer-events-none absolute inset-0 z-0 rounded-none"
            aria-hidden
            style={backgroundWithOpacityFrac(panelBg, Math.max(0, Math.min(1, panelOpacityFrac ?? 1)))}
          />
          <div className="relative z-[1] px-2 py-1.5">{rowList}</div>
        </div>
      ) : (
        <div className="p-2">{rowList}</div>
      )}
      {bodyImageBelowList}
    </section>
  );
}

export default function DonorRankingsOverlayPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const hostObs = isOverlayBroadcastHost(sp);
  const { state, ready, resync } = useDonorRankingsRemoteState(userId);

  useEffect(() => {
    if (!hostObs) return;
    const onVis = () => {
      if (document.visibilityState === "visible") void resync({ forceFull: true });
    };
    document.addEventListener("visibilitychange", onVis);
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void resync({ forceFull: true });
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [hostObs, resync]);
  const overlayCfg = useMemo(
    () => normalizeDonorRankingsOverlayConfig(state?.donorRankingsOverlayConfig),
    [state?.donorRankingsOverlayConfig]
  );

  const useTest = (sp.get("test") || "false").toLowerCase() === "true";
  const layoutDual = (sp.get("layout") || "").toLowerCase() === "dual";
  const savedTheme = state?.donorRankingsTheme || defaultState().donorRankingsTheme;

  const showAllDonors = (sp.get("all") || "").trim() === "1" || (sp.get("top") || "").trim() === "0";
  const topN = showAllDonors
    ? 0
    : liveThemeNumber(ready, useTest, savedTheme.top, sp, "top", 1, 50);
  const titleSize = liveThemeNumber(ready, useTest, savedTheme.titleSize, sp, "titleSize", 14, 80);
  const rowSize = liveThemeNumber(ready, useTest, savedTheme.rowSize, sp, "rowSize", 12, 64);
  const rankSize = liveThemeNumber(ready, useTest, savedTheme.rankSize, sp, "rankSize", 12, 72);
  const overlayOpacity = liveThemeNumber(ready, useTest, savedTheme.overlayOpacity, sp, "overlayOpacity", 0, 100);
  const zoomPct = Math.floor(readNumber(sp, "zoomPct", 100, 30, 300));
  const viewportSize = useOverlayViewportSize();
  const zoomScale = useMemo(
    () => resolveBroadcastZoomScale(zoomPct, viewportSize.w, 1500),
    [zoomPct, viewportSize.w]
  );
  const bg =
    ready && !useTest
      ? (savedTheme.bg || "").trim() || "transparent"
      : readColor(sp, "bg", savedTheme.bg) || "transparent";
  /** 웹후원 순위 기본 — 반투명 밝은 패널 */
  const panelBg = resolveThemeColorLive(ready, useTest, sp, "panelBg", savedTheme.panelBg, "rgba(232, 232, 236, 0.7)");
  const borderColor = resolveThemeColorLive(
    ready,
    useTest,
    sp,
    "border",
    savedTheme.borderColor,
    "transparent"
  );
  const headerAccountBg = liveThemeColor(
    ready,
    useTest,
    savedTheme.headerAccountBg,
    sp,
    "headerAccountBg",
    "rgba(232, 232, 236, 0.55)"
  );
  const headerToonBg = liveThemeColor(
    ready,
    useTest,
    savedTheme.headerToonBg,
    sp,
    "headerToonBg",
    "rgba(232, 232, 236, 0.55)"
  );
  const headerUnifiedBg = readColor(sp, "headerBg", headerAccountBg) || headerAccountBg;
  const rankingTitle = liveThemeTitle(ready, useTest, savedTheme.titleText, sp, "👑 웹후원 순위 👑");
  const rowEvenBg = liveThemeColor(ready, useTest, savedTheme.rowEvenBg, sp, "rowEvenBg", "transparent");
  const rowOddBg = liveThemeColor(ready, useTest, savedTheme.rowOddBg, sp, "rowOddBg", "rgba(255, 255, 255, 0.14)");
  const rankColor = liveThemeColor(ready, useTest, savedTheme.rankColor, sp, "rankColor", "#ffffff");
  const nameColor = liveThemeColor(ready, useTest, savedTheme.nameColor, sp, "nameColor", "#ffc107");
  const amountColor = liveThemeColor(ready, useTest, savedTheme.amountColor, sp, "amountColor", "#ffc107");
  const titleColor = liveThemeColor(ready, useTest, savedTheme.titleColor, sp, "titleColor", "#ffffff");
  const outlineColor = liveThemeColor(
    ready,
    useTest,
    savedTheme.outlineColor,
    sp,
    "outline",
    "rgba(20, 12, 6, 0.96)"
  );
  const outlineWidthPx = liveThemeOutlineWidth(ready, useTest, savedTheme.outlineWidth, sp);
  const showBgLayer = overlayCfg.isBgEnabled && Boolean(overlayCfg.bgGifUrl.trim());
  const bgAnimated = useMemo(() => resolveAnimatedSourceForEmbed(overlayCfg.bgGifUrl), [overlayCfg.bgGifUrl]);
  const bgOpacityPct = Math.max(0, Math.min(100, overlayCfg.bgOpacity)) / 100;
  const overlayOpacityFrac = Math.max(0, Math.min(100, overlayOpacity)) / 100;
  const amountFormat = normalizeDonorsFormat(state?.donorsFormat, "full");
  const showBodyImage =
    overlayCfg.isBodyImageEnabled && Boolean(String(overlayCfg.bodyImageUrl || "").trim());
  const bodyImageEl = showBodyImage ? (
    <DonorRankingsBodyImage url={overlayCfg.bodyImageUrl} opacityPct={overlayCfg.bodyImageOpacity} />
  ) : null;
  const bodyPos = overlayCfg.bodyImagePosition;
  const showFrame =
    overlayCfg.isFrameEnabled && Boolean(String(overlayCfg.frameUrl || "").trim());
  const frameInsetPx = Math.max(0, Math.min(120, Math.round(Number(overlayCfg.frameInset) || 32)));
  const frameOpacityFrac = Math.max(0, Math.min(100, Number(overlayCfg.frameOpacity) || 100)) / 100;

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

  if (!spReady || (!ready && !useTest)) {
    return null;
  }

  const mainClass = hostObs
    ? "donor-rankings-overlay-root pointer-events-none fixed inset-0 z-[120] w-full max-w-[100vw] overflow-visible bg-transparent p-2 sm:p-5 md:[background:var(--ov-donor-bg)]"
    : "donor-rankings-overlay-root relative min-h-screen w-full max-w-[100vw] overflow-visible bg-transparent p-2 sm:p-5 md:[background:var(--ov-donor-bg)]";
  const outlineCss = donorRankingsOutlineCssBlock(outlineColor, outlineWidthPx);

  return (
    <main
      className={mainClass}
      style={{ ["--ov-donor-bg" as string]: bg } as CSSProperties}
    >
      {outlineCss ? <style dangerouslySetInnerHTML={{ __html: outlineCss }} /> : null}
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
        {useTest && !hostObs ? (
          <div className="mb-2 inline-block rounded bg-amber-600/85 px-2 py-1 text-xs font-bold text-black">
            TEST MODE
          </div>
        ) : null}
        {bodyImageEl && bodyPos === "abovePanel" ? bodyImageEl : null}
        {layoutDual ? (
          <>
            {bodyImageEl && bodyPos === "belowTitle" ? bodyImageEl : null}
            <div
              className="relative"
              style={showFrame ? { padding: frameInsetPx } : undefined}
              data-donor-rankings-frame-wrap={showFrame ? "true" : undefined}
            >
              {showFrame ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={overlayCfg.frameUrl}
                  alt=""
                  className="pointer-events-none absolute inset-0 z-[2] h-full w-full object-fill"
                  style={{ opacity: frameOpacityFrac }}
                  loading="eager"
                  decoding="async"
                />
              ) : null}
              <div
                className={`relative z-[1] grid grid-cols-1 overflow-hidden backdrop-blur-md md:grid-cols-2 md:gap-0 ${
                  showFrame
                    ? "rounded-none border-0 shadow-none"
                    : "rounded-2xl border border-white/30 shadow-[0_8px_28px_rgba(15,23,42,0.2)]"
                }`}
                style={{
                  borderColor: showFrame
                    ? "transparent"
                    : borderColor === "transparent"
                      ? "rgba(255,255,255,0.3)"
                      : borderColor,
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
                outlineWidthPx={outlineWidthPx}
                headerOpacity={overlayOpacity}
                unified
                showColumnDivider
                panelOpacityFrac={overlayOpacityFrac}
                rowEvenBg={rowEvenBg}
                rowOddBg={rowOddBg}
                disableMotion={hostObs}
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
                outlineWidthPx={outlineWidthPx}
                headerOpacity={overlayOpacity}
                unified
                panelOpacityFrac={overlayOpacityFrac}
                rowEvenBg={rowEvenBg}
                rowOddBg={rowOddBg}
                disableMotion={hostObs}
              />
              </div>
            </div>
            {bodyImageEl && bodyPos === "belowList" ? bodyImageEl : null}
          </>
        ) : (
          <div
            className="relative mx-auto max-w-[720px]"
            style={showFrame ? { padding: frameInsetPx } : undefined}
            data-donor-rankings-frame-wrap={showFrame ? "true" : undefined}
          >
            {showFrame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={overlayCfg.frameUrl}
                alt=""
                className="pointer-events-none absolute inset-0 z-[2] h-full w-full object-fill"
                style={{ opacity: frameOpacityFrac }}
                loading="eager"
                decoding="async"
              />
            ) : null}
            <div
              className={`relative z-[1] overflow-hidden backdrop-blur-md ${
                showFrame
                  ? "rounded-none border-0 shadow-none"
                  : "rounded-2xl border border-white/30 shadow-[0_8px_28px_rgba(15,23,42,0.2)]"
              }`}
              style={{
                borderColor: showFrame
                  ? "transparent"
                  : borderColor === "transparent"
                    ? "rgba(255,255,255,0.3)"
                    : borderColor,
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
              outlineWidthPx={outlineWidthPx}
              headerOpacity={overlayOpacity}
              unified
              panelOpacityFrac={overlayOpacityFrac}
              rowEvenBg={rowEvenBg}
              rowOddBg={rowOddBg}
              disableMotion={hostObs}
              bodyImageBelowTitle={bodyPos === "belowTitle" ? bodyImageEl : null}
              bodyImageBelowList={bodyPos === "belowList" ? bodyImageEl : null}
            />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
