"use client";

import { useEffect, useMemo, useRef } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import ResultOverlay from "@/components/sig-sales/ResultOverlay";
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import {
  buildManualOverlaySoldOverrideSet,
  resolveManualOneShotOverlayImageUrl,
  resolveManualOverlaySelectedSigs,
} from "@/lib/manual-sig-broadcast";
import {
  getOverlayUserIdFromSearchParams,
} from "@/lib/overlay-params";
import {
  readOverlayPollIntervalMs,
  readSigSalesOverlayPollMs,
} from "@/lib/overlay-pull-policy";
import { STATE_PICK_SIG_SALES } from "@/lib/state-api-pick";
import { DEFAULT_SIG_SOLD_STAMP_URL } from "@/lib/constants";

const MANUAL_OVERLAY_TERMINAL_PHASES = new Set([
  "LANDED",
  "CONFIRM_PENDING",
  "CONFIRMED",
]);

export default function ManualSigOverlaySimple() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const scaleRaw = sp.get("sigResultScalePct") || sp.get("resultScalePct") || "";
  const scalePct = (() => {
    const n = Number(scaleRaw);
    return Number.isFinite(n) ? Math.max(50, Math.min(100, Math.floor(n))) : 78;
  })();

  const pollMs = useMemo(() => {
    const env = readOverlayPollIntervalMs();
    return env > 0 ? env : readSigSalesOverlayPollMs() || 2200;
  }, []);

  const { state, ready, resync } = useOverlayRemoteState(userId, {
    statePick: STATE_PICK_SIG_SALES,
    skipLocalSnapshot: true,
    forceInitialFull: true,
    overlayPollMs: pollMs,
    persistLastGood: true,
  });

  const overlayReloadSeenRef = useRef<number | null>(null);

  useEffect(() => {
    const nonce = Number(state?.rouletteState?.overlayReloadNonce || 0);
    if (!Number.isFinite(nonce)) return;
    if (overlayReloadSeenRef.current == null) {
      overlayReloadSeenRef.current = nonce;
      return;
    }
    if (nonce !== overlayReloadSeenRef.current) {
      overlayReloadSeenRef.current = nonce;
      void resync({ forceFull: true });
    }
  }, [state?.rouletteState?.overlayReloadNonce, resync]);

  const selected = useMemo(
    () => resolveManualOverlaySelectedSigs(state, userId),
    [state, userId]
  );

  const soldOverrideSet = useMemo(
    () => buildManualOverlaySoldOverrideSet(state, selected, userId),
    [state, selected, userId]
  );

  const oneShot = useMemo(() => {
    const os = state?.rouletteState?.oneShotResult;
    if (!os || Number(os.price) <= 0) return null;
    return {
      name: String(os.name || "한방 시그"),
      price: Math.floor(Number(os.price)),
    };
  }, [state?.rouletteState?.oneShotResult]);

  const signImageUrl = useMemo(
    () =>
      resolveManualOneShotOverlayImageUrl({
        state,
        selectedSigs: selected,
        userId,
        oneShotName: oneShot?.name,
      }),
    [state, selected, userId, oneShot?.name]
  );

  const resultRowLayout = useMemo(
    () =>
      layoutSigOverlayResultRow({
        cellCount: selected.length + (oneShot ? 1 : 0),
        userScalePct: scalePct,
      }),
    [scalePct, selected.length, oneShot]
  );

  const phase = String(state?.rouletteState?.phase || "");
  const terminalPhase = MANUAL_OVERLAY_TERMINAL_PHASES.has(phase);
  const visible = spReady && ready && terminalPhase && selected.length >= 2;
  const soldOutStampUrl = String(state?.sigSoldOutStampUrl || "").trim() || DEFAULT_SIG_SOLD_STAMP_URL;

  if (!spReady || !ready) {
    return (
      <main className="min-h-0 bg-transparent p-4 text-center text-xs text-neutral-400">
        수동 시그 오버레이 불러오는 중…
      </main>
    );
  }

  if (!visible) {
    return (
      <main className="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center bg-transparent px-4">
        <p className="rounded-lg border border-yellow-400/35 bg-black/70 px-4 py-2 text-xs text-yellow-100">
          {terminalPhase
            ? "당첨 시그를 불러오지 못했습니다. 관리자에서 「리롤」 또는 「수동 결과 적용(LANDED)」 후 OBS 캐시 새로고침."
            : "대기 중 — 관리자에서 「수동 결과 적용(LANDED)」 또는 「리롤」을 눌러 주세요."}
        </p>
      </main>
    );
  }

  return (
    <main className="pointer-events-none fixed inset-0 z-[1] flex flex-col justify-end items-center bg-transparent p-0">
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
        />
      </div>
    </main>
  );
}
