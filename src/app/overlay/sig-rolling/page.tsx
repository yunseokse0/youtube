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
import { getSigRollingHoldMs } from "@/lib/sig-rolling-duration";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import {
  classifySigRollingOrientation,
  sigRollingPairLayoutPx,
  sigRollingShellOuterPx,
  type SigRollingMediaOrientation,
} from "@/lib/sig-rolling-orientation";
import {
  SIG_ROLLING_HIGH_PRICE_MIN,
  nextSigRollingIndex,
  pickSigRollingAt,
  splitSigRollingByPriceBand,
  type SigRollingItemWithPrice,
} from "@/lib/sig-rolling-price-bands";

/** 300×180(가로) / 180×300(세로) 프레임 — object-contain, 잘림 없음 */
const IMG_IN_FRAME =
  "pointer-events-none select-none block h-full w-full max-h-full max-w-full min-h-0 min-w-0 object-contain object-center";

/** 부드러운 디졸브용 커브 — 중간 구간에서 두 장이 겹쳐 보이도록 */
const SIG_ROLLING_EASE = "cubic-bezier(0.4, 0.0, 0.2, 1)";

const SHELL_PAD_PX = 6;
/** 뷰포트 스케일 기본값 — 실제는 카드별 방향에 따라 동적 계산 */
const TWO_CARD_BASE_WIDTH_PX =
  sigRollingPairLayoutPx("landscape", "landscape", SHELL_PAD_PX).totalOuterWidth;
const DEFAULT_PAIR_HEIGHT_PX =
  sigRollingPairLayoutPx("landscape", "landscape", SHELL_PAD_PX).maxOuterHeight;

/** idle=표시 / cross=기존↔다음 동시 블렌딩(디졸브) */
type SigRollingFadePhase = "idle" | "cross";

function bandScheduleToken(items: SigRollingItemWithPrice[]): string {
  return items.map((x) => `${x.id}\u001f${x.url}\u001f${x.price}`).join("\u001e");
}

/** 폴링으로 `state` 객체만 바뀌고 내용은 같을 때도 참조가 매번 바뀌지 않도록 문자열 키로 구분 */
function sigRollingScheduleKey(state: AppState | null, memberFilterId: string, highMin: number): string {
  const r = normalizeSigRolling(state?.sigRolling);
  const items = getUnifiedSigRollingItems(state, memberFilterId);
  const { high, low } = splitSigRollingByPriceBand(items, highMin);
  return `${r.fadeMs}|${r.staticHoldMs}|${highMin}|H:${bandScheduleToken(high)}|L:${bandScheduleToken(low)}`;
}

function buildSigRollingTransition(fadeMs: number, props = "opacity"): string {
  const ms = Math.max(180, Math.min(5000, Math.floor(fadeMs) || 1000));
  return `${props} ${ms}ms ${SIG_ROLLING_EASE}`;
}

