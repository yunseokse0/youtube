"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import ResultOverlay from "@/components/sig-sales/ResultOverlay";
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import {
  buildManualOverlaySoldOverrideSet,
  resolveManualOneShotDisplayFromState,
  resolveManualOneShotStoredImageUrl,
  resolveManualOverlaySelectedSigs,
} from "@/lib/manual-sig-broadcast";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import {
  readOverlayPollIntervalMs,
  readSigSalesManualOverlayPollMs,
} from "@/lib/overlay-pull-policy";
import {
  manualSigBroadcastPhase,
  manualSigBroadcastReloadNonce,
} from "@/lib/manual-sig-broadcast-state";
import { clearOverlayLastGood } from "@/lib/overlay-last-good";
import { STATE_PICK_SIG_SALES } from "@/lib/state-api-pick";
import { DEFAULT_SIG_SOLD_STAMP_URL } from "@/lib/constants";

const MANUAL_OVERLAY_TERMINAL_PHASES = new Set([
  "LANDED",
  "CONFIRM_PENDING",
  "CONFIRMED",
]);

/** OBS CEF: `absolute`는 부모 높이 0일 때 전체가 안 보임 → 방송 오버레이와 동일하게 `fixed` */
function obsOverlayRootClass(hostObs: boolean): string {
  return hostObs
    ? "pointer-events-none fixed inset-0 z-[200] flex flex-col justify-end items-center overflow-visible bg-transparent p-0"
    : "pointer-events-none fixed inset-0 z-[1] flex flex-col justify-end items-center bg-transparent p-0";
}

function ManualOverlayStatus({
  hostObs,
  children,
}: {
  hostObs: boolean;
  children: ReactNode;
}) {
  if (hostObs) return null;
  return (
    <main
      className={
        hostObs
          ? "pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-transparent p-6"
          : "min-h-0 bg-transparent p-4 text-center"
      }
    >
      <p
        className={
          hostObs
            ? "max-w-lg rounded-lg border border-yellow-400/40 bg-black/80 px-4 py-3 text-center text-sm font-medium text-yellow-50 shadow-lg"
            : "text-xs text-neutral-400"
        }
      >
        {children}
      </p>
    </main>
  );
}

