"use client";

import type { CSSProperties } from "react";
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
  SIG_ROLLING_MEDIA_HEIGHT_PX,
  SIG_ROLLING_MEDIA_WIDTH_PX,
} from "@/components/sig-sales/sig-overlay-card-size";

/** 202×300 프레임 안에 맞춤 — 원본 GIF/PNG 해상도와 무관, 잘림 없음(object-contain + flex/grid 최소크기 이슈 방지) */
const IMG_IN_FRAME =
  "pointer-events-none select-none block h-full w-full max-h-full max-w-full min-h-0 min-w-0 object-contain object-center";

const mediaFrameStyle: CSSProperties = {
  width: SIG_ROLLING_MEDIA_WIDTH_PX,
  height: SIG_ROLLING_MEDIA_HEIGHT_PX,
};
const SHELL_PAD_PX = 6;
const SHELL_OUTER_WIDTH_PX = SIG_ROLLING_MEDIA_WIDTH_PX + SHELL_PAD_PX * 2;
const SHELL_OUTER_HEIGHT_PX = SIG_ROLLING_MEDIA_HEIGHT_PX + SHELL_PAD_PX * 2;
const TWO_CARD_BASE_WIDTH_PX = SHELL_OUTER_WIDTH_PX * 2;

/** 폴링으로 `state` 객체만 바뀌고 내용은 같을 때도 참조가 매번 바뀌지 않도록 문자열 키로 구분 (타이머 effect 무한 리셋 방지) */
function sigRollingScheduleKey(state: AppState | null, memberFilterId: string): string {
  const r = normalizeSigRolling(state?.sigRolling);
  const items = getUnifiedSigRollingItems(state, memberFilterId);
  return `${r.fadeMs}|${r.staticHoldMs}|${items.map((x) => `${x.id}\u001f${x.url}`).join("\u001e")}`;
}

