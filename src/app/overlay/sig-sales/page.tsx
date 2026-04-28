"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Howl } from "howler";
import type { SigItem } from "@/types";
import RouletteWheel from "@/components/sig-sales/RouletteWheel";
import { loadStateFromApi, type AppState } from "@/lib/state";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { ONE_SHOT_SIG_ID, SOUND_ASSETS_ENABLED, SPIN_SOUND_PATHS } from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";

const POLL_MS = 1000;
const STEP_CONFIRM_PAUSE_MS = 3000;
const ROULETTE_VISIBLE_SLOTS = 10;
const CONFIRMED_VISIBLE_SLOTS = 5;
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
  const userId = getOverlayUserIdFromSearchParams(sp);
  const memberIdParam = (sp.get("memberId") || sp.get("member") || "").trim();
  const memberFilterId = memberIdParam.length > 0 ? memberIdParam : "";
  const rouletteDemo = sp.get("rouletteDemo") === "1" || sp.get("rouletteDemo") === "true";
  const [state, setState] = useState<AppState | null>(null);
  const [pendingLanding, setPendingLanding] = useState<{ selected: SigItem[]; oneShot: { id: string; name: string; price: number } | null; resultId: string | null; persist: boolean } | null>(null);
  const [demoSpin, setDemoSpin] = useState<{ startedAt: number; resultId: string | null } | null>(null);
  const [stagedSelected, setStagedSelected] = useState<SigItem[]>([]);
  const [spinStep, setSpinStep] = useState(0);
  const [lastConfirmedText, setLastConfirmedText] = useState("");
  const [lastConfirmedFxKey, setLastConfirmedFxKey] = useState(0);
  const nextSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasOneShotSoundErrorRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playFallbackOneShot = useCallback(() => {
    if (typeof window === "undefined") return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
    const ctx = audioCtxRef.current;
    const tones: Array<[number, number]> = [
      [900, 0.11],
      [1200, 0.14],
    ];
    tones.forEach(([freq, sec], idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.value = 0.04;
      osc.connect(g);
      g.connect(ctx.destination);
      const at = ctx.currentTime + idx * 0.1;
      osc.start(at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + sec);
      osc.stop(at + sec);
    });
  }, []);
  const [oneShotSound] = useState(() =>
    SOUND_ASSETS_ENABLED
      ? new Howl({
          src: [SPIN_SOUND_PATHS.oneShot],
          preload: true,
          volume: 0.7,
          mute: false,
          onloaderror: () => {
            hasOneShotSoundErrorRef.current = true;
          },
          onplayerror: () => {
            hasOneShotSoundErrorRef.current = true;
          },
        })
      : null
  );
  const { machine, landed, markConfirmPending, cancelConfirm, resetToIdle, finish, setError } = useSigSalesState(userId, state);

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
    return () => {
      oneShotSound?.unload();
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
    };
  }, [oneShotSound]);

  // 결과 배치는 운영자가 reset 할 때까지 유지한다.

  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || "/images/sigs/dummy-sig.svg";
  const activeNormalPool = useMemo(() => {
    if (rouletteDemo) return DEMO_POOL;
    if (!state) return [];
    const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
    return (state.sigInventory || []).filter(
      (x) =>
        x.isActive &&
        x.id !== ONE_SHOT_SIG_ID &&
        !excluded.has(x.id) &&
        (!memberFilterId || (x.memberId || "") === memberFilterId)
    );
  }, [state, rouletteDemo, memberFilterId]);
  const wheelItems = useMemo(() => {
    const base = activeNormalPool.slice(0, ROULETTE_VISIBLE_SLOTS);
    if (base.length >= ROULETTE_VISIBLE_SLOTS) return base;
    const filler = DEMO_POOL.filter((f) => !base.some((b) => b.name === f.name));
    return [...base, ...filler].slice(0, ROULETTE_VISIBLE_SLOTS);
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
    if (stagedSelected.length > 0) return stagedSelected.slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (machine.selectedSigs.length > 0) return machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (rouletteDemo && pendingLanding?.selected?.length) return pendingLanding.selected.slice(0, CONFIRMED_VISIBLE_SLOTS);
    return [];
  }, [machine.selectedSigs, rouletteDemo, pendingLanding, stagedSelected]);
  const displayOneShot = useMemo(() => {
    if (displaySelectedSigs.length < CONFIRMED_VISIBLE_SLOTS) return null;
    return buildOneShotFromSelected(displaySelectedSigs);
  }, [displaySelectedSigs]);
  const displayResultId = useMemo(() => {
    if (displaySelectedSigs.length === 0) return null;
    return (demoSpin?.resultId || machine.resultId || displaySelectedSigs[displaySelectedSigs.length - 1]?.id || null) as string | null;
  }, [displaySelectedSigs, demoSpin?.resultId, machine.resultId]);

  useEffect(() => {
    return () => {
      if (nextSpinTimerRef.current) {
        clearTimeout(nextSpinTimerRef.current);
        nextSpinTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!lastConfirmedText) return;
    const id = window.setTimeout(() => setLastConfirmedText(""), 3000);
    return () => window.clearTimeout(id);
  }, [lastConfirmedText]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[1280px] space-y-4">

        <section style={{ backgroundColor: "transparent" }} className="relative p-0">
          {lastConfirmedText ? (
            <div
              key={`confirmed-fx-${lastConfirmedFxKey}`}
              className="pointer-events-none absolute left-4 top-1/2 z-40 -translate-y-1/2 rounded-2xl border border-fuchsia-300/80 bg-fuchsia-500/25 px-5 py-3 text-3xl font-black text-fuchsia-100 shadow-[0_0_26px_rgba(217,70,239,0.6)] animate-pulse"
            >
              {lastConfirmedText}
            </div>
          ) : null}
          <RouletteWheel
            items={wheelItemsWithResult}
            isRolling={Boolean(demoSpin) || machine.isRolling || machine.phase === "SPINNING"}
            resultId={displayResultId}
            startedAt={demoSpin?.startedAt || machine.startedAt}
            volume={0.7}
            muted={false}
            onLanded={(landedId) => {
              if (!pendingLanding) return;
              const selectedQueue = pendingLanding.selected.slice(0, CONFIRMED_VISIBLE_SLOTS);
              if (selectedQueue.length === 0) return;
              const byResult = landedId ? selectedQueue.find((x) => x.id === landedId) : null;
              const fallback = selectedQueue[Math.min(spinStep, selectedQueue.length - 1)];
              const current = byResult || fallback;
              if (!current) return;
              const nextSelected = [...stagedSelected, current].filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx);
              const nextStep = spinStep + 1;
              setLastConfirmedText(`${current.name} 확정!`);
              setLastConfirmedFxKey((v) => v + 1);

              if (nextStep < selectedQueue.length) {
                setStagedSelected(nextSelected);
                setSpinStep(nextStep);
                if (nextSpinTimerRef.current) clearTimeout(nextSpinTimerRef.current);
                nextSpinTimerRef.current = setTimeout(() => {
                  setLastConfirmedText("");
                  setDemoSpin({ startedAt: Date.now(), resultId: selectedQueue[nextStep].id });
                }, STEP_CONFIRM_PAUSE_MS);
                return;
              }

              const oneShot = buildOneShotFromSelected(nextSelected);
              landed(nextSelected, oneShot, pendingLanding.resultId || current.id);
              if (oneShotSound && !hasOneShotSoundErrorRef.current) {
                oneShotSound.stop();
                oneShotSound.play();
              } else {
                playFallbackOneShot();
              }
              setStagedSelected(nextSelected);
              setSpinStep(0);
              setDemoSpin(null);
              setPendingLanding(null);
              if (!pendingLanding.persist) return;
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
    </main>
  );
}
