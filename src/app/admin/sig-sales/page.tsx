"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import confetti from "canvas-confetti";
import { Howl } from "howler";
import type { SigItem } from "@/types";
import RouletteWheel from "@/components/sig-sales/RouletteWheel";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import ConfirmationModal from "@/components/sig-sales/ConfirmationModal";
import RouletteHistoryModal from "@/components/sig-sales/RouletteHistoryModal";
import { loadStateFromApi, saveStateAsync, type AppState } from "@/lib/state";
import { ONE_SHOT_SIG_ID, SPIN_SOUND_PATHS, clampOverlayOpacity, cancelRouletteSession } from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";

const POLL_MS = 1000;
type HistoryItem = {
  id: string;
  sessionId: string;
  phase: "CONFIRMED" | "CANCELLED";
  selectedSigs: Array<{ id: string; name: string; price: number }>;
  oneShotPrice: number;
  totalPrice: number;
  timestamp: number;
  adminId?: string | null;
  reason?: string | null;
};
const buildOneShotFromSelected = (selected: SigItem[]) => ({
  id: ONE_SHOT_SIG_ID,
  name: "한방 시그",
  price: selected.reduce((sum, x) => sum + x.price, 0),
});

const PREVIEW_FILLER_POOL: SigItem[] = [
  { id: "preview_1", name: "애교", price: 77000, imageUrl: "/images/sigs/애교.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_2", name: "댄스", price: 100000, imageUrl: "/images/sigs/댄스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_3", name: "식사권", price: 333000, imageUrl: "/images/sigs/식사권.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_4", name: "보이스", price: 50000, imageUrl: "/images/sigs/보이스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_5", name: "노래", price: 120000, imageUrl: "/images/sigs/노래.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_6", name: "토크", price: 55000, imageUrl: "/images/sigs/토크.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_7", name: "하트", price: 30000, imageUrl: "/images/sigs/하트.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_8", name: "게임", price: 88000, imageUrl: "/images/sigs/게임.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_9", name: "보너스", price: 150000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_10", name: "특전", price: 220000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
];

export default function AdminSigSalesPage() {
  const [userId] = useState("finalent");
  const [state, setState] = useState<AppState | null>(null);
  const [loadingSpin, setLoadingSpin] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [manualSoldSet, setManualSoldSet] = useState<Set<string>>(new Set());
  const [oneShotSold, setOneShotSold] = useState(false);
  const [demoSpin, setDemoSpin] = useState<{ startedAt: number; resultId: string | null } | null>(null);
  const [pendingLanding, setPendingLanding] = useState<{ selected: SigItem[]; oneShot: { id: string; name: string; price: number } | null; resultId: string | null } | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [autoResetAfterConfirm, setAutoResetAfterConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [oneShotSound] = useState(() => new Howl({ src: [SPIN_SOUND_PATHS.oneShot], preload: true, volume: 0.7 }));
  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || "/images/sigs/stamp.png";
  const { machine, spin, landed, markConfirmPending, cancelConfirm, resetToIdle, finish, setOpacity, setError } = useSigSalesState(userId, state);
  const controlsDisabled = machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading;

  const loadRemote = useCallback(async () => {
    const remote = await loadStateFromApi(userId);
    if (remote) setState(remote);
  }, [userId]);

  useEffect(() => {
    void loadRemote();
    const id = window.setInterval(() => void loadRemote(), POLL_MS);
    return () => window.clearInterval(id);
  }, [loadRemote]);

  const loadHistory = useCallback(async (limit = 8) => {
    const res = await fetch(`/api/roulette/history?user=${encodeURIComponent(userId)}&limit=${limit}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { history?: HistoryItem[] };
    if (Array.isArray(data.history)) setHistory(data.history);
  }, [userId]);

  useEffect(() => {
    void loadHistory(8);
  }, [loadHistory]);

  useEffect(() => {
    oneShotSound.volume(volume);
    oneShotSound.mute(muted);
  }, [oneShotSound, volume, muted]);

  useEffect(() => {
    return () => {
      oneShotSound.unload();
    };
  }, [oneShotSound]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  useEffect(() => {
    if (machine.phase !== "CONFIRMED" || !autoResetAfterConfirm) return;
    const id = window.setTimeout(() => resetToIdle(), 5000);
    return () => window.clearTimeout(id);
  }, [machine.phase, autoResetAfterConfirm, resetToIdle]);

  const activeNormalPool = useMemo(() => {
    if (!state) return [];
    const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
    return (state.sigInventory || []).filter((x) => x.isActive && x.id !== ONE_SHOT_SIG_ID && !excluded.has(x.id));
  }, [state]);
  const wheelItems = useMemo(() => {
    const base = activeNormalPool.slice(0, 12);
    if (base.length >= 8) return base;
    const filler = PREVIEW_FILLER_POOL.filter((f) => !base.some((b) => b.name === f.name));
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
  const displaySelectedSigs = useMemo(() => machine.selectedSigs.slice(0, 5), [machine.selectedSigs]);
  const displayOneShot = useMemo(() => {
    if (!displaySelectedSigs.length) return null;
    return buildOneShotFromSelected(displaySelectedSigs);
  }, [displaySelectedSigs]);
  const oneShotImageUrl = useMemo(() => {
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    return oneShotItem?.imageUrl || "/images/sigs/dummy-sig.svg";
  }, [state?.sigInventory]);

  const onStartRoulette = useCallback(async () => {
    if (loadingSpin) return;
    if (machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading) {
      // 잠김 상태 복구: 시작 버튼은 무반응이 아닌 자동 복구 후 새 회차로 진입
      cancelConfirm();
      resetToIdle();
      setShowConfirmModal(false);
      setToast("이전 처리 상태를 복구하고 새 회차를 시작합니다.");
    }
    if (machine.phase === "CONFIRM_PENDING") {
      setToast("판매 확정 처리 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    if (machine.phase === "LANDED" || machine.phase === "CONFIRMED") {
      // 운영 중 멈춤 체감 방지를 위해 이전 회차를 자동 초기화하고 새 회차 시작
      resetToIdle();
    }
    if (activeNormalPool.length < 5) {
      // 운영 데이터가 부족할 때도 데모 스타일로 바로 테스트할 수 있게 fallback
      const shuffled = [...PREVIEW_FILLER_POOL].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 5);
      const resultId = selected[selected.length - 1]?.id || null;
      setPendingLanding({
        selected,
        oneShot: { id: ONE_SHOT_SIG_ID, name: "한방 시그", price: selected.reduce((sum, x) => sum + x.price, 0) },
        resultId,
      });
      setDemoSpin({ startedAt: Date.now(), resultId });
      setManualSoldSet(new Set());
      setOneShotSold(false);
      setShowConfirmModal(false);
      setToast("활성 시그 5개 미만이라 데모 회차로 실행했습니다.");
      confetti({ particleCount: 55, spread: 60, origin: { y: 0.25 } });
      return;
    }
    setLoadingSpin(true);
    try {
      const data = await spin();
      const selected = (data.selectedSigs || []).slice(0, 5);
      setPendingLanding({ selected, oneShot: data.oneShot, resultId: data.result?.id || null });
      confetti({ particleCount: 70, spread: 65, origin: { y: 0.25 } });
      setManualSoldSet(new Set());
      setOneShotSold(false);
      setShowConfirmModal(false);
    } catch {
      // API 장애가 있어도 현장 테스트를 계속할 수 있도록 데모 회차로 즉시 대체
      const shuffled = [...PREVIEW_FILLER_POOL].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, 5);
      const resultId = selected[selected.length - 1]?.id || null;
      setPendingLanding({
        selected,
        oneShot: { id: ONE_SHOT_SIG_ID, name: "한방 시그", price: selected.reduce((sum, x) => sum + x.price, 0) },
        resultId,
      });
      setDemoSpin({ startedAt: Date.now(), resultId });
      setManualSoldSet(new Set());
      setOneShotSold(false);
      setShowConfirmModal(false);
      setToast("서버 응답 실패로 데모 회차로 실행했습니다.");
    } finally {
      setLoadingSpin(false);
    }
  }, [loadingSpin, machine.phase, machine.isFinishLoading, activeNormalPool.length, spin, resetToIdle, cancelConfirm]);

  const persistRouletteState = useCallback(
    async (nextPartial: Partial<AppState["rouletteState"]>) => {
      if (!state) return;
      const next: AppState = {
        ...state,
        rouletteState: {
          ...state.rouletteState,
          ...nextPartial,
        },
      };
      setState(next);
      await saveStateAsync(next, userId);
    },
    [state, userId]
  );

  const onOpacityChange = useCallback(
    (raw: number) => {
      const value = clampOverlayOpacity(raw);
      setOpacity(value);
      void persistRouletteState({ overlayOpacity: value });
    },
    [setOpacity, persistRouletteState]
  );

  const onConfirmSale = useCallback(async () => {
    if (!state || displaySelectedSigs.length === 0) return;
    markConfirmPending();
    const selectedSet = new Set(displaySelectedSigs.map((x) => x.id));
    const nextInventory = state.sigInventory.map((item) => {
      if (manualSoldSet.has(item.id) || (oneShotSold && selectedSet.has(item.id))) {
        return { ...item, soldCount: 1, maxCount: 1 };
      }
      return item;
    });
    const next: AppState = {
      ...state,
      sigInventory: nextInventory,
      rouletteState: {
        ...state.rouletteState,
        phase: "CONFIRMED",
        lastFinishedAt: Date.now(),
      },
      updatedAt: Date.now(),
    };
    setState(next);
    await saveStateAsync(next, userId);
    try {
      const res = await finish({
        sessionId: machine.sessionId,
        selectedSigs: displaySelectedSigs,
        oneShotResult: displayOneShot,
        finalPhase: "CONFIRMED",
      });
      const asAny = res as { history?: HistoryItem[] };
      if (Array.isArray(asAny.history)) setHistory(asAny.history.slice(0, 8));
      setToast("판매 확정 완료!");
      confetti({ particleCount: 110, spread: 80, origin: { y: 0.22 } });
      setShowConfirmModal(false);
    } catch {
      setError("판매 확정 처리 실패");
      cancelConfirm();
      setToast("판매 확정 처리 실패");
    }
  }, [state, displaySelectedSigs, machine.sessionId, displayOneShot, manualSoldSet, oneShotSold, userId, finish, markConfirmPending, setError, cancelConfirm]);

  const onCancelConfirmedSession = useCallback(async () => {
    if (!machine.sessionId || machine.selectedSigs.length === 0) return;
    try {
      await cancelRouletteSession({
        userId,
        sessionId: machine.sessionId,
        selectedSigs: machine.selectedSigs,
        oneShotPrice: machine.oneShot?.price || 0,
        adminId: userId,
        reason: "admin_cancel_after_confirm",
      });
      await loadHistory(8);
      setToast("회차를 취소 처리했습니다.");
    } catch {
      setToast("취소 처리 실패");
    }
  }, [machine.sessionId, machine.selectedSigs, machine.oneShot, userId, loadHistory]);

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-[1280px] space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-yellow-200">시그 판매 회전판</h1>
            <p className="text-sm text-neutral-300">IDLE → SPINNING → LANDED → CONFIRM_PENDING → CONFIRMED 단일 플로우</p>
            <p className="mt-1 text-xs text-yellow-200/90">현재 상태: {machine.phase}</p>
          </div>
          <button
            type="button"
            onClick={() => void onStartRoulette()}
            disabled={loadingSpin}
            className="rounded bg-fuchsia-700 px-4 py-2 text-sm font-bold hover:bg-fuchsia-600 disabled:opacity-50"
          >
            {loadingSpin ? "추첨 준비중..." : "회전판 시작"}
          </button>
        </header>

        <section className="rounded-xl border border-white/10 bg-black/35 p-3">
          <label className="flex items-center gap-3 text-sm text-neutral-200">
            배경 투명도 ({Math.round(machine.overlayOpacity * 100)}%)
            <input
              type="range"
              min={40}
              max={100}
              value={Math.round(machine.overlayOpacity * 100)}
              onChange={(e) => onOpacityChange(Number(e.target.value) / 100)}
              disabled={controlsDisabled}
              className="w-72"
            />
          </label>
          <label className="ml-4 inline-flex items-center gap-2 text-sm text-neutral-200">
            볼륨
            <input disabled={controlsDisabled} type="range" min={0} max={100} value={Math.round(volume * 100)} onChange={(e) => setVolume(Number(e.target.value) / 100)} />
          </label>
          <label className="ml-3 inline-flex items-center gap-2 text-sm text-neutral-200">
            <input disabled={controlsDisabled} type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
            음소거
          </label>
          <label className="ml-3 inline-flex items-center gap-2 text-sm text-neutral-200">
            <input type="checkbox" checked={autoResetAfterConfirm} onChange={(e) => setAutoResetAfterConfirm(e.target.checked)} />
            5초 후 자동 초기화
          </label>
        </section>

        <section style={{ backgroundColor: "transparent" }} className="relative rounded-2xl border border-yellow-200/20 p-4">
          <RouletteWheel
            items={wheelItemsWithResult}
            isRolling={Boolean(demoSpin) || machine.isRolling || machine.phase === "SPINNING"}
            resultId={demoSpin?.resultId || machine.resultId}
            startedAt={demoSpin?.startedAt || machine.startedAt}
            volume={volume}
            muted={muted}
            onLanded={() => {
              if (!pendingLanding) return;
              const selected = pendingLanding.selected.slice(0, 5);
              const oneShot = buildOneShotFromSelected(selected);
              landed(selected, oneShot, pendingLanding.resultId || selected[selected.length - 1]?.id || null);
              oneShotSound.stop();
              oneShotSound.play();
              setDemoSpin(null);
              setPendingLanding(null);
              void persistRouletteState({
                phase: "LANDED",
                isRolling: false,
                selectedSigs: selected,
                oneShotResult: oneShot,
              });
            }}
          />

          {machine.phase === "CONFIRM_PENDING" ? (
            <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-black/55">
              <div className="rounded-xl border border-yellow-300/50 bg-neutral-900/90 px-6 py-4 text-center">
                <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-yellow-300 border-t-transparent" />
                <p className="mt-2 text-sm font-semibold text-yellow-100">판매 확정 처리 중...</p>
                <div className="mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full w-full animate-pulse bg-gradient-to-r from-amber-300 to-yellow-500" />
                </div>
              </div>
            </div>
          ) : null}

          {(machine.phase === "LANDED" || machine.phase === "CONFIRM_PENDING" || machine.phase === "CONFIRMED") && displaySelectedSigs.length > 0 ? (
            <div className="mt-4 space-y-4">
              <SelectedSigs
                items={displaySelectedSigs}
                soldOutStampUrl={soldOutStampUrl}
                manualSoldSet={manualSoldSet}
                disabled={controlsDisabled}
                trailingSlot={
                  <OneShotSigCard
                    name={displayOneShot?.name || "한방 시그"}
                    price={displayOneShot?.price || 0}
                    imageUrl={oneShotImageUrl}
                    sold={oneShotSold}
                    disabled={controlsDisabled}
                    compact
                    onToggleSold={() => setOneShotSold((v) => !v)}
                  />
                }
                onToggleSold={(id) =>
                  setManualSoldSet((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
              />
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
            </div>
          ) : null}

          {machine.phase === "CONFIRMED" ? (
            <div className="mt-4 rounded-xl border border-emerald-300/60 bg-emerald-900/30 p-4 text-center">
              <p className="text-2xl font-black text-emerald-200">판매 확정 완료!</p>
              <p className="mt-1 text-sm text-emerald-100">
                {displaySelectedSigs.map((s) => s.name).join(", ")} + {displayOneShot?.name || "한방 시그"}
              </p>
              <button type="button" onClick={resetToIdle} className="mt-3 rounded bg-emerald-500 px-4 py-1.5 text-sm font-bold text-black">
                새로운 회차 시작
              </button>
              <button type="button" onClick={() => void onCancelConfirmedSession()} className="ml-2 mt-3 rounded bg-rose-700 px-4 py-1.5 text-sm font-bold text-white">
                취소하기
              </button>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-white/10 bg-black/35 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-neutral-200">판매 이력</h2>
            <button type="button" className="rounded border border-white/20 px-2 py-1 text-xs" onClick={() => setHistoryOpen((v) => !v)}>
              {historyOpen ? "접기" : "펼치기"}
            </button>
          </div>
          {historyOpen ? (
            <div className="mt-2 space-y-2">
              {history.length === 0 ? <p className="text-xs text-neutral-400">아직 확정 이력이 없습니다.</p> : null}
              {history.slice(0, 8).map((h) => (
                <button
                  type="button"
                  key={h.id}
                  onClick={() => {
                    setSelectedHistory(h);
                    setShowHistoryModal(true);
                  }}
                  className={`w-full rounded border px-3 py-2 text-left text-xs ${h.phase === "CONFIRMED" ? "border-emerald-500/35 bg-emerald-950/20 text-neutral-100" : "border-rose-500/35 bg-rose-950/20 text-neutral-100"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>세션: {h.sessionId}</span>
                    <span className={`rounded px-1.5 py-0.5 ${h.phase === "CONFIRMED" ? "bg-emerald-700/70" : "bg-rose-700/70"}`}>{h.phase}</span>
                  </div>
                  <div className="mt-1 text-neutral-300">
                    {new Date(h.timestamp).toLocaleString("ko-KR")} · 총액 {h.totalPrice.toLocaleString("ko-KR")}원
                  </div>
                </button>
              ))}
              <button type="button" className="mt-1 rounded bg-white/10 px-2 py-1 text-xs" onClick={() => void loadHistory(20)}>
                전체 이력 보기
              </button>
            </div>
          ) : null}
        </section>
      </div>
      <ConfirmationModal
        open={showConfirmModal && machine.phase !== "CONFIRMED"}
        loading={machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading}
        onCancel={() => {
          setShowConfirmModal(false);
          cancelConfirm();
        }}
        onConfirm={() => void onConfirmSale()}
      />
      <RouletteHistoryModal
        open={showHistoryModal}
        item={selectedHistory}
        onClose={() => setShowHistoryModal(false)}
        onLoadReadonly={(payload) => {
          landed(payload.selectedSigs, payload.oneShot, payload.selectedSigs[payload.selectedSigs.length - 1]?.id || null);
          setShowHistoryModal(false);
          setToast("이력 회차를 읽기 전용으로 불러왔습니다.");
        }}
      />
      {toast ? <div className="fixed bottom-5 left-1/2 z-[120] -translate-x-1/2 rounded bg-black/80 px-4 py-2 text-sm text-white">{toast}</div> : null}
    </main>
  );
}