function readBootOverlaySearchParams(): URLSearchParams {
  if (typeof window === "undefined") return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export default function ManualSigOverlaySimple() {
  const bootSp = useMemo(() => readBootOverlaySearchParams(), []);
  const bootHostObs = isOverlayBroadcastHost(bootSp);
  const bootUserId = getOverlayUserIdFromSearchParams(bootSp);

  useLayoutEffect(() => {
    if (!bootHostObs) return;
    /** OBS 첫 마운트 — 구 last-good이 IDLE 리셋·리롤을 가리는 것 방지 */
    clearOverlayLastGood(bootUserId, STATE_PICK_SIG_SALES);
  }, [bootHostObs, bootUserId]);

  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const hostObs = spReady ? isOverlayBroadcastHost(sp) : bootHostObs;
  const debugOverlay = sp.get("overlayDebug") === "1";
  const scaleRaw = sp.get("sigResultScalePct") || sp.get("resultScalePct") || "";
  const scalePct = (() => {
    const n = Number(scaleRaw);
    return Number.isFinite(n) ? Math.max(62, Math.min(100, Math.floor(n))) : 92;
  })();

  const pollMs = useMemo(() => {
    const env = readOverlayPollIntervalMs();
    if (env > 0) return env;
    return readSigSalesManualOverlayPollMs();
  }, []);

  const { state, ready, resync } = useOverlayRemoteState(userId, {
    statePick: STATE_PICK_SIG_SALES,
    skipLocalSnapshot: true,
    forceInitialFull: true,
    overlayPollMs: pollMs,
    persistLastGood: true,
    /** 수동 OBS는 매 폴링 전체 수신 — 304로 리롤 LANDED를 놓치면 빈 화면 */
    sigSalesIncrementalPoll: false,
  });

  const overlayReloadSeenRef = useRef<number | null>(null);

  useEffect(() => {
    const nonce = manualSigBroadcastReloadNonce(state);
    if (!Number.isFinite(nonce)) return;
    if (overlayReloadSeenRef.current == null) {
      overlayReloadSeenRef.current = nonce;
      return;
    }
    if (nonce !== overlayReloadSeenRef.current) {
      overlayReloadSeenRef.current = nonce;
      /** 리롤·리셋 직후 구 last-good·304 레이스 방지 */
      clearOverlayLastGood(userId, STATE_PICK_SIG_SALES);
      void resync({ forceFull: true });
      if (hostObs) {
        window.setTimeout(() => void resync({ forceFull: true }), 600);
      }
    }
  }, [state, resync, hostObs, userId]);

  /** OBS CEF: 첫 paint 지연 대비 1회만 추가 당김(주기 폴링은 useOverlayRemoteState) */
  useEffect(() => {
    if (!spReady || !hostObs) return;
    const t = window.setTimeout(() => void resync({ forceFull: true }), 1400);
    return () => window.clearTimeout(t);
  }, [spReady, hostObs, resync, userId]);

  /** OBS 브라우저 소스: 탭 전환·소스 재표시 시 상태 재동기화 (obs-text와 동일) */
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

  const selected = useMemo(
    () => resolveManualOverlaySelectedSigs(state, userId),
    [state, userId]
  );

  const soldOverrideSet = useMemo(
    () => buildManualOverlaySoldOverrideSet(state, selected, userId),
    [state, selected, userId]
  );

  const oneShot = useMemo(() => {
    const resolved = resolveManualOneShotDisplayFromState(state, selected, userId);
    if (resolved) {
      return { name: resolved.name, price: resolved.price };
    }
    return null;
  }, [state, selected, userId]);

  const signImageUrl = useMemo(
    () => resolveManualOneShotStoredImageUrl({ state, selectedSigs: selected }),
    [state, selected]
  );

  const resultRowLayout = useMemo(
    () =>
      layoutSigOverlayResultRow({
        cellCount: selected.length + (oneShot ? 1 : 0),
        userScalePct: scalePct,
        allowOverflow: hostObs,
      }),
    [scalePct, selected.length, oneShot, hostObs]
  );

  const phase = manualSigBroadcastPhase(state);
  const terminalPhase = MANUAL_OVERLAY_TERMINAL_PHASES.has(phase);
  const hasResults = selected.length >= 2;
  /** 당첨 2개 이상이면 표시. OBS는 ready 전에도 당첨이 있으면 표시(CEF fetch 지연 대비) */
  const visible = spReady && hasResults && (ready || hostObs);
  const soldOutStampUrl = String(state?.sigSoldOutStampUrl || "").trim() || DEFAULT_SIG_SOLD_STAMP_URL;

  const rootClass = obsOverlayRootClass(hostObs);

  if (!spReady && !bootHostObs) {
    return (
      <ManualOverlayStatus hostObs={hostObs}>
        수동 시그 오버레이 불러오는 중…
      </ManualOverlayStatus>
    );
  }

  if (!ready && !hostObs) {
    return (
      <ManualOverlayStatus hostObs={hostObs}>
        수동 시그 오버레이 불러오는 중…
      </ManualOverlayStatus>
    );
  }

  if (!ready && hostObs && !hasResults) {
    return (
      <ManualOverlayStatus hostObs={hostObs}>
        상태 동기화 중… (계정: {userId})
      </ManualOverlayStatus>
    );
  }

  if (!visible) {
    return (
      <>
        {debugOverlay ? (
          <div className="pointer-events-none absolute left-2 top-2 z-[99] rounded bg-black/85 px-2 py-1 font-mono text-[10px] text-lime-300">
            phase={phase || "(없음)"} · sigs={selected.length} · terminal=
            {terminalPhase ? "Y" : "N"} · u={userId}
          </div>
        ) : null}
        <ManualOverlayStatus hostObs={hostObs}>
          {terminalPhase
            ? "당첨 시그를 불러오지 못했습니다. 관리자에서 「리롤」 또는 「수동 결과 적용(LANDED)」 후 OBS에서 이 소스 우클릭 → 「새로고침」."
            : "대기 중 — 관리자에서 「수동 결과 적용(LANDED)」 또는 「리롤」을 눌러 주세요."}
        </ManualOverlayStatus>
      </>
    );
  }

  return (
    <>
      {debugOverlay ? (
        <div className="pointer-events-none absolute left-2 top-2 z-[99] rounded bg-black/85 px-2 py-1 font-mono text-[10px] text-lime-300">
          OK · phase={phase} · sigs={selected.length} · u={userId}
        </div>
      ) : null}
      <main className={rootClass}>
        <div
          className="pointer-events-none flex w-full max-w-full justify-center overflow-visible px-3 pb-4 md:px-6"
          style={resultRowLayout.bandStyle}
        >
          <ResultOverlay
            visible
            selectedSigs={selected}
            soldOutStampUrl={soldOutStampUrl}
            oneShot={oneShot}
            signImageUrl={signImageUrl}
            showOneShotReveal={Boolean(oneShot)}
            cardScalePct={resultRowLayout.cardScalePct}
            className="w-full max-w-full"
            showConfirmedBadge={false}
            disableCardMotion
            soldOverrideSet={soldOverrideSet}
            sigImageUserId={userId}
            skipHanbangSignLoadingOverlay={hostObs}
          />
        </div>
      </main>
    </>
  );
}
