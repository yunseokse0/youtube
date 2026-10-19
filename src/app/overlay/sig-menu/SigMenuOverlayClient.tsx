"use client";

import { useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import SigNeonMenuBoard from "@/components/sig-sales/SigNeonMenuBoard";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import {
  getOverlayMemberFilterIdFromSearchParams,
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import {
  readOverlayPollIntervalMs,
  readSigSalesManualOverlayPollMs,
} from "@/lib/overlay-pull-policy";
import { clearOverlayLastGood } from "@/lib/overlay-last-good";
import { STATE_PICK_SIG_SALES } from "@/lib/state-api-pick";

function MenuOverlayStatus({
  hostObs,
  children,
}: {
  hostObs: boolean;
  children: ReactNode;
}) {
  if (hostObs) return null;
  return (
    <main className="min-h-0 bg-transparent p-4 text-center">
      <p className="text-xs text-neutral-400">{children}</p>
    </main>
  );
}

export default function SigMenuOverlayClient() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const hostObs = isOverlayBroadcastHost(sp);
  const memberFilterId = getOverlayMemberFilterIdFromSearchParams(sp);

  useLayoutEffect(() => {
    if (!spReady || !hostObs) return;
    clearOverlayLastGood(userId, STATE_PICK_SIG_SALES);
  }, [spReady, hostObs, userId]);

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
    sigSalesIncrementalPoll: false,
  });

  useEffect(() => {
    if (!spReady || !hostObs) return;
    const t = window.setTimeout(() => void resync({ forceFull: true }), 1400);
    return () => window.clearTimeout(t);
  }, [spReady, hostObs, resync]);

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

  const items = useMemo(() => {
    const pool = listActiveManualSigPool(state?.sigInventory, {
      ignoreStock: true,
      sigSalesExcludedIds: state?.sigSalesExcludedIds,
      memberFilterId: memberFilterId || undefined,
      ownerUserId: userId,
    });
    return [...pool]
      .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, "ko"))
      .map((row) => ({ id: row.id, name: row.name, price: row.price }));
  }, [state?.sigInventory, state?.sigSalesExcludedIds, memberFilterId, userId]);

  const rootClass = hostObs
    ? "pointer-events-none fixed inset-0 z-[200] flex flex-col items-center justify-start overflow-visible bg-transparent p-3 pt-4"
    : "pointer-events-none fixed inset-0 z-[1] flex flex-col items-center justify-start bg-transparent p-4 pt-6";

  if (!spReady) return null;

  if (!ready && !hostObs) {
    return <MenuOverlayStatus hostObs={hostObs}>시그 메뉴 불러오는 중…</MenuOverlayStatus>;
  }

  if (!ready && hostObs && items.length === 0) {
    return null;
  }

  return (
    <main className={rootClass}>
      <SigNeonMenuBoard items={items} className="w-full px-1" />
    </main>
  );
}
