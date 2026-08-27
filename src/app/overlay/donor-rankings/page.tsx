"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import {
  defaultState,
  formatDonorsAmount,
  normalizeDonorRankingsOverlayConfig,
  normalizeDonorsFormat,
  DONOR_RANKINGS_COMPACT_TOP_MAX,
  DONOR_RANKINGS_OUTLINE_MAX_PX,
  type AppState,
} from "@/lib/state";
import type { DonorsAmountFormat } from "@/types";
import { resolveAnimatedSourceForEmbed } from "@/lib/gif-url";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import { useDonorRankingsRemoteState } from "@/hooks/useDonorRankingsRemoteState";
import { useAdminPreviewDonorsOverride } from "@/hooks/useAdminPreviewDonorsOverride";
import {
  buildDonorRankingsFromDonors,
  sliceDonorRankingTop,
  type DonorRankingRow,
} from "@/lib/donor-rankings-aggregate";
import { normalizeAnonymousDonorDisplayName } from "@/lib/donation/anonymous-donor-name";
import {
  buildBroadcastTextOutlineShadowCss,
  buildOverlayCellOutlineStyle,
  DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR,
} from "@/lib/text-outline-style";
import {
  broadcastZoomCenterMarginLeftPct,
  resolveBroadcastContainZoomScale,
  resolveBroadcastZoomScale,
} from "@/lib/overlay-mobile-fit";
import { useOverlayViewportSize } from "@/hooks/useOverlayViewportSize";
import { backgroundWithOpacityFrac, solidBackgroundWithOpacityFrac } from "@/lib/donor-rankings-opacity";
import { splitOverlayListAtHalf } from "@/lib/utils";

/** 4등+ 순위 숫자 기본: 흰색 + 검정 외곽선 (관리자 rankColor가 있으면 우선) */
const RANK_NUMBER_FALLBACK = "#ffffff";
function readOutlineWidth(sp: URLSearchParams, key: string, fallback: number): number {
  const raw = sp.get(key);
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(DONOR_RANKINGS_OUTLINE_MAX_PX, n));
}

function liveThemeOutlineWidth(
  ready: boolean,
  useTest: boolean,
  saved: number,
  sp: URLSearchParams
): number {
  const n = ready && !useTest
    ? Math.max(0, Math.min(DONOR_RANKINGS_OUTLINE_MAX_PX, saved))
    : readOutlineWidth(sp, "outlineWidth", saved);
  /** 후원순위는 시인성 때문에 외곽선이 기본. 0은 관리자 ‘없음’이 아니라 기본 두께로 표시 */
  if (n <= 0) return 4;
  return n;
}

function donorRankingsOutlineCssBlock(
  outlineColor: string,
  outlineWidthPx?: number,
  sharp = true
): string {
  if (outlineWidthPx === 0) return "";
  const resolved = outlineColor.trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR;
  const w =
    outlineWidthPx != null && Number.isFinite(outlineWidthPx) && outlineWidthPx > 0
      ? Math.max(0.5, Math.min(DONOR_RANKINGS_OUTLINE_MAX_PX, outlineWidthPx))
      : 4;
  const shadow = buildBroadcastTextOutlineShadowCss({
    outlineColor: resolved,
    outlineWidthPx: w,
    sharp,
  });
  if (!shadow) return "";
  return `
    .donor-rankings-overlay-root .overlay-cell-text-inner,
    .donor-rankings-overlay-root .donor-rank-slot span:not(.overlay-rank-icon) {
      display: inline-block;
      overflow: visible;
      white-space: inherit;
      vertical-align: middle;
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
      paint-order: stroke fill !important;
      -webkit-text-stroke: ${w}px ${resolved} !important;
      text-shadow: ${shadow} !important;
    }
    /* 트로피·숫자 순위가 같은 칸 중심에 오도록 */
    .donor-rankings-overlay-root .donor-rank-slot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      line-height: 1;
      text-align: center;
    }
    .donor-rankings-overlay-root .donor-rank-slot .overlay-rank-icon,
    .donor-rankings-overlay-root .overlay-rank-icon,
    .donor-rankings-overlay-root .overlay-rank-icon .overlay-cell-text-inner {
      margin-left: 0 !important;
      margin-right: 0 !important;
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
      paint-order: normal !important;
    }
  `;
}

