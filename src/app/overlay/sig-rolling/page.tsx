"use client";

import type { CSSProperties, SyntheticEvent } from "react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  filterSigInventoryForSalesDisplay,
  getUnifiedSigRollingItems,
  normalizeSigRolling,
  type AppState,
  type SigRollingItem,
} from "@/lib/state";
import {
  BUNDLED_SIG_PLACEHOLDER_URL,
  normalizeSigImageUrlStored,
  resolveSigRollingImageUrl,
  toSigOverlayAbsoluteAssetUrl,
} from "@/lib/constants";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import {
  getOverlayMemberFilterIdFromSearchParams,
  getOverlayUserIdFromSearchParams,
  inferSigUploadUserIdFromInventory,
} from "@/lib/overlay-params";
import { resolveSigRollingHoldMs } from "@/lib/sig-rolling-duration";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import {
  sigRollingFixedPairLayoutPx,
  sigRollingFixedShellOuterPx,
} from "@/lib/sig-rolling-orientation";
import {
  SIG_ROLLING_HIGH_PRICE_MIN,
  nextSigRollingIndex,
  pickSigRollingAt,
  splitSigRollingByPriceBand,
  type SigRollingItemWithPrice,
} from "@/lib/sig-rolling-price-bands";

/** 고정 가로 프레임(300×180) 안 object-contain — 셸 크기 불변 */
const IMG_IN_FRAME =
  "pointer-events-none select-none block h-full w-full max-h-full max-w-full min-h-0 min-w-0 object-contain object-center";

const SHELL_PAD_PX = 6;
const FIXED_SHELL = sigRollingFixedShellOuterPx(SHELL_PAD_PX);
const TWO_CARD_LAYOUT = sigRollingFixedPairLayoutPx(SHELL_PAD_PX, 2);
const ONE_CARD_LAYOUT = sigRollingFixedPairLayoutPx(SHELL_PAD_PX, 1);

function bandScheduleToken(items: SigRollingItemWithPrice[]): string {
  /** id 집합만 — URL/정렬 흔들림으로 인덱스가 0에 고정되지 않게 */
  return items
    .map((x) => x.id)
    .slice()
    .sort()
    .join("\u001f");
}

/** 목록 구성(id 집합)만 — 가격·URL·정렬 변동으로 타이머/인덱스가 리셋되지 않게 */
function sigRollingCatalogKey(state: AppState | null, memberFilterId: string, highMin: number): string {
  const items = getUnifiedSigRollingItems(state, memberFilterId);
  const { high, low } = splitSigRollingByPriceBand(items, highMin);
  return `${highMin}|H:${bandScheduleToken(high)}|L:${bandScheduleToken(low)}`;
}

function resolveItemSrc(item: SigRollingItem | null, overlayUserId?: string): string {
  if (!item) return "";
  return toSigOverlayAbsoluteAssetUrl(
    resolveSigRollingImageUrl(item.label || "", item.url, overlayUserId)
  );
}

/**
 * 고정 셸 + DOM 프리로드: OBS CEF에서 `new Image().onload`가 안 뜨면 교체가 멈추므로
 * 숨은 img onLoad + 타임아웃 강제 교체로 보장한다.
 */