function RollingCardColumn({
  current,
  nextItem,
  fading,
  transitionActive,
  replayKey,
  enableCrossfade,
  pairSide,
  overlayUserId,
}: {
  current: SigRollingItem | null;
  nextItem: SigRollingItem | null;
  fading: boolean;
  transitionActive: string;
  replayKey: number;
  enableCrossfade: boolean;
  /** 한 줄에 두 장일 때 맞닿는 쪽 패딩·모서리만 줄여 간격 최소화 */
  pairSide?: "left" | "right";
  overlayUserId?: string;
}) {
  const under = current ? nextItem || current : null;
  const srcCurrentRaw = current
    ? resolveSigRollingImageUrl(current.label || "", current.url, overlayUserId)
    : "";
  const srcUnderRaw = under
    ? resolveSigRollingImageUrl(under.label || "", under.url, overlayUserId)
    : "";
  const srcCurrent = toSigOverlayAbsoluteAssetUrl(srcCurrentRaw);
  const srcUnder = toSigOverlayAbsoluteAssetUrl(srcUnderRaw);
  const [imgSrc, setImgSrc] = useState(srcCurrent);
  const [imgUnderSrc, setImgUnderSrc] = useState(srcUnder);

  useEffect(() => {
    setImgSrc(srcCurrent);
    setImgUnderSrc(srcUnder);
  }, [srcCurrent, srcUnder]);

  const onImgError = useCallback((which: "over" | "under") => {
    const fallback = toSigOverlayAbsoluteAssetUrl(BUNDLED_SIG_PLACEHOLDER_URL);
    if (which === "over") setImgSrc(fallback);
    else setImgUnderSrc(fallback);
  }, []);

  if (!current) return null;

  const cardUnder = nextItem || current;

  /**
   * 모바일(WebView/Safari)에서는 backdrop-filter 계열이 투명 캔버스와 겹칠 때
   * 카드 외곽이 검은 타일처럼 보이는 경우가 있어, sig-rolling은 블러 없이 고정 셸 사용.
   */
  const shellBase = "overflow-hidden shadow-lg border border-white/20 bg-white/35";
  const shellClass =
    pairSide === "left"
      ? `${shellBase} rounded-l-3xl rounded-r-none p-1.5`
      : pairSide === "right"
        ? `${shellBase} rounded-r-3xl rounded-l-none p-1.5`
        : `${shellBase} rounded-3xl p-1.5`;

  if (!enableCrossfade) {
    return (
      <div className="shrink-0" style={{ width: SHELL_OUTER_WIDTH_PX, height: SHELL_OUTER_HEIGHT_PX }}>
        <div className={shellClass} style={{ width: SHELL_OUTER_WIDTH_PX, height: SHELL_OUTER_HEIGHT_PX }}>
          <div
            className="flex items-center justify-center overflow-hidden rounded-2xl bg-white/15"
            style={{
              ...mediaFrameStyle,
              minWidth: SIG_ROLLING_MEDIA_WIDTH_PX,
              maxWidth: SIG_ROLLING_MEDIA_WIDTH_PX,
              minHeight: SIG_ROLLING_MEDIA_HEIGHT_PX,
              maxHeight: SIG_ROLLING_MEDIA_HEIGHT_PX,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={replayKey}
              src={imgSrc}
              alt=""
              className={IMG_IN_FRAME}
              draggable={false}
              decoding="async"
              referrerPolicy="no-referrer"
              onError={() => onImgError("over")}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0" style={{ width: SHELL_OUTER_WIDTH_PX, height: SHELL_OUTER_HEIGHT_PX }}>
      <div className={shellClass} style={{ width: SHELL_OUTER_WIDTH_PX, height: SHELL_OUTER_HEIGHT_PX }}>
        <div
          className="relative grid place-items-center overflow-hidden rounded-2xl bg-white/15 [&>img]:col-start-1 [&>img]:row-start-1"
          style={{
            ...mediaFrameStyle,
            minWidth: SIG_ROLLING_MEDIA_WIDTH_PX,
            maxWidth: SIG_ROLLING_MEDIA_WIDTH_PX,
            minHeight: SIG_ROLLING_MEDIA_HEIGHT_PX,
            maxHeight: SIG_ROLLING_MEDIA_HEIGHT_PX,
            gridTemplateColumns: "1fr",
            gridTemplateRows: "1fr",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`under-${cardUnder.id}`}
            src={imgUnderSrc}
            alt=""
            className={IMG_IN_FRAME}
            referrerPolicy="no-referrer"
            style={{
              opacity: fading ? 1 : 0,
              transition: fading ? transitionActive : "none",
              zIndex: 1,
            }}
            draggable={false}
            decoding="async"
            onError={() => onImgError("under")}
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={`over-${current.id}`}
            src={imgSrc}
            alt=""
            className={IMG_IN_FRAME}
            referrerPolicy="no-referrer"
            style={{
              opacity: fading ? 0 : 1,
              transition: fading ? transitionActive : "none",
              zIndex: 2,
            }}
            draggable={false}
            decoding="async"
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

function SigRollingOverlayInner() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const memberFilterId = getOverlayMemberFilterIdFromSearchParams(sp);
  const { state, ready } = useOverlayRemoteState(userId);
  const overlayUserId = useMemo(
    () => inferSigUploadUserIdFromInventory(state?.sigInventory, userId),
    [state?.sigInventory, userId]
  );

  const rolling = useMemo(() => normalizeSigRolling(state?.sigRolling), [state?.sigRolling]);
  const items = useMemo(() => getUnifiedSigRollingItems(state, memberFilterId), [state, memberFilterId]);
  const rollingUnified = useMemo(() => ({ ...rolling, items }), [rolling, items]);
  const fadeMs = rolling.fadeMs;

  /** 한 줄에 왼쪽·오른쪽 카드가 함께 넘어가도록 페어 시작 인덱스(짝 단위 +2) */
  const [pairStart, setPairStart] = useState(0);
  const [fading, setFading] = useState(false);
  const [replayKey, setReplayKey] = useState(0);
  const [viewportW, setViewportW] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 0));

  const n = items.length;
  const leftCurrent = n ? items[pairStart % n] : null;
  const rightCurrent = n ? items[(pairStart + 1) % n] : null;
  const leftNext = n ? items[(pairStart + 2) % n] : null;
  const rightNext = n ? items[(pairStart + 3) % n] : null;

  const scheduleKey = sigRollingScheduleKey(state, memberFilterId);
  const rollingRef = useRef(rollingUnified);
  rollingRef.current = rollingUnified;

  /** 페어 크로스페이드는 항목 3개 이상일 때만 (n>=1 등으로 바꾸면 표시/타이머가 어긋남) */
  const enableCrossfade = n >= 3;
  const twoCardScale = useMemo(() => {
    if (!Number.isFinite(viewportW) || viewportW <= 0) return 1;
    const safeW = Math.max(260, viewportW - 8);
    const ratio = safeW / TWO_CARD_BASE_WIDTH_PX;
    if (!Number.isFinite(ratio)) return 1;
    return Math.max(0.6, Math.min(1, ratio));
  }, [viewportW]);

  useEffect(() => {
    const update = () => setViewportW(window.innerWidth || 0);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    setPairStart(0);
    setReplayKey(0);
    setFading(false);
  }, [scheduleKey]);

  /** 크로스페이드 종료: CSS transitionEnd는 누락될 수 있어 fadeMs 타이머로만 진행 */
  useEffect(() => {
    if (!fading || n < 3) return;
    const ms = Math.max(120, fadeMs);
    const id = window.setTimeout(() => {
      setPairStart((p) => {
        const len = rollingRef.current.items.length;
        return len < 3 ? p : (p + 2) % len;
      });
      setFading(false);
    }, ms);
    return () => window.clearTimeout(id);
  }, [fading, n, fadeMs]);

  useEffect(() => {
    if (!ready || n === 0 || fading) return;

    let cancelled = false;
    let timerId: number | undefined;

    void (async () => {
      const r = rollingRef.current;
      const list = r.items;
      const nn = list.length;
      const holdMs = r.staticHoldMs;
      if (nn === 0) return;

      let hold = holdMs;
      if (nn === 1) {
        const it = list[0];
        if (!it?.url) return;
        hold = await getSigRollingHoldMs(
          resolveSigRollingImageUrl(it.label || "", it.url, overlayUserId),
          holdMs
        );
      } else if (nn === 2) {
        const h0 = await getSigRollingHoldMs(
          resolveSigRollingImageUrl(list[0].label || "", list[0].url, overlayUserId),
          holdMs
        );
        const h1 = await getSigRollingHoldMs(
          resolveSigRollingImageUrl(list[1].label || "", list[1].url, overlayUserId),
          holdMs
        );
        hold = Math.max(h0, h1);
      } else {
        const uL = list[pairStart % nn];
        const uR = list[(pairStart + 1) % nn];
        if (!uL?.url || !uR?.url) return;
        hold = Math.max(
          await getSigRollingHoldMs(
            resolveSigRollingImageUrl(uL.label || "", uL.url, overlayUserId),
            holdMs
          ),
          await getSigRollingHoldMs(
            resolveSigRollingImageUrl(uR.label || "", uR.url, overlayUserId),
            holdMs
          )
        );
      }
      if (cancelled) return;
      timerId = window.setTimeout(() => {
        if (nn <= 2) {
          setReplayKey((k) => k + 1);
        } else {
          setFading(true);
        }
      }, hold);
    })();

    return () => {
      cancelled = true;
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [ready, n, pairStart, fading, scheduleKey, replayKey, overlayUserId]);

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

  if (n === 0) {
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
            <code className="rounded bg-white/15 px-1">?u=본인아이디</code>(예: finalent)가 맞는지 확인하세요. 관리자에서 저장한 뒤 서버(
            Redis)에 반영되어야 OBS에서도 보입니다.
          </p>
        </div>
      </main>
    );
  }

  const transitionActive = `opacity ${fadeMs}ms ease-in-out`;

  return (
    <main
      className="overlay-root inline-block w-fit bg-transparent p-1 text-pastel-ink"
      style={{ minWidth: TWO_CARD_BASE_WIDTH_PX + 8, minHeight: SHELL_OUTER_HEIGHT_PX + 16 }}
    >
      <div
        style={{
          width: TWO_CARD_BASE_WIDTH_PX,
          transform: `scale(${twoCardScale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="flex flex-row flex-nowrap items-start gap-0">
          <RollingCardColumn
            current={leftCurrent}
            nextItem={enableCrossfade ? leftNext : null}
            fading={fading}
            transitionActive={transitionActive}
            replayKey={replayKey}
            enableCrossfade={enableCrossfade}
            pairSide="left"
            overlayUserId={overlayUserId}
          />
          <RollingCardColumn
            current={rightCurrent}
            nextItem={enableCrossfade ? rightNext : null}
            fading={fading}
            transitionActive={transitionActive}
            replayKey={replayKey}
            enableCrossfade={enableCrossfade}
            pairSide="right"
            overlayUserId={overlayUserId}
          />
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
