"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Howl } from "howler";
import confetti from "canvas-confetti";
import type { SigItem } from "@/types";
import RouletteWheel from "@/components/sig-sales/RouletteWheel";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import ConfirmationModal from "@/components/sig-sales/ConfirmationModal";
import { loadStateFromApi, saveStateAsync, type AppState } from "@/lib/state";
import { ONE_SHOT_SIG_ID, SOUND_ASSETS_ENABLED, SPIN_SOUND_PATHS, clampOverlayOpacity } from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";

const POLL_MS = 1000;
const STEP_CONFIRM_PAUSE_MS = 1800;
const DEMO_POOL = [
  { id: "demo_1", name: "애교", price: 77000, imageUrl: "/images/sigs/애교.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_2", name: "댄스", price: 100000, imageUrl: "/images/sigs/댄스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_3", name: "식사권", price: 333000, imageUrl: "/images/sigs/식사권.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_4", name: "보이스", price: 50000, imageUrl: "/images/sigs/보이스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_5", name: "노래", price: 120000, imageUrl: "/images/sigs/노래.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_6", name: "토크", price: 55000, imageUrl: "/images/sigs/토크.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_7", name: "하트", price: 30000, imageUrl: "/images/sigs/하트.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_8", name: "게임", price: 88000, imageUrl: "/images/sigs/게임.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_9", name: "보너스", price: 150000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_10", name: "특전", price: 220000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
];
const buildOneShotFromSelected = (selected: SigItem[]) => ({
  id: ONE_SHOT_SIG_ID,
  name: "한방 시그",
  price: selected.reduce((sum, x) => sum + x.price, 0),
});

export default function SigSalesOverlayPage() {
  const sp = useSearchParams();
  const userId = sp.get("u") || "finalent";
  const rouletteDemo = sp.get("rouletteDemo") === "1" || sp.get("rouletteDemo") === "true";
  const [state, setState] = useState<AppState | null>(null);
  const [manualSoldSet, setManualSoldSet] = useState<Set<string>>(new Set());
  const [oneShotSold, setOneShotSold] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingLanding, setPendingLanding] = useState<{ selected: SigItem[]; oneShot: { id: string; name: string; price: number } | null; resultId: string | null; persist: boolean } | null>(null);
  const [demoSpin, setDemoSpin] = useState<{ startedAt: number; resultId: string | null } | null>(null);
  const [stagedSelected, setStagedSelected] = useState<SigItem[]>([]);
  const [spinStep, setSpinStep] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const nextSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [oneShotSound] = useState(() =>
    SOUND_ASSETS_ENABLED ? new Howl({ src: [SPIN_SOUND_PATHS.oneShot], preload: true, volume: 0.7, mute: false }) : null
  );
  const { machine, spin, landed, markConfirmPending, cancelConfirm, resetToIdle, finish, setOpacity, setError } = useSigSalesState(userId, state);
  const controlsDisabled = machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading;

  const loadRemote = useCallback(async () => {
    if (rouletteDemo) return;
    const remote = await loadStateFromApi(userId);
    if (remote) setState(remote);
  }, [rouletteDemo, userId]);

  useEffect(() => {
    if (rouletteDemo) return;
    void loadRemote();
    const id = window.setInterval(() => void loadRemote(), POLL_MS);
    return () => window.clearInterval(id);
  }, [rouletteDemo, loadRemote]);

  useEffect(() => {
    if (!oneShotSound) return;
    oneShotSound.volume(volume);
    oneShotSound.mute(muted);
  }, [oneShotSound, volume, muted]);

  useEffect(() => {
    return () => {
      oneShotSound?.unload();
    };
  }, [oneShotSound]);

  // 결과 배치는 운영자가 reset 할 때까지 유지한다.

  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || "/images/sigs/dummy-sig.svg";
  const activeNormalPool = useMemo(() => {
    if (rouletteDemo) return DEMO_POOL;
    if (!state) return [];
    const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
    return (state.sigInventory || []).filter((x) => x.isActive && x.id !== ONE_SHOT_SIG_ID && !excluded.has(x.id));
  }, [state, rouletteDemo]);
  const wheelItems = useMemo(() => {
    const base = activeNormalPool.slice(0, 12);
    if (base.length >= 8) return base;
    const filler = DEMO_POOL.filter((f) => !base.some((b) => b.name === f.name));
    return [...base, ...filler].slice(0, 10);
  }, [activeNormalPool]);
  const wheelItemsWithResult = useMemo(() => {
    const resultId = demoSpin?.resultId || machine.resultId;
    if (!resultId) return wheelItems;
    if (wheelItems.some((item) => item.id === resultId)) return wheelItems;
    const found = activeNormalPool.find((item) => item.id === resultId);
    if (!found) return wheelItems;
    if (!wheelItems.length) return [found];
    return [...wheelItems.slice(0, Math.max(0, wheelItems.length - 1)), found];
  }, [wheelItems, demoSpin?.resultId, machine.resultId, activeNormalPool]);
  const displaySelectedSigs = useMemo(() => {
    if (stagedSelected.length > 0) return stagedSelected.slice(0, 5);
    if (machine.selectedSigs.length > 0) return machine.selectedSigs.slice(0, 5);
    if (rouletteDemo && pendingLanding?.selected?.length) return pendingLanding.selected.slice(0, 5);
    return [];
  }, [machine.selectedSigs, rouletteDemo, pendingLanding, stagedSelected]);
  const displayOneShot = useMemo(() => {
    if (displaySelectedSigs.length < 5) return null;
    return buildOneShotFromSelected(displaySelectedSigs);
  }, [displaySelectedSigs]);
  const displayResultId = useMemo(() => {
    if (displaySelectedSigs.length === 0) return null;
    return (demoSpin?.resultId || machine.resultId || displaySelectedSigs[displaySelectedSigs.length - 1]?.id || null) as string | null;
  }, [displaySelectedSigs, demoSpin?.resultId, machine.resultId]);

  const finalDisplaySelected = displaySelectedSigs;
  const finalDisplayOneShot = displayOneShot;
  const oneShotImageUrl = useMemo(() => {
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    return oneShotItem?.imageUrl || "/images/sigs/dummy-sig.svg";
  }, [state?.sigInventory]);

  useEffect(() => {
    if (machine.phase !== "IDLE") return;
    if (nextSpinTimerRef.current) {
      clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = null;
    }
    setStagedSelected([]);
    setSpinStep(0);
    setHighlightId(null);
    setPendingLanding(null);
    setDemoSpin(null);
  }, [machine.phase]);

  useEffect(() => {
    return () => {
      if (nextSpinTimerRef.current) {
        clearTimeout(nextSpinTimerRef.current);
        nextSpinTimerRef.current = null;
      }
    };
  }, []);

  const onStartRoulette = useCallback(async () => {
    if (controlsDisabled) return;
    if (!rouletteDemo && machine.phase === "LANDED") return;
    if (rouletteDemo) {
      // 데모는 Confirm 단계 없이 반복 재생 가능해야 하므로 매 회차 초기화
      resetToIdle();
      const shuffled = [...DEMO_POOL].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 5);
      const resultId = selected[selected.length - 1]?.id || null;
      setPendingLanding({
        selected,
        oneShot: { id: ONE_SHOT_SIG_ID, name: "한방 시그", price: selected.reduce((sum, x) => sum + x.price, 0) },
        resultId,
        persist: false,
      });
      setDemoSpin({ startedAt: Date.now(), resultId: selected[0]?.id || resultId });
      setSpinStep(0);
      setStagedSelected([]);
      setHighlightId(null);
      confetti({ particleCount: 60, spread: 70, origin: { y: 0.2 } });
      return;
    }
    try {
      const data = await spin();
      const selected = (data.selectedSigs || []).slice(0, 5);
      const oneShot = buildOneShotFromSelected(selected);
      setPendingLanding({ selected, oneShot, resultId: data.result?.id || selected[selected.length - 1]?.id || null, persist: true });
      setDemoSpin({ startedAt: Date.now(), resultId: selected[0]?.id || null });
      setSpinStep(0);
      setStagedSelected([]);
      setHighlightId(null);
      confetti({ particleCount: 75, spread: 66, origin: { y: 0.23 } });
      setManualSoldSet(new Set());
      setOneShotSold(false);
    } catch {
      setError("회전판 시작 실패");
    }
  }, [rouletteDemo, controlsDisabled, machine.phase, spin, setError, resetToIdle]);

  const persistRouletteState = useCallback(
    async (nextPartial: Partial<AppState["rouletteState"]>) => {
      if (!state || rouletteDemo) return;
      const next: AppState = { ...state, rouletteState: { ...state.rouletteState, ...nextPartial }, updatedAt: Date.now() };
      setState(next);
      await saveStateAsync(next, userId);
    },
    [state, rouletteDemo, userId]
  );

  const onConfirmSale = useCallback(async () => {
    if (rouletteDemo || !state || machine.selectedSigs.length === 0) return;
    markConfirmPending();
    const selectedSet = new Set(machine.selectedSigs.map((x) => x.id));
    const nextInventory = state.sigInventory.map((item) => {
      if (manualSoldSet.has(item.id) || (oneShotSold && selectedSet.has(item.id))) return { ...item, soldCount: 1 };
      return item;
    });
    const next: AppState = {
      ...state,
      sigInventory: nextInventory,
      rouletteState: { ...state.rouletteState, phase: "CONFIRMED", lastFinishedAt: Date.now() },
      updatedAt: Date.now(),
    };
    setState(next);
    await saveStateAsync(next, userId);
    try {
      await finish({
        sessionId: machine.sessionId,
        selectedSigs: machine.selectedSigs,
        oneShotResult: machine.oneShot,
        finalPhase: "CONFIRMED",
      });
      confetti({ particleCount: 100, spread: 85, origin: { y: 0.2 } });
      setShowConfirmModal(false);
    } catch {
      cancelConfirm();
      setError("판매 확정 처리 실패");
    }
  }, [rouletteDemo, state, machine.selectedSigs, machine.sessionId, machine.oneShot, manualSoldSet, oneShotSold, userId, finish, markConfirmPending, cancelConfirm, setError]);

  return (
    <main className="min-h-screen bg-neutral-950/70 p-4 text-white">
      <div className="mx-auto max-w-[1280px] space-y-4">
        <header className="p-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-black text-yellow-200">시그 판매 회전판</h1>
            <button
              type="button"
              onClick={() => void onStartRoulette()}
              disabled={
                activeNormalPool.length < 5 ||
                controlsDisabled ||
                (!rouletteDemo && (machine.phase === "LANDED" || machine.phase === "CONFIRMED"))
              }
              className="rounded bg-fuchsia-700 px-4 py-2 text-sm font-bold hover:bg-fuchsia-600 disabled:opacity-50"
            >
              회전판 시작
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              배경 투명도
              <input
                type="range"
                min={40}
                max={100}
                value={Math.round(machine.overlayOpacity * 100)}
              disabled={controlsDisabled}
                onChange={(e) => {
                  const v = Number(e.target.value) / 100;
                  setOpacity(v);
                  void persistRouletteState({ overlayOpacity: clampOverlayOpacity(v) });
                }}
              />
            </label>
            <label className="flex items-center gap-2">
              볼륨
              <input disabled={controlsDisabled} type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} />
            </label>
            <label className="flex items-center gap-2">
              <input disabled={controlsDisabled} type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
              음소거
            </label>
            <span className="px-2 py-1 text-xs text-white/70">현재 상태: {machine.phase}</span>
          </div>
        </header>

        <section style={{ backgroundColor: "transparent" }} className="relative p-0">
          <RouletteWheel
            items={wheelItemsWithResult}
            isRolling={Boolean(demoSpin) || machine.isRolling || machine.phase === "SPINNING"}
            resultId={displayResultId}
            startedAt={demoSpin?.startedAt || machine.startedAt}
            volume={volume}
            muted={muted}
            onLanded={() => {
              if (!pendingLanding) return;
              const selectedQueue = pendingLanding.selected.slice(0, 5);
              if (selectedQueue.length === 0) return;
              const current = selectedQueue[Math.min(spinStep, selectedQueue.length - 1)];
              const nextSelected = [...stagedSelected, current];
              const nextStep = spinStep + 1;
              setHighlightId(current.id);

              if (nextStep < selectedQueue.length) {
                setStagedSelected(nextSelected);
                setSpinStep(nextStep);
                if (nextSpinTimerRef.current) clearTimeout(nextSpinTimerRef.current);
                nextSpinTimerRef.current = setTimeout(() => {
                  setDemoSpin({ startedAt: Date.now(), resultId: selectedQueue[nextStep].id });
                }, STEP_CONFIRM_PAUSE_MS);
                return;
              }

              const oneShot = buildOneShotFromSelected(nextSelected);
              landed(nextSelected, oneShot, pendingLanding.resultId || current.id);
              oneShotSound?.stop();
              oneShotSound?.play();
              setStagedSelected(nextSelected);
              setSpinStep(0);
              setDemoSpin(null);
              setPendingLanding(null);
              if (!pendingLanding.persist) return;
              void persistRouletteState({
                phase: "LANDED",
                isRolling: false,
                selectedSigs: nextSelected,
                oneShotResult: oneShot,
              });
            }}
          />
          {machine.phase === "CONFIRM_PENDING" ? (
            <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-black/55">
              <div className="rounded-xl border border-yellow-300/50 bg-neutral-900/90 px-6 py-4 text-center">
                <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-yellow-300 border-t-transparent" />
                <p className="mt-2 text-sm font-semibold text-yellow-100">판매 확정 처리 중...</p>
              </div>
            </div>
          ) : null}

          {(machine.phase === "SPINNING" || machine.phase === "LANDED" || machine.phase === "CONFIRM_PENDING" || machine.phase === "CONFIRMED" || stagedSelected.length > 0) &&
          finalDisplaySelected.length > 0 ? (
            <div className="mt-4 space-y-4">
              {rouletteDemo ? <p className="text-xs font-semibold text-fuchsia-200/90">데모 당첨 배치 미리보기</p> : null}
              <SelectedSigs
                items={finalDisplaySelected}
                soldOutStampUrl={soldOutStampUrl}
                manualSoldSet={manualSoldSet}
                disabled={controlsDisabled}
                highlightId={highlightId}
                trailingSlot={finalDisplayOneShot ? (
                  <OneShotSigCard
                    name={finalDisplayOneShot?.name || "한방 시그"}
                    price={finalDisplayOneShot?.price || 0}
                    imageUrl={oneShotImageUrl}
                    sold={oneShotSold}
                    disabled={controlsDisabled}
                    compact
                    onToggleSold={() => setOneShotSold((v) => !v)}
                  />
                ) : null}
                onToggleSold={(id) =>
                  setManualSoldSet((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
              {!rouletteDemo ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={controlsDisabled || machine.phase === "CONFIRMED"}
                    onClick={() => setShowConfirmModal(true)}
                    className="rounded bg-emerald-600 px-4 py-2 text-sm font-bold hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {machine.phase === "CONFIRM_PENDING" ? "처리 중..." : "Confirm Sale (수동 확정)"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {machine.phase === "CONFIRMED" ? (
            <div className="mt-4 rounded-xl border border-emerald-300/60 bg-emerald-900/30 p-4 text-center">
              <p className="text-2xl font-black text-emerald-200">판매 확정 완료!</p>
              <p className="mt-1 text-sm text-emerald-100">
                {machine.selectedSigs.map((s) => s.name).join(", ")} + {machine.oneShot?.name || "한방 시그"}
              </p>
              <button type="button" onClick={resetToIdle} className="mt-3 rounded bg-emerald-500 px-4 py-1.5 text-sm font-bold text-black">
                새로운 회차 시작
              </button>
            </div>
          ) : null}
        </section>
      </div>
      <ConfirmationModal
        open={showConfirmModal && machine.phase !== "CONFIRMED" && !rouletteDemo}
        loading={machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading}
        onCancel={() => {
          setShowConfirmModal(false);
          cancelConfirm();
        }}
        onConfirm={() => void onConfirmSale()}
      />
    </main>
  );
}
