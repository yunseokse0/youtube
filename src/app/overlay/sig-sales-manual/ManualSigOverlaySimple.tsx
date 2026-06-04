"use client";

import { useEffect, useMemo, useRef } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import type { SigItem } from "@/types";
import ResultOverlay from "@/components/sig-sales/ResultOverlay";
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { DEFAULT_SIG_SOLD_STAMP_URL } from "@/lib/constants";
import { resolveManualOneShotOverlayImageUrl } from "@/lib/manual-sig-broadcast";
import {
  getOverlayMemberFilterIdFromSearchParams,
  getOverlayUserIdFromSearchParams,
} from "@/lib/overlay-params";
import {
  readOverlayPollIntervalMs,
  readSigSalesOverlayPollMs,
} from "@/lib/overlay-pull-policy";
import { hydrateSigItemFromInventory, sigMatchesMemberFilter } from "@/lib/sig-roulette";
import { stripBundledSigPlaceholderItems } from "@/lib/sig-placeholder";
import { STATE_PICK_SIG_SALES } from "@/lib/state-api-pick";

export default function ManualSigOverlaySimple() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const memberFilterId = getOverlayMemberFilterIdFromSearchParams(sp);
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

  const { selected, oneShot, signImageUrl } = useMemo(() => {
    if (!state?.rouletteState) {
      return {
        selected: [] as SigItem[],
        oneShot: null as { name: string; price: number } | null,
        signImageUrl: "",
      };
    }
    const rs = state.rouletteState;
    const raw = (
      Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0
        ? rs.selectedSigs
        : Array.isArray(rs.results)
          ? rs.results
          : []
    ) as SigItem[];
    const inv = state.sigInventory || [];
    const hydrated = stripBundledSigPlaceholderItems(
      raw
        .filter((s) => sigMatchesMemberFilter(s, memberFilterId))
        .map((s) => hydrateSigItemFromInventory(s, inv, userId))
    );
    const selectedSigs = hydrated.slice(0, 5);
    const os = rs.oneShotResult;
    const oneShotPayload =
      os && Number(os.price) > 0
        ? { name: String(os.name || "한방 시그"), price: Math.floor(Number(os.price)) }
        : null;
    return {
      selected: selectedSigs,
      oneShot: oneShotPayload,
      signImageUrl: resolveManualOneShotOverlayImageUrl({
        state,
        selectedSigs,
        userId,
        oneShotName: oneShotPayload?.name,
      }),
    };
  }, [state, userId, memberFilterId]);

  const resultRowLayout = useMemo(
    () =>
      layoutSigOverlayResultRow({
        cellCount: selected.length + (oneShot ? 1 : 0),
        userScalePct: scalePct,
      }),
    [scalePct, selected.length, oneShot]
  );
  const visible = spReady && ready && selected.length >= 2;
  const soldOutStampUrl = DEFAULT_SIG_SOLD_STAMP_URL;

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
          당첨 없음 — 관리자에서 「리롤 → OBS」를 눌러 주세요.
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
          sigImageUserId={userId}
        />
      </div>
    </main>
  );
}