/** 웹후원 스타일 1~3위 트로피 (금/은/동 + 별) */
function RankTrophyIcon({ place, sizePx }: { place: 1 | 2 | 3; sizePx: number }) {
  const size = Math.max(16, Math.round(sizePx));
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
      className="overlay-rank-icon block shrink-0"
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

const TEST_FULL_EXTRA_ROWS: DonorRow[] = [
  { name: "샘플후원H", amount: 280000 },
  { name: "샘플후원I", amount: 210000 },
  { name: "샘플후원J", amount: 165000 },
  { name: "샘플후원K", amount: 128000 },
  { name: "샘플후원L", amount: 99000 },
  { name: "샘플후원M", amount: 72000 },
  { name: "샘플후원N", amount: 51000 },
  { name: "샘플후원O", amount: 33000 },
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
 * 헤더(`headerBg`)·목록(`panelBg`)·행(짝/홀수) 배경에 동일하게 `overlayOpacity`를 곱한다.
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
  rowOpacityFrac = 1,
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
  /** 헤더·패널과 동일 슬라이더 (0~1) */
  rowOpacityFrac?: number;
  amountFormat: DonorsAmountFormat;
  suffix?: string;
  disableMotion?: boolean;
}) {
  const resolvedOutlineColor = outlineColor.trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR;
  const rankPx = Math.round(rankSize * 1.1);
  const rowPx = Math.round(rowSize * 1.1);
  const rankOutlineRaw = buildOverlayCellOutlineStyle({
    fontSizePx: rankPx,
    outlineColor: resolvedOutlineColor,
    outlineWidthPx,
    sharp: true,
  });
  const rowOutlineRaw = buildOverlayCellOutlineStyle({
    fontSizePx: rowPx,
    outlineColor: resolvedOutlineColor,
    outlineWidthPx,
    sharp: true,
  });
  // OBS CEF: stroke + 조밀 shadow 링을 함께 씀 (참고샷의 두꺼운 검정 외곽선)
  const rankOutline = rankOutlineRaw;
  const rowOutline = rowOutlineRaw;
  const isTrophy = idx <= 2;
  const effectiveRankColor = String(rankColor || "").trim() || RANK_NUMBER_FALLBACK;
  const rankSlotPx = Math.max(rankPx, Math.round(rankPx * 1.35));
  const rowBgRaw = idx % 2 === 0 ? rowEvenBg || "transparent" : rowOddBg || "transparent";
  const rowStyle: CSSProperties = {
    fontSize: `${rowPx}px`,
    minHeight: 40,
    padding: "6px 12px",
    background: solidBackgroundWithOpacityFrac(rowBgRaw, rowOpacityFrac),
  };
  const nameDisplay = normalizeAnonymousDonorDisplayName(item.name);
  /**
   * 스크린샷(후원 랭킹) 레이아웃:
   * [순위] [닉네임 …ellipsis…] ………… [금액 tabular]
   * — 닉네임은 좌측, 금액만 우측 (둘 다 우측 정렬 X)
   * — 1~3등 트로피와 4등+ 숫자는 동일 너비 칸의 정중앙
   */
  const inner = (
    <>
      <span
        className="donor-rank-slot"
        style={{ width: rankSlotPx, minWidth: rankSlotPx, height: rankSlotPx }}
      >
        {isTrophy ? (
          <RankTrophyIcon place={(idx + 1) as 1 | 2 | 3} sizePx={rankPx} />
        ) : (
          <span
            className="overlay-cell-text-inner text-center font-bold leading-none tabular-nums"
            style={{
              color: effectiveRankColor,
              fontSize: `${rankPx}px`,
              fontWeight: 700,
              fontVariantNumeric: "tabular-nums",
              ...rankOutline,
            }}
          >
            {`${idx + 1}`}
          </span>
        )}
      </span>
      <span
        className="overlay-cell-text-inner min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-[0.2em] py-[0.12em] text-left font-bold leading-snug"
        style={{
          color: nameColor,
          ...rowOutline,
        }}
        title={nameDisplay}
      >
        {nameDisplay}
      </span>
      <span
        className="overlay-cell-text-inner shrink-0 pl-3 text-right font-bold whitespace-nowrap tabular-nums"
        style={{
          color: amountColor,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          ...rowOutline,
        }}
      >
        {amountFormat === "short"
          ? `${formatDonorsAmount(item.amount, "short")}만`
          : `${formatDonorsAmount(item.amount, "full")}${suffix ? ` ${suffix}` : " 원"}`}
      </span>
    </>
  );
  const rowClass =
    "flex items-center gap-x-2 border-b border-white/[0.08] last:border-b-0";
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
  hideTitle,
  rankOffset = 0,
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
  /** unified: 헤더·목록·짝/홀수 행 배경에 동일 투명도 */
  panelOpacityFrac?: number;
  rowEvenBg?: string;
  rowOddBg?: string;
  /** OBS CEF: framer-motion initial opacity 0 이 고착되면 전체가 안 보임 */
  disableMotion?: boolean;
  bodyImageBelowTitle?: ReactNode;
  bodyImageBelowList?: ReactNode;
  hideTitle?: boolean;
  rankOffset?: number;
}) {
  const titleOutlineRaw = buildOverlayCellOutlineStyle({
    fontSizePx: titleSize,
    outlineColor: outlineColor.trim() || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR,
    outlineWidthPx,
    sharp: true,
  });
  const titleOutline = titleOutlineRaw;
  const outerClass = unified
    ? `relative z-[1] flex min-w-0 flex-1 flex-col overflow-visible ${
        showColumnDivider
          ? "border-b border-solid border-r-0 md:border-b-0 md:border-r md:border-solid border-white/20"
          : ""
      }`
    : "studio-glass-panel relative z-[1] w-full overflow-visible";
  const panelFrac = Math.max(0, Math.min(1, panelOpacityFrac ?? 1));
  const panelBgResolved = backgroundWithOpacityFrac(panelBg, panelFrac);
  const outerStyle: CSSProperties | undefined = { borderColor };

  const headerOpacityFrac = unified
    ? panelFrac
    : Math.max(0, Math.min(100, headerOpacity)) / 100;
  const headerBgResolved = backgroundWithOpacityFrac(headerBg, headerOpacityFrac);

  const rowList = (
    <div className="flex flex-col">
      {disableMotion ? (
        items.map((item, idx) => (
          <RankingRow
            key={item.name}
            item={item}
            idx={idx + rankOffset}
            rowSize={rowSize}
            rankSize={rankSize}
            rankColor={rankColor}
            nameColor={nameColor}
            amountColor={amountColor}
            outlineColor={outlineColor}
            outlineWidthPx={outlineWidthPx}
            rowEvenBg={rowEvenBg}
            rowOddBg={rowOddBg}
            rowOpacityFrac={Math.max(0, Math.min(1, panelOpacityFrac ?? 1))}
            amountFormat={amountFormat}
            suffix={suffix}
            disableMotion
          />
        ))
      ) : (
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <RankingRow
              key={item.name}
              item={item}
              idx={idx + rankOffset}
              rowSize={rowSize}
              rankSize={rankSize}
              rankColor={rankColor}
              nameColor={nameColor}
              amountColor={amountColor}
              outlineColor={outlineColor}
              outlineWidthPx={outlineWidthPx}
              rowEvenBg={rowEvenBg}
              rowOddBg={rowOddBg}
              rowOpacityFrac={Math.max(0, Math.min(1, panelOpacityFrac ?? 1))}
              amountFormat={amountFormat}
              suffix={suffix}
            />
          ))}
        </AnimatePresence>
      )}
    </div>
  );

  return (
    <section className={outerClass} style={outerStyle}>
      {!unified ? (
        <div
          className="pointer-events-none absolute inset-0 z-0 rounded-studio"
          aria-hidden
          style={{
            background: panelBgResolved.background,
            ...(panelBgResolved.opacity !== undefined ? { opacity: panelBgResolved.opacity } : {}),
          }}
        />
      ) : null}
      {hideTitle ? null : unified ? (
      <div className="relative flex justify-center px-4 py-2">
        <span className="relative inline-flex max-w-full items-center justify-center">
          <span
            className="pointer-events-none absolute inset-0 rounded-full"
            aria-hidden
            style={{
              background: headerBgResolved.background,
              ...(headerBgResolved.opacity !== undefined ? { opacity: headerBgResolved.opacity } : {}),
            }}
          />
          <span
            className="overlay-cell-text-inner relative z-10 px-5 py-1.5 text-center font-bold tracking-tight"
            style={{
              color: titleColor,
              fontSize: `${Math.round(titleSize * 1.1)}px`,
              fontWeight: 700,
              ...titleOutline,
            }}
          >
            {title}
          </span>
        </span>
      </div>
      ) : (
      <div
        className="relative overflow-hidden border-b border-white/20 px-4 py-2.5 text-center font-bold tracking-tight"
        style={{
          color: titleColor,
          fontSize: `${Math.round(titleSize * 1.1)}px`,
          fontWeight: 700,
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
      )}
      {bodyImageBelowTitle}
      {items.length === 0 ? null : unified ? (
        <div className="relative min-h-0 flex-1">
          <div className="relative z-[1] px-2 py-1.5">{rowList}</div>
        </div>
      ) : (
        <div className="relative z-[1] p-2">{rowList}</div>
      )}
      {bodyImageBelowList}
    </section>
  );
}

export default function DonorRankingsOverlayPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const pathname = usePathname();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const hostObs = isOverlayBroadcastHost(sp);
  const { state, ready, resync } = useDonorRankingsRemoteState(userId);
  const isFullVertical =
    (pathname || "").includes("/donor-rankings/full") ||
    (sp.get("mode") || "").toLowerCase() === "full";

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
  const isAdminPreview =
    sp.get("adminPreviewEmbed") === "1" || sp.get("hubPreview") === "1";
  /** 관리자 미리보기는 API 완료 전에도 저장·기본 테마를 즉시 적용 */
  const themeLive = ready || isAdminPreview;
  const layoutDual = !isFullVertical && (sp.get("layout") || "").toLowerCase() === "dual";
  const savedTheme = state?.donorRankingsTheme || defaultState().donorRankingsTheme;

  const topN = isFullVertical
    ? 0
    : liveThemeNumber(
        themeLive,
        useTest,
        savedTheme.top,
        sp,
        "top",
        1,
        DONOR_RANKINGS_COMPACT_TOP_MAX
      );
  const titleSize = liveThemeNumber(themeLive, useTest, savedTheme.titleSize, sp, "titleSize", 14, 80);
  const rowSize = liveThemeNumber(themeLive, useTest, savedTheme.rowSize, sp, "rowSize", 12, 64);
  const rankSize = liveThemeNumber(themeLive, useTest, savedTheme.rankSize, sp, "rankSize", 12, 72);
  const overlayOpacity = liveThemeNumber(themeLive, useTest, savedTheme.overlayOpacity, sp, "overlayOpacity", 0, 100);
  const zoomPct = liveThemeNumber(
    themeLive,
    useTest,
    Number(savedTheme.zoomPct) || 100,
    sp,
    "zoomPct",
    30,
    300
  );
  const viewportSize = useOverlayViewportSize();
  /** 전체(세로)는 단일 컬럼 max-w 720 — 1500 기준이면 좁은 미리보기에서 가로 스크롤이 생김 */
  const zoomDesignWidth = isFullVertical ? 720 : 1500;
  const zoomContentRef = useRef<HTMLDivElement>(null);
  const [fullContentHeight, setFullContentHeight] = useState(0);
  const zoomPad = hostObs ? 16 : 40;
  const zoomScale = useMemo(() => {
    if (isFullVertical) {
      return resolveBroadcastContainZoomScale(
        zoomPct,
        viewportSize.w,
        viewportSize.h,
        zoomDesignWidth,
        fullContentHeight,
        zoomPad
      );
    }
    return resolveBroadcastZoomScale(zoomPct, viewportSize.w, zoomDesignWidth);
  }, [
    isFullVertical,
    zoomPct,
    viewportSize.w,
    viewportSize.h,
    zoomDesignWidth,
    fullContentHeight,
    zoomPad,
  ]);
  const zoomMarginLeftPct = useMemo(
    () => broadcastZoomCenterMarginLeftPct(zoomScale),
    [zoomScale]
  );
  const bg =
    themeLive && !useTest
      ? (savedTheme.bg || "").trim() || "transparent"
      : readColor(sp, "bg", savedTheme.bg) || "transparent";
  /** Studio glass 기본 패널 */
  const panelBg = resolveThemeColorLive(themeLive, useTest, sp, "panelBg", savedTheme.panelBg, "rgba(15, 20, 30, 0.70)");
  const borderColor = resolveThemeColorLive(
    themeLive,
    useTest,
    sp,
    "border",
    savedTheme.borderColor,
    "#000000"
  );
  const headerAccountBg = liveThemeColor(
    themeLive,
    useTest,
    savedTheme.headerAccountBg,
    sp,
    "headerAccountBg",
    "rgba(37, 99, 235, 0.55)"
  );
  const headerToonBg = liveThemeColor(
    themeLive,
    useTest,
    savedTheme.headerToonBg,
    sp,
    "headerToonBg",
    "rgba(124, 58, 237, 0.55)"
  );
  const headerUnifiedBg = readColor(sp, "headerBg", headerAccountBg) || headerAccountBg;
  const rankingTitle = liveThemeTitle(themeLive, useTest, savedTheme.titleText, sp, "👑 웹후원 순위 👑");
  const rowEvenBg = liveThemeColor(themeLive, useTest, savedTheme.rowEvenBg, sp, "rowEvenBg", "transparent");
  const rowOddBg = liveThemeColor(themeLive, useTest, savedTheme.rowOddBg, sp, "rowOddBg", "rgba(255, 255, 255, 0.14)");
  const rankColor = liveThemeColor(themeLive, useTest, savedTheme.rankColor, sp, "rankColor", "#ffffff");
  const nameColor = liveThemeColor(themeLive, useTest, savedTheme.nameColor, sp, "nameColor", "#ffc107");
  const amountColor = liveThemeColor(themeLive, useTest, savedTheme.amountColor, sp, "amountColor", "#ffc107");
  const titleColor = liveThemeColor(themeLive, useTest, savedTheme.titleColor, sp, "titleColor", "#ffc107");
  const outlineColor = liveThemeColor(
    themeLive,
    useTest,
    savedTheme.outlineColor,
    sp,
    "outline",
    "#000000"
  );
  const outlineWidthPx = liveThemeOutlineWidth(themeLive, useTest, savedTheme.outlineWidth, sp);
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
  const adminPreviewDonors = useAdminPreviewDonorsOverride(isAdminPreview, userId);
  const effectiveDonorsOverride = adminPreviewDonors ?? donorsOverride;
  const wireRankings = state?.donorRankingsWire;

  const { accountTop, toonTop, unifiedTop } = useMemo(() => {
    if (useTest) {
      const extra = isFullVertical
        ? TEST_FULL_EXTRA_ROWS.map((row) => ({
            name: row.name,
            amount: row.amount,
            target: "account" as const,
          }))
        : [];
      return buildDonorRankingsFromDonors(
        [
          ...TEST_ACCOUNT_ROWS.map((row) => ({ name: row.name, amount: row.amount, target: "account" })),
          ...TEST_TOON_ROWS.map((row) => ({ name: row.name, amount: row.amount, target: "toon" })),
          ...extra,
        ],
        topN
      );
    }
    if (isAdminPreview && adminPreviewDonors !== undefined) {
      return buildDonorRankingsFromDonors(adminPreviewDonors, topN);
    }
    if (effectiveDonorsOverride !== undefined) {
      return buildDonorRankingsFromDonors(effectiveDonorsOverride, topN);
    }
    /** 서버: cap 300 행 donors 대신 전체 집계 wire 사용 — 누적 합계와 일치 */
    if (wireRankings) {
      const slice = (rows: DonorRankingRow[]) => sliceDonorRankingTop(rows, topN);
      return {
        unifiedTop: slice(wireRankings.unifiedTop),
        accountTop: slice(wireRankings.accountTop),
        toonTop: slice(wireRankings.toonTop),
      };
    }
    return buildDonorRankingsFromDonors((state?.donors || []) as Array<Record<string, unknown>>, topN);
  }, [
    state?.donors,
    useTest,
    effectiveDonorsOverride,
    adminPreviewDonors,
    isAdminPreview,
    wireRankings,
    topN,
    isFullVertical,
  ]);
  const unifiedHalf = useMemo(
    () =>
      isFullVertical
        ? { left: unifiedTop, right: [] as DonorRankingRow[], split: false }
        : splitOverlayListAtHalf(unifiedTop),
    [unifiedTop, isFullVertical]
  );

  useLayoutEffect(() => {
    if (!isFullVertical) {
      setFullContentHeight(0);
      return;
    }
    const el = zoomContentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const h = Math.max(el.scrollHeight, el.offsetHeight);
      setFullContentHeight((prev) => (prev === h ? prev : h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [
    isFullVertical,
    unifiedTop.length,
    titleSize,
    rowSize,
    rankSize,
    showBodyImage,
    showFrame,
    frameInsetPx,
    ready,
    spReady,
    useTest,
    isAdminPreview,
  ]);

  if (!spReady) {
    return null;
  }

  /**
   * 관리자 미리보기: API ready 대기 중에도 기본/로컬 테마로 그리기.
   * (iframe remount·느린 GET 때문에 「불러오는 중」에 고착되지 않게)
   */
  if (!ready && !useTest && !isAdminPreview) {
    return null;
  }

  const mainClass = hostObs
    ? `donor-rankings-overlay-root pointer-events-none fixed inset-0 z-[120] w-full max-w-[100vw] overflow-x-hidden ${
        isFullVertical ? "overflow-y-hidden" : "overflow-y-visible"
      } bg-transparent p-2 sm:p-5 md:[background:var(--ov-donor-bg)]`
    : `donor-rankings-overlay-root relative ${
        isFullVertical ? "h-[100dvh] max-h-[100dvh] overflow-y-hidden" : "min-h-screen overflow-y-visible"
      } w-full max-w-[100vw] overflow-x-hidden bg-transparent p-2 sm:p-5 md:[background:var(--ov-donor-bg)]`;
  const outlineCss = donorRankingsOutlineCssBlock(outlineColor, outlineWidthPx, true);

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
        className={
          isFullVertical
            ? "relative z-10 mx-auto w-full max-w-full overflow-hidden"
            : "contents"
        }
        style={
          isFullVertical && fullContentHeight > 0
            ? { height: Math.ceil(fullContentHeight * zoomScale) }
            : undefined
        }
      >
      <div
        ref={zoomContentRef}
        className={`relative z-10 mx-auto ${isFullVertical ? "max-w-[720px]" : "max-w-[1500px]"}`}
        style={{
          transform: `scale(${zoomScale})`,
          transformOrigin: "top center",
          width: `${100 / zoomScale}%`,
          marginLeft: `${zoomMarginLeftPct}%`,
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
                  className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
                  style={{ opacity: frameOpacityFrac }}
                  loading="eager"
                  decoding="async"
                />
              ) : null}
              <div
                className={`relative z-[2] grid grid-cols-1 overflow-hidden backdrop-blur-studio md:grid-cols-2 md:gap-0 ${
                  showFrame
                    ? "rounded-none border-0 shadow-none"
                    : "studio-glass-panel rounded-studio border border-solid"
                }`}
                style={{
                  borderColor: showFrame ? "transparent" : borderColor,
                  backgroundColor: "transparent",
                  boxShadow: showFrame ? "none" : "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
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
            className={`relative mx-auto ${unifiedHalf.split ? "max-w-[1500px]" : "max-w-[720px]"}`}
            style={showFrame ? { padding: frameInsetPx } : undefined}
            data-donor-rankings-frame-wrap={showFrame ? "true" : undefined}
          >
            {showFrame ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={overlayCfg.frameUrl}
                alt=""
                className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
                style={{ opacity: frameOpacityFrac }}
                loading="eager"
                decoding="async"
              />
            ) : null}
            <div
              className={`relative z-[2] overflow-visible ${
                showFrame
                  ? "rounded-none border-0 shadow-none"
                  : "rounded-studio border border-solid"
              }`}
              style={{
                borderColor: showFrame ? "transparent" : borderColor,
                backgroundColor: "transparent",
                boxShadow: "none",
              }}
            >
            {unifiedHalf.split ? (
              <>
                <RankingColumn
                  title={rankingTitle}
                  items={[]}
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
                />
                <div className="grid grid-cols-2">
                  <RankingColumn
                    title=""
                    items={unifiedHalf.left}
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
                    hideTitle
                    showColumnDivider
                    panelOpacityFrac={overlayOpacityFrac}
                    rowEvenBg={rowEvenBg}
                    rowOddBg={rowOddBg}
                    disableMotion={hostObs}
                  />
                  <RankingColumn
                    title=""
                    items={unifiedHalf.right}
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
                    hideTitle
                    rankOffset={unifiedHalf.left.length}
                    panelOpacityFrac={overlayOpacityFrac}
                    rowEvenBg={rowEvenBg}
                    rowOddBg={rowOddBg}
                    disableMotion={hostObs}
                    bodyImageBelowList={bodyPos === "belowList" ? bodyImageEl : null}
                  />
                </div>
              </>
            ) : (
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
            )}
            </div>
          </div>
        )}
      </div>
      </div>
    </main>
  );
}
