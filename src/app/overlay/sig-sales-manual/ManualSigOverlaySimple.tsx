"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { SigItem } from "@/types";
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";
import { loadStateFromApi } from "@/lib/state";
import { STATE_PICK_SIG_SALES } from "@/lib/state-api-pick";
import {
  getOverlayMemberFilterIdFromSearchParams,
  getOverlayUserIdFromSearchParams,
} from "@/lib/overlay-params";
import { DEFAULT_SIG_SOLD_STAMP_URL } from "@/lib/constants";
import { resolveManualOneShotOverlayImageUrl } from "@/lib/manual-sig-broadcast";
import { hydrateSigItemFromInventory, sigMatchesMemberFilter } from "@/lib/sig-roulette";
import { stripBundledSigPlaceholderItems } from "@/lib/sig-placeholder";

const ResultOverlay = dynamic(() => import("@/components/sig-sales/ResultOverlay"), { ssr: false });

export default function ManualSigOverlaySimple() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const memberFilterId = getOverlayMemberFilterIdFromSearchParams(sp);
  const scaleRaw = sp.get("sigResultScalePct") || sp.get("resultScalePct") || "";
  const scalePct = (() => {
    const n = Number(scaleRaw);
    return Number.isFinite(n) ? Math.max(50, Math.min(100, Math.floor(n))) : 78;
  })();

  const [ready, setReady] = useState(false);
  const [selected, setSelected] = useState<SigItem[]>([]);
  const [oneShot, setOneShot] = useState<{ name: string; price: number } | null>(null);
  const [signImageUrl, setSignImageUrl] = useState("");
  const soldOutStampUrl = DEFAULT_SIG_SOLD_STAMP_URL;

  const load = useCallback(async () => {
    const remote = await loadStateFromApi(userId, { pick: STATE_PICK_SIG_SALES, forceFull: true });
    if (!remote?.rouletteState) {
      setReady(true);
      return;
    }
    const rs = remote.rouletteState;
    const sid = String(rs.sessionId || "").trim();
    const raw = (
      Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0
        ? rs.selectedSigs
        : Array.isArray(rs.results)
          ? rs.results
          : []
    ) as SigItem[];
    const inv = remote.sigInventory || [];
    const hydrated = stripBundledSigPlaceholderItems(
      raw
        .filter((s) => sigMatchesMemberFilter(s, memberFilterId))
        .map((s) => hydrateSigItemFromInventory(s, inv, userId))
    );
    setSelected(hydrated.slice(0, 5));
    const os = rs.oneShotResult;
    const oneShotPayload =
      os && Number(os.price) > 0
        ? { name: String(os.name || "한방 시그"), price: Math.floor(Number(os.price)) }
        : null;
    setOneShot(oneShotPayload);
    setSignImageUrl(
      resolveManualOneShotOverlayImageUrl({
        state: remote,
        selectedSigs: hydrated,
        userId,
        oneShotName: oneShotPayload?.name,
      })
    );
    setReady(true);
  }, [userId, memberFilterId]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 2200);
    return () => window.clearInterval(id);
  }, [load]);

  const resultRowLayout = useMemo(
    () =>
      layoutSigOverlayResultRow({
        cellCount: selected.length + (oneShot ? 1 : 0),
        userScalePct: scalePct,
      }),
    [scalePct, selected.length, oneShot]
  );
  const visible = ready && selected.length >= 2;

  if (!ready) {
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