function RollingCardColumn({
  current,
  nextItem,
  fadePhase,
  fadeMs,
  pairSide,
  overlayUserId,
  onOrientationChange,
}: {
  current: SigRollingItem | null;
  nextItem: SigRollingItem | null;
  fadePhase: SigRollingFadePhase;
  fadeMs: number;
  pairSide?: "left" | "right";
  overlayUserId?: string;
  onOrientationChange?: (orientation: SigRollingMediaOrientation) => void;
}) {
  const under = nextItem || current;
  const srcCurrentRaw = current
    ? resolveSigRollingImageUrl(current.label || "", current.url, overlayUserId)
    : "";
  const srcUnderRaw = under
    ? resolveSigRollingImageUrl(under.label || "", under.url, overlayUserId)
    : "";
  const srcCurrent = toSigOverlayAbsoluteAssetUrl(srcCurrentRaw);
  const srcUnder = toSigOverlayAbsoluteAssetUrl(srcUnderRaw);
  const [errOverSrc, setErrOverSrc] = useState<string | null>(null);
  const [errUnderSrc, setErrUnderSrc] = useState<string | null>(null);
  const [orientation, setOrientation] = useState<SigRollingMediaOrientation>("landscape");
  /** cross 진입: 다음 장 로드 후 1프레임 대기 → 디졸브 (언마운트 깜빡임·빈칸 방지) */
  const [crossPaintReady, setCrossPaintReady] = useState(false);
  const [underLoaded, setUnderLoaded] = useState(false);
  const onOrientationRef = useRef(onOrientationChange);
  onOrientationRef.current = onOrientationChange;

  const shell = sigRollingShellOuterPx(orientation, SHELL_PAD_PX);
  const mediaFrameStyle: CSSProperties = {
    width: shell.mediaWidth,
    height: shell.mediaHeight,
  };
  const transitionCss = buildSigRollingTransition(fadeMs);

  useEffect(() => {
    setErrOverSrc(null);
  }, [srcCurrent]);

  useEffect(() => {
    setErrUnderSrc(null);
    setUnderLoaded(false);
  }, [srcUnder]);

  useEffect(() => {
    setOrientation("landscape");
    onOrientationRef.current?.("landscape");
  }, [srcCurrent]);

  const canBlend = Boolean(current && nextItem && nextItem.id !== current.id);
  const blending = Boolean(canBlend && fadePhase === "cross");

  useEffect(() => {
    if (!blending) {
      setCrossPaintReady(false);
      return;
    }
    if (!underLoaded) {
      setCrossPaintReady(false);
      return;
    }
    setCrossPaintReady(false);
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => setCrossPaintReady(true));
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [blending, underLoaded, current?.id, nextItem?.id]);

  const applyOrientationFromImg = useCallback((img: HTMLImageElement) => {
    const src = String(img.currentSrc || img.src || "").toLowerCase();
    if (src.includes("dummy-sig.svg")) {
      setOrientation("landscape");
      onOrientationRef.current?.("landscape");
      return;
    }
    if (img.naturalWidth <= 0 && img.naturalHeight <= 0) return;
    const next = classifySigRollingOrientation(img.naturalWidth, img.naturalHeight);
    setOrientation(next);
    onOrientationRef.current?.(next);
  }, []);

  const onImgLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement>) => {
      applyOrientationFromImg(e.currentTarget);
    },
    [applyOrientationFromImg]
  );

  const bindRollingImgRef = useCallback(
    (img: HTMLImageElement | null) => {
      if (img?.complete && img.naturalWidth > 0) applyOrientationFromImg(img);
    },
    [applyOrientationFromImg]
  );

  const shellTransitionStyle: CSSProperties = {
    transition: buildSigRollingTransition(Math.min(fadeMs, 480), "width, height"),
  };

  const overDisplay = errOverSrc ?? srcCurrent;
  const underDisplay = errUnderSrc ?? srcUnder;

  const onImgError = useCallback((which: "over" | "under") => {
    setOrientation("landscape");
    onOrientationRef.current?.("landscape");
    const fallback = toSigOverlayAbsoluteAssetUrl(BUNDLED_SIG_PLACEHOLDER_URL);
    if (which === "over") setErrOverSrc(fallback);
    else {
      setErrUnderSrc(fallback);
      setUnderLoaded(true);
    }
  }, []);

  if (!current) return null;

  const dissolveActive = blending && crossPaintReady;

  const shellBase =
    "overflow-hidden shadow-lg border border-white/20 bg-white/35 [transform:translateZ(0)] [backface-visibility:hidden]";
  const shellClass =
    pairSide === "left"
      ? `${shellBase} rounded-l-3xl rounded-r-none p-1.5`
      : pairSide === "right"
        ? `${shellBase} rounded-r-3xl rounded-l-none p-1.5`
        : `${shellBase} rounded-3xl p-1.5`;

  const frameClass =
    "relative grid place-items-center overflow-hidden rounded-2xl bg-white/15 [&>img]:col-start-1 [&>img]:row-start-1";
  const frameStyle: CSSProperties = {
    ...mediaFrameStyle,
    minWidth: shell.mediaWidth,
    maxWidth: shell.mediaWidth,
    minHeight: shell.mediaHeight,
    maxHeight: shell.mediaHeight,
    gridTemplateColumns: "1fr",
    gridTemplateRows: "1fr",
  };

  /**
   * 현재 장(img)은 항상 같은 슬롯에 유지 — idle↔cross 때 통째 언마운트하면
   * OBS/브라우저에서 깜빡인 뒤 안 보이는 문제가 남는다.
   * 전환 시에만 다음 장을 아래에 올려 opacity 디졸브.
   */
  return (
    <div className="shrink-0" style={{ width: shell.outerWidth, height: shell.outerHeight, ...shellTransitionStyle }}>
      <div className={shellClass} style={{ width: shell.outerWidth, height: shell.outerHeight, ...shellTransitionStyle }}>
        <div className={frameClass} style={frameStyle}>
          {blending && under ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`under-${under.id}`}
              ref={(img) => {
                if (img?.complete && img.naturalWidth > 0) setUnderLoaded(true);
              }}
              src={underDisplay}
              alt=""
              className={IMG_IN_FRAME}
              referrerPolicy="no-referrer"
              style={{
                opacity: dissolveActive ? 1 : 0,
                transition: dissolveActive || crossPaintReady ? transitionCss : "none",
                zIndex: 1,
              }}
              draggable={false}
              decoding="async"
              onLoad={() => setUnderLoaded(true)}
              onError={() => onImgError("under")}
            />
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`over-${current.id}`}
            ref={bindRollingImgRef}
            src={overDisplay}
            alt=""
            className={IMG_IN_FRAME}
            referrerPolicy="no-referrer"
            style={{
              opacity: dissolveActive ? 0 : 1,
              transition: blending ? transitionCss : "none",
              zIndex: 2,
            }}
            draggable={false}
            decoding="async"
            onLoad={onImgLoad}
            onError={() => onImgError("over")}
          />
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
  const items = useMemo(() => getUnifiedSigRollingItems(state, memberFilterId), [state, memberFilterId]);
  const { high: highItems, low: lowItems } = useMemo(
    () => splitSigRollingByPriceBand(items, highMin),
    [items, highMin]
  );
  const fadeMs = rolling.fadeMs;
  const totalCount = highItems.length + lowItems.length;
  const showPair = highItems.length > 0 && lowItems.length > 0;

  /** 좌=고액 / 우=저액 — 밴드별 독립 인덱스 */
  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(0);
  const [fadePhase, setFadePhase] = useState<SigRollingFadePhase>("idle");
  const [viewportW, setViewportW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 0));
  const [leftOrientation, setLeftOrientation] = useState<SigRollingMediaOrientation>("landscape");
  const [rightOrientation, setRightOrientation] = useState<SigRollingMediaOrientation>("landscape");

  const leftCurrent = pickSigRollingAt(highItems, leftIdx);
  const leftNext = highItems.length > 1 ? pickSigRollingAt(highItems, leftIdx + 1) : null;
  const rightCurrent = pickSigRollingAt(lowItems, rightIdx);
  const rightNext = lowItems.length > 1 ? pickSigRollingAt(lowItems, rightIdx + 1) : null;

  const scheduleKey = sigRollingScheduleKey(state, memberFilterId, highMin);

  const pairLayout = useMemo(() => {
    if (showPair) return sigRollingPairLayoutPx(leftOrientation, rightOrientation, SHELL_PAD_PX);
    if (highItems.length > 0) {
      const s = sigRollingShellOuterPx(leftOrientation, SHELL_PAD_PX);
      return { totalOuterWidth: s.outerWidth, maxOuterHeight: s.outerHeight };
    }
    const s = sigRollingShellOuterPx(rightOrientation, SHELL_PAD_PX);
    return { totalOuterWidth: s.outerWidth, maxOuterHeight: s.outerHeight };
  }, [showPair, highItems.length, leftOrientation, rightOrientation]);

  const bandsRef = useRef({ high: highItems, low: lowItems, fadeMs, staticHoldMs: rolling.staticHoldMs });
  bandsRef.current = { high: highItems, low: lowItems, fadeMs, staticHoldMs: rolling.staticHoldMs };

  /** 어느 한 밴드라도 2장 이상이면 전환 연출 */
  const canAdvance = highItems.length >= 2 || lowItems.length >= 2;
  const transitioning = fadePhase !== "idle";

  const preloadRollingImage = useCallback(
    (item: SigRollingItem | null | undefined) => {
      if (!item?.url || typeof window === "undefined") return;
      const src = toSigOverlayAbsoluteAssetUrl(
        resolveSigRollingImageUrl(item.label || "", item.url, overlayUserId)
      );
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
    const baseW = Math.max(pairLayout.totalOuterWidth, showPair ? TWO_CARD_BASE_WIDTH_PX : pairLayout.totalOuterWidth);
    const ratio = safeW / baseW;
    if (!Number.isFinite(ratio)) return 1;
    return Math.max(0.6, Math.min(1, ratio));
  }, [viewportW, pairLayout.totalOuterWidth, showPair]);

  const onLeftOrientation = useCallback((orientation: SigRollingMediaOrientation) => {
    setLeftOrientation(orientation);
  }, []);
  const onRightOrientation = useCallback((orientation: SigRollingMediaOrientation) => {
    setRightOrientation(orientation);
  }, []);

  useEffect(() => {
    const update = () => setViewportW(window.innerWidth || 0);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    setLeftIdx(0);
    setRightIdx(0);
    setFadePhase("idle");
    setLeftOrientation("landscape");
    setRightOrientation("landscape");
  }, [scheduleKey]);

  /** 전환 페이즈: cross = 디졸브 후 idle (다음 장 로드 대기 여유 포함) */
  useEffect(() => {
    if (!canAdvance || fadePhase === "idle") return;
    const ms = Math.max(180, fadeMs) + 320;
    const id = window.setTimeout(() => {
      if (fadePhase === "cross") {
        advanceBands();
        setFadePhase("idle");
      }
    }, ms);
    return () => window.clearTimeout(id);
  }, [fadePhase, canAdvance, fadeMs, advanceBands]);

  useEffect(() => {
    if (!ready || totalCount === 0 || transitioning) return;

    let cancelled = false;
    let timerId: number | undefined;

    void (async () => {
      const snap = bandsRef.current;
      const holdMs = snap.staticHoldMs;
      const visible: SigRollingItemWithPrice[] = [];
      const left = pickSigRollingAt(snap.high, leftIdx);
      const right = pickSigRollingAt(snap.low, rightIdx);
      if (left) visible.push(left);
      if (right) visible.push(right);
      if (!visible.length) return;

      let hold = holdMs;
      const holds = await Promise.all(
        visible.map((it) =>
          getSigRollingHoldMs(resolveSigRollingImageUrl(it.label || "", it.url, overlayUserId), holdMs)
        )
      );
      hold = Math.max(holdMs, ...holds);
      if (cancelled) return;

      timerId = window.setTimeout(() => {
        if (!canAdvance) return;
        preloadRollingImage(highItems.length > 1 ? pickSigRollingAt(snap.high, leftIdx + 1) : null);
        preloadRollingImage(lowItems.length > 1 ? pickSigRollingAt(snap.low, rightIdx + 1) : null);
        setFadePhase("cross");
      }, hold);
    })();

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [
    ready,
    totalCount,
    leftIdx,
    rightIdx,
    transitioning,
    scheduleKey,
    overlayUserId,
    canAdvance,
    highItems.length,
    lowItems.length,
    preloadRollingImage,
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

  if (!ready) {
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

  if (totalCount === 0) {
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
      className="overlay-root inline-block w-fit bg-transparent p-1 text-pastel-ink"
      style={{
        minWidth: pairLayout.totalOuterWidth + 8,
        minHeight: Math.max(pairLayout.maxOuterHeight, DEFAULT_PAIR_HEIGHT_PX) + 16,
      }}
    >
      <div
        style={{
          width: pairLayout.totalOuterWidth,
          transform: `scale(${twoCardScale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="flex flex-row flex-nowrap items-start gap-0 [isolation:isolate]">
          {leftCurrent ? (
            <RollingCardColumn
              current={leftCurrent}
              nextItem={highItems.length >= 2 ? leftNext : null}
              fadePhase={highItems.length >= 2 ? fadePhase : "idle"}
              fadeMs={fadeMs}
              pairSide={showPair ? "left" : undefined}
              overlayUserId={overlayUserId}
              onOrientationChange={onLeftOrientation}
            />
          ) : null}
          {rightCurrent ? (
            <RollingCardColumn
              current={rightCurrent}
              nextItem={lowItems.length >= 2 ? rightNext : null}
              fadePhase={lowItems.length >= 2 ? fadePhase : "idle"}
              fadeMs={fadeMs}
              pairSide={showPair ? "right" : undefined}
              overlayUserId={overlayUserId}
              onOrientationChange={onRightOrientation}
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
