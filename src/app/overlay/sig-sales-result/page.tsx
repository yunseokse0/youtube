"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import { loadStateFromApi, normalizeRouletteState, type AppState } from "@/lib/state";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { SigItem } from "@/types";

const POLL_MS = 1000;
const CONFIRMED_VISIBLE_SLOTS = 5;
const DEMO_SELECTED: SigItem[] = [
  { id: "demo_res_1", name: "애교", price: 77000, imageUrl: "/images/sigs/애교.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true, memberId: "demo-1" },
  { id: "demo_res_2", name: "댄스", price: 100000, imageUrl: "/images/sigs/댄스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true, memberId: "demo-2" },
  { id: "demo_res_3", name: "식사권", price: 333000, imageUrl: "/images/sigs/식사권.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true, memberId: "demo-3" },
  { id: "demo_res_4", name: "보이스", price: 50000, imageUrl: "/images/sigs/보이스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true, memberId: "demo-1" },
  { id: "demo_res_5", name: "노래", price: 120000, imageUrl: "/images/sigs/노래.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true, memberId: "demo-2" },
];

export default function SigSalesResultOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const demoMode = sp.get("demo") === "1" || sp.get("demo") === "true";
  const memberIdParam = (sp.get("memberId") || sp.get("member") || "").trim();
  const memberFilterId = memberIdParam.length > 0 ? memberIdParam : "";
  const [state, setState] = useState<AppState | null>(null);
  const syncingRef = useRef(false);

  const loadRemote = useCallback(async () => {
    if (demoMode) return;
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const remote = await loadStateFromApi(userId);
      if (remote) setState(remote);
    } finally {
      syncingRef.current = false;
    }
  }, [userId, demoMode]);

  useEffect(() => {
    if (demoMode) return;
    void loadRemote();
    const id = window.setInterval(() => void loadRemote(), POLL_MS);
    return () => window.clearInterval(id);
  }, [loadRemote, demoMode]);

  const roulette = useMemo(() => normalizeRouletteState(state?.rouletteState), [state?.rouletteState]);
  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || "/images/sigs/dummy-sig.svg";
  const soldSet = useMemo(() => {
    const set = new Set<string>();
    for (const item of state?.sigInventory || []) {
      if ((item.soldCount || 0) >= (item.maxCount || 1)) set.add(item.id);
    }
    return set;
  }, [state?.sigInventory]);

  const selected = useMemo(() => {
    const base = demoMode ? DEMO_SELECTED : (roulette.selectedSigs || []);
    if (!memberFilterId) return base.slice(0, CONFIRMED_VISIBLE_SLOTS);
    return base
      .filter((item) => String(item.memberId || "").trim() === memberFilterId)
      .slice(0, CONFIRMED_VISIBLE_SLOTS);
  }, [roulette.selectedSigs, memberFilterId, demoMode]);
  const oneShot = demoMode
    ? { id: ONE_SHOT_SIG_ID, name: "한방 시그", price: DEMO_SELECTED.reduce((sum, x) => sum + x.price, 0) }
    : roulette.oneShotResult;
  const hasResult = selected.length > 0;
  const oneShotImageUrl = useMemo(() => {
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    return oneShotItem?.imageUrl || "/images/sigs/dummy-sig.svg";
  }, [state?.sigInventory]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[1280px]">
        {hasResult ? (
          <section className="rounded-xl border border-white/20 bg-black/45 p-2 backdrop-blur-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-fuchsia-200/90">회전판 결과 오버레이</p>
              <p className="text-[11px] text-neutral-300">상태: {demoMode ? "DEMO" : (roulette.phase || "IDLE")}</p>
            </div>
            <SelectedSigs
              items={selected}
              soldOutStampUrl={soldOutStampUrl}
              manualSoldSet={new Set()}
              compact
              disabled
              showToggle={false}
              soldOverrideSet={soldSet}
              onToggleSold={() => {}}
              trailingSlot={hasResult && oneShot ? (
                <OneShotSigCard
                  name={oneShot.name || "한방 시그"}
                  price={Math.max(0, Number(oneShot.price || 0))}
                  imageUrl={oneShotImageUrl}
                  sold={soldSet.has(ONE_SHOT_SIG_ID)}
                  disabled
                  showToggle={false}
                  compact
                  onToggleSold={() => {}}
                />
              ) : null}
            />
          </section>
        ) : (
          <section className="rounded-xl border border-amber-300/50 bg-black/35 px-4 py-3 text-sm font-semibold text-amber-100">
            {memberFilterId ? "해당 멤버의 확정된 회전판 결과가 없습니다." : "아직 확정된 회전판 결과가 없습니다."}
          </section>
        )}
      </div>
    </main>
  );
}