function RollingCardColumn({
  current,
  pairSide,
  overlayUserId,
}: {
  current: SigRollingItem | null;
  pairSide?: "left" | "right";
  overlayUserId?: string;
}) {
  const targetId = current?.id || "";
  const targetSrc = resolveItemSrc(current, overlayUserId);
  const [shownSrc, setShownSrc] = useState(targetSrc);
  const shownSrcRef = useRef(shownSrc);
  shownSrcRef.current = shownSrc;
  const fallbackSrc = toSigOverlayAbsoluteAssetUrl(BUNDLED_SIG_PLACEHOLDER_URL);

  useEffect(() => {
    if (!targetSrc) return;
    if (targetSrc === shownSrcRef.current) return;

    let cancelled = false;
    let settled = false;

    const commit = (src: string) => {
      if (cancelled || settled) return;
      settled = true;
      setShownSrc(src);
    };

    /** OBS 브라우저 소스가 onLoad를 누락해도 교체되도록 */
    const forceId = window.setTimeout(() => commit(targetSrc), 900);

    return () => {
      cancelled = true;
      window.clearTimeout(forceId);
    };
  }, [targetId, targetSrc]);

  const onHiddenLoad = useCallback(() => {
    if (targetSrc) setShownSrc(targetSrc);
  }, [targetSrc]);

  const onHiddenError = useCallback(() => {
    setShownSrc(fallbackSrc);
  }, [fallbackSrc]);

  const onImgError = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      if (e.currentTarget.src.includes("dummy-sig")) return;
      setShownSrc(fallbackSrc);
    },
    [fallbackSrc]
  );

  if (!current && !shownSrc) return null;

  const displaySrc = shownSrc || targetSrc;
  if (!displaySrc) return null;

  const shellBase =
    "overflow-hidden shadow-lg border border-white/20 bg-white/35 [transform:translateZ(0)] [backface-visibility:hidden]";
  const shellClass =
    pairSide === "left"
      ? `${shellBase} rounded-l-3xl rounded-r-none p-1.5`
      : pairSide === "right"
        ? `${shellBase} rounded-r-3xl rounded-l-none p-1.5`
        : `${shellBase} rounded-3xl p-1.5`;

  const frameStyle: CSSProperties = {
    width: FIXED_SHELL.mediaWidth,
    height: FIXED_SHELL.mediaHeight,
    minWidth: FIXED_SHELL.mediaWidth,
    maxWidth: FIXED_SHELL.mediaWidth,
    minHeight: FIXED_SHELL.mediaHeight,
    maxHeight: FIXED_SHELL.mediaHeight,
  };

  const needsPreload = Boolean(targetSrc && targetSrc !== displaySrc);

  return (
    <div
      className="shrink-0"
      style={{ width: FIXED_SHELL.outerWidth, height: FIXED_SHELL.outerHeight }}
    >
      <div
        className={shellClass}
        style={{ width: FIXED_SHELL.outerWidth, height: FIXED_SHELL.outerHeight }}
      >
        <div
          className="relative grid place-items-center overflow-hidden rounded-2xl bg-transparent"
          style={frameStyle}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={displaySrc}
            alt=""
            className={IMG_IN_FRAME}
            referrerPolicy="no-referrer"
            style={{ opacity: 1 }}
            draggable={false}
            decoding="async"
            onError={onImgError}
          />
          {needsPreload ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={targetSrc}
              alt=""
              aria-hidden
              referrerPolicy="no-referrer"
              decoding="async"
              className="pointer-events-none absolute opacity-0"
              style={{ width: 1, height: 1, left: 0, top: 0 }}
              onLoad={onHiddenLoad}
              onError={onHiddenError}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

const overlayNoticeBoxStyle: CSSProperties = {
  color: "#f8fafc",
  backgroundColor: "rgba(15, 23, 42, 0.92)",
  border: "1px solid rgba(255,255,255,0.22)",
  boxShadow: "0 4px 14px rgba(0,0,0,0.35)",
};

function parseHighMinFromSearchParams(sp: URLSearchParams): number {
  const raw = sp.get("highMin") || sp.get("priceHighMin") || "";
  const n = Math.floor(Number(String(raw).replace(/[^\d]/g, "")));
  if (Number.isFinite(n) && n > 0) return n;
  return SIG_ROLLING_HIGH_PRICE_MIN;
}

function SigRollingOverlayInner() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const memberFilterId = getOverlayMemberFilterIdFromSearchParams(sp);
  const highMin = useMemo(() => parseHighMinFromSearchParams(sp), [sp]);
  const hostParam = (sp.get("host") || "").toLowerCase();
  const obsSafe =
    hostParam === "obs" ||
    hostParam === "external" ||
    (sp.get("obsSafe") || "").toLowerCase() === "true" ||
    (sp.get("obsSafe") || "").toLowerCase() === "1";
  const { state, ready } = useOverlayRemoteState(userId);
  const overlayUserId = useMemo(
    () => inferSigUploadUserIdFromInventory(state?.sigInventory, userId),
    [state?.sigInventory, userId]
  );

  const rolling = useMemo(() => normalizeSigRolling(state?.sigRolling), [state?.sigRolling]);
  const holdMs = resolveSigRollingHoldMs(rolling.staticHoldMs);
  const items = useMemo(() => getUnifiedSigRollingItems(state, memberFilterId), [state, memberFilterId]);
  const { high: highItems, low: lowItems } = useMemo(
    () => splitSigRollingByPriceBand(items, highMin),
    [items, highMin]
  );
  const totalCount = highItems.length + lowItems.length;
  const showPair = highItems.length > 0 && lowItems.length > 0;

  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(0);
  const [viewportW, setViewportW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 0));
  const leftIdxRef = useRef(0);
  const rightIdxRef = useRef(0);
  leftIdxRef.current = leftIdx;
  rightIdxRef.current = rightIdx;

  /** 마지막 유효 목록 — 폴링 중 빈 스냅샷이 나와도 OBS가 투명으로 깜빡이지 않게 */
  const lastItemsRef = useRef({ high: highItems, low: lowItems, total: totalCount });
  if (totalCount > 0) {
    lastItemsRef.current = { high: highItems, low: lowItems, total: totalCount };
  }
  const stableHigh = totalCount > 0 ? highItems : lastItemsRef.current.high;
  const stableLow = totalCount > 0 ? lowItems : lastItemsRef.current.low;
  const stableTotal = stableHigh.length + stableLow.length;
  const stableShowPair = stableHigh.length > 0 && stableLow.length > 0;

  const leftCurrent = pickSigRollingAt(stableHigh, leftIdx);
  const rightCurrent = pickSigRollingAt(stableLow, rightIdx);

  const catalogKey = sigRollingCatalogKey(state, memberFilterId, highMin);

  const pairLayout = stableShowPair ? TWO_CARD_LAYOUT : ONE_CARD_LAYOUT;

  const bandsRef = useRef({ high: stableHigh, low: stableLow, staticHoldMs: holdMs });
  bandsRef.current = { high: stableHigh, low: stableLow, staticHoldMs: holdMs };

  const canAdvance = stableHigh.length >= 2 || stableLow.length >= 2;

  const preloadRollingImage = useCallback(
    (item: SigRollingItem | null | undefined) => {
      if (!item?.url || typeof window === "undefined") return;
      const src = resolveItemSrc(item, overlayUserId);
      if (!src) return;
      const img = new window.Image();
      img.decoding = "async";
      img.src = src;
    },
    [overlayUserId]
  );

  const advanceBands = useCallback(() => {
    const { high, low } = bandsRef.current;
    if (high.length >= 2) setLeftIdx((i) => nextSigRollingIndex(i, high.length));
    if (low.length >= 2) setRightIdx((i) => nextSigRollingIndex(i, low.length));
  }, []);

  const twoCardScale = useMemo(() => {
    if (!Number.isFinite(viewportW) || viewportW <= 0) return 1;
    const safeW = Math.max(260, viewportW - 8);
    const baseW = Math.max(pairLayout.totalOuterWidth, stableShowPair ? TWO_CARD_LAYOUT.totalOuterWidth : pairLayout.totalOuterWidth);
    const ratio = safeW / baseW;
    if (!Number.isFinite(ratio)) return 1;
    return Math.max(0.6, Math.min(1, ratio));
  }, [viewportW, pairLayout.totalOuterWidth, stableShowPair]);

  useEffect(() => {
    const update = () => setViewportW(window.innerWidth || 0);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    setLeftIdx(0);
    setRightIdx(0);
  }, [catalogKey]);

  /** 인덱스가 목록 길이를 넘지 않게 보정 */
  useEffect(() => {
    if (stableHigh.length > 0 && leftIdx >= stableHigh.length) setLeftIdx(0);
    if (stableLow.length > 0 && rightIdx >= stableLow.length) setRightIdx(0);
  }, [stableHigh.length, stableLow.length, leftIdx, rightIdx]);

  /** leftIdx에 묶지 않는 interval — 인덱스 리셋/재구독으로 교체가 멈추지 않게 */
  useEffect(() => {
    if (!ready || stableTotal === 0 || !canAdvance) return;

    const waitMs = resolveSigRollingHoldMs(holdMs);

    const tick = () => {
      const snap = bandsRef.current;
      const li = leftIdxRef.current;
      const ri = rightIdxRef.current;
      preloadRollingImage(snap.high.length > 1 ? pickSigRollingAt(snap.high, li + 1) : null);
      preloadRollingImage(snap.low.length > 1 ? pickSigRollingAt(snap.low, ri + 1) : null);
      advanceBands();
    };

    preloadRollingImage(
      stableHigh.length > 1 ? pickSigRollingAt(bandsRef.current.high, leftIdxRef.current + 1) : null
    );
    preloadRollingImage(
      stableLow.length > 1 ? pickSigRollingAt(bandsRef.current.low, rightIdxRef.current + 1) : null
    );

    const timerId = window.setInterval(tick, waitMs);
    return () => window.clearInterval(timerId);
  }, [
    ready,
    stableTotal,
    catalogKey,
    holdMs,
    canAdvance,
    stableHigh.length,
    stableLow.length,
    preloadRollingImage,
    advanceBands,
  ]);

  const emptyDetail = useMemo(() => {
    if (!state) return "";
    const inv = state.sigInventory || [];
    const rows = inv.filter((x) => x.id !== ONE_SHOT_SIG_ID);
    const salesRows = filterSigInventoryForSalesDisplay(state, memberFilterId);
    const rollingWithUrl = salesRows.filter((x) => Boolean(normalizeSigImageUrlStored(x.imageUrl).trim()));
    const anyImage = rows.some((x) => Boolean(normalizeSigImageUrlStored(x.imageUrl).trim()));
    const anyActiveInPool = salesRows.length > 0;
    if (anyImage && anyActiveInPool && rollingWithUrl.length === 0) {
      return "판매 활성 시그는 있으나 이미지 URL이 비어 있어 표시할 수 없습니다. 시그 판매 관리에서 이미지를 등록해 주세요.";
    }
    if (anyImage && !anyActiveInPool) {
      return "시그 인벤에 이미지는 있으나 「판매 활성」이 꺼져 있거나 판매 제외·멤버 필터 때문에 목록이 비었습니다. 시그 판매 관리 기준으로 활성·멤버를 맞춰 주세요.";
    }
    return "";
  }, [state, memberFilterId]);

  if (!ready && stableTotal === 0) {
    if (obsSafe) return <main className="overlay-root inline-block w-fit bg-transparent p-1" />;
    return (
      <main className="overlay-root inline-block w-fit p-1">
        <div
          className="max-w-[min(92vw,26rem)] rounded-lg border border-white/25 bg-black/80 px-3 py-2 text-[11px] leading-snug text-white shadow-md"
          style={overlayNoticeBoxStyle}
        >
          시그 롤링 · 상태 불러오는 중…
        </div>
      </main>
    );
  }

  if (stableTotal === 0) {
    if (obsSafe) return <main className="overlay-root inline-block w-fit bg-transparent p-1" />;
    return (
      <main className="overlay-root inline-block w-fit p-1">
        <div
          className="max-w-[min(92vw,28rem)] space-y-2 rounded-lg border border-white/25 bg-black/80 px-3 py-2.5 text-[11px] leading-snug text-white shadow-md"
          style={overlayNoticeBoxStyle}
        >
          <p className="font-semibold text-amber-100" style={{ color: "#fde68a" }}>
            시그 롤링 · 표시할 이미지가 없습니다
          </p>
          {emptyDetail ? <p className="text-white/95" style={{ color: "rgba(248,250,252,0.96)" }}>{emptyDetail}</p> : null}
          <p className="text-white/85" style={{ color: "rgba(248,250,252,0.88)" }}>
            <code className="rounded bg-white/15 px-1">/overlay/sig-rolling</code> 는{" "}
            <strong className="text-white">후원 랭킹 오버레이와 별도의 브라우저 소스</strong>로 추가해야 합니다. URL에{" "}
            <code className="rounded bg-white/15 px-1">?u=본인아이디</code>(예: finalent)가 맞는지 확인하세요. 좌측은{" "}
            {highMin.toLocaleString("ko-KR")}원 이상(고액), 우측은 미만(저액)으로 나뉘어 롤링됩니다.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main
      className="overlay-root inline-block bg-transparent text-pastel-ink"
      style={{
        width: Math.ceil(pairLayout.totalOuterWidth * twoCardScale) + 8,
        height: Math.ceil(pairLayout.maxOuterHeight * twoCardScale) + 8,
        overflow: "hidden",
        padding: 4,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: pairLayout.totalOuterWidth,
          height: pairLayout.maxOuterHeight,
          transform: `scale(${twoCardScale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="flex flex-row flex-nowrap items-stretch gap-0 [isolation:isolate]">
          {leftCurrent || stableHigh.length > 0 ? (
            <RollingCardColumn
              current={leftCurrent}
              pairSide={stableShowPair ? "left" : undefined}
              overlayUserId={overlayUserId}
            />
          ) : null}
          {rightCurrent || (stableShowPair && stableLow.length > 0) ? (
            <RollingCardColumn
              current={rightCurrent}
              pairSide={stableShowPair ? "right" : undefined}
              overlayUserId={overlayUserId}
            />
          ) : null}
        </div>
      </div>
    </main>
  );
}

function SigRollingSuspenseFallback() {
  return (
    <main className="overlay-root inline-block w-fit p-1">
      <div
        className="rounded-lg px-3 py-2 text-[11px] leading-snug"
        style={overlayNoticeBoxStyle}
      >
        시그 롤링 · 준비 중…
      </div>
    </main>
  );
}

export default function SigRollingOverlayPage() {
  return (
    <Suspense fallback={<SigRollingSuspenseFallback />}>
      <SigRollingOverlayInner />
    </Suspense>
  );
}
