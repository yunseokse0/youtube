"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import confetti from "canvas-confetti";
import { Howl } from "howler";
import type { SigItem } from "@/types";
import RouletteWheel from "@/components/sig-sales/RouletteWheel";
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import ConfirmationModal from "@/components/sig-sales/ConfirmationModal";
import RouletteHistoryModal from "@/components/sig-sales/RouletteHistoryModal";
import {
  BUNDLED_SIG_PLACEHOLDER_URL,
  DEFAULT_SIG_SOLD_STAMP_URL,
  resolveSigAdminPreviewSrc,
} from "@/lib/constants";
import { loadState, loadStateFromApi, saveStateAsync, storageKey, type AppState } from "@/lib/state";
import { useSSEConnection } from "@/lib/sse-client";
import { createStateUpdatedScheduler, readOverlayPollIntervalMs } from "@/lib/overlay-pull-policy";
import {
  ONE_SHOT_SIG_ID,
  SPIN_SOUND_PATHS,
  clampOverlayOpacity,
  cancelRouletteSession,
  buildSigSalesWheelDisplayPool,
  buildWheelMenuSlices,
  clampSigSalesMenuCount,
  canonicalSigIdFromWheelSliceId,
  hydrateSigItemFromInventory,
  resolveWheelSpinTarget,
  wheelSliceMatchesServerWinner,
} from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";
import {
  detectSigPriceFromImageUrlDetailed,
  prewarmSigOcrWorker,
  terminateSharedSigOcrWorker,
} from "@/lib/sig-image-ocr";
import { dedupeSigInventory } from "@/lib/sig-inventory-dedup";

const STEP_CONFIRM_PAUSE_MS = 3000;
const MAX_SELECTED_SIGS = 20;
const MIN_ONE_SHOT_SIGS = 2;
type HistoryItem = {
  id: string;
  sessionId: string;
  phase: "LANDED" | "CONFIRMED" | "CANCELLED";
  selectedSigs: Array<{ id: string; name: string; price: number }>;
  oneShotPrice: number;
  totalPrice: number;
  timestamp: number;
  adminId?: string | null;
  reason?: string | null;
};
const buildOneShotFromSelected = (selected: SigItem[]) => {
  if (selected.length < MIN_ONE_SHOT_SIGS) return null;
  return {
    id: ONE_SHOT_SIG_ID,
    name: "한방 시그",
    price: selected.reduce((sum, x) => sum + x.price, 0),
  };
};

const PREVIEW_FILLER_POOL: SigItem[] = [
  { id: "preview_1", name: "애교", price: 77000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_2", name: "댄스", price: 100000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_3", name: "식사권", price: 333000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_4", name: "보이스", price: 50000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_5", name: "노래", price: 120000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_6", name: "토크", price: 55000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_7", name: "하트", price: 30000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_8", name: "게임", price: 88000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_9", name: "보너스", price: 150000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "preview_10", name: "특전", price: 220000, imageUrl: BUNDLED_SIG_PLACEHOLDER_URL, maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
];

export default function AdminSigSalesPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; companyName: string; name?: string; remainingDays?: number | null; unlimited?: boolean } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const userId = user?.id || "finalent";
  const [memberFilterId, setMemberFilterId] = useState("");
  /** /api/roulette/spin cinematic5 전용: 본문 spinCount(1~20). 미보내면 서버는 최대 5·풀만 사용 */
  const [cinematicSpinCount, setCinematicSpinCount] = useState(5);
  const [state, setState] = useState<AppState | null>(null);
  const [loadingSpin, setLoadingSpin] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryItem | null>(null);
  const [manualSoldSet, setManualSoldSet] = useState<Set<string>>(new Set());
  const [oneShotSold, setOneShotSold] = useState(false);
  const [demoSpin, setDemoSpin] = useState<{ startedAt: number; resultId: string | null } | null>(null);
  const [pendingLanding, setPendingLanding] = useState<{ selected: SigItem[]; oneShot: { id: string; name: string; price: number } | null; resultId: string | null; persist: boolean } | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [autoResetAfterConfirm, setAutoResetAfterConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stagedSelected, setStagedSelected] = useState<SigItem[]>([]);
  const [spinStep, setSpinStep] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lastConfirmedText, setLastConfirmedText] = useState("");
  const [lastConfirmedFxKey, setLastConfirmedFxKey] = useState(0);
  const [oneShotReveal, setOneShotReveal] = useState(false);
  const [ocrBusyIds, setOcrBusyIds] = useState<Record<string, boolean>>({});
  const [ocrAllBusy, setOcrAllBusy] = useState(false);
  const [ocrBatchProgress, setOcrBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [sigSalesSigRowOpen, setSigSalesSigRowOpen] = useState<Record<string, boolean>>({});
  const [resultsPanelCollapsed, setResultsPanelCollapsed] = useState(false);
  const nextSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [oneShotSound] = useState(() => new Howl({ src: [SPIN_SOUND_PATHS.oneShot], preload: true, volume: 0.7 }));
  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || DEFAULT_SIG_SOLD_STAMP_URL;
  const { machine, spin, landed, markConfirmPending, cancelConfirm, resetToIdle, finish, setOpacity, setError } = useSigSalesState(userId, state);
  const controlsDisabled = !authReady || machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading;

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.user?.id) {
          setUser(data.user);
        } else {
          router.replace("/login");
        }
      })
      .finally(() => setAuthReady(true));
  }, [router]);

  const loadRemote = useCallback(async () => {
    if (!authReady) return;
    const remote = await loadStateFromApi(userId);
    if (remote) setState(remote);
  }, [authReady, userId]);

  const loadRemoteRef = useRef(loadRemote);
  loadRemoteRef.current = loadRemote;
  const scheduleSseLoadRef = useRef<(() => void) | null>(null);
  useSSEConnection((d: unknown) => {
    const o = d as { type?: string };
    if (o?.type === "state_updated") scheduleSseLoadRef.current?.();
  });

  useEffect(() => {
    if (!authReady) {
      scheduleSseLoadRef.current = null;
      return;
    }
    const { schedule, cancel } = createStateUpdatedScheduler(() => {
      void loadRemoteRef.current();
    });
    scheduleSseLoadRef.current = schedule;
    setState(loadState(userId));
    void loadRemote();
    const pollMs = readOverlayPollIntervalMs();
    let pollId: number | undefined;
    if (pollMs > 0) {
      pollId = window.setInterval(() => void loadRemote(), pollMs);
    }
    const key = storageKey(userId);
    let storageDebounce: ReturnType<typeof setTimeout> | null = null;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      if (storageDebounce) clearTimeout(storageDebounce);
      storageDebounce = setTimeout(() => {
        storageDebounce = null;
        void loadRemote();
      }, 400);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancel();
      scheduleSseLoadRef.current = null;
      if (pollId) window.clearInterval(pollId);
      if (storageDebounce) clearTimeout(storageDebounce);
      window.removeEventListener("storage", onStorage);
    };
  }, [authReady, userId, loadRemote]);

  const loadHistory = useCallback(async (limit = 8) => {
    if (!authReady) return;
    const res = await fetch(`/api/roulette/history?user=${encodeURIComponent(userId)}&limit=${limit}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { history?: HistoryItem[] };
    if (Array.isArray(data.history)) setHistory(data.history);
  }, [authReady, userId]);

  useEffect(() => {
    if (!authReady) return;
    void loadHistory(8);
  }, [authReady, loadHistory]);

  /** 방송 착지(LANDED) 직후 Redis 로그가 쌓이면 이력 패널 갱신 */
  useEffect(() => {
    if (!authReady) return;
    if (machine.phase === "LANDED") void loadHistory(8);
  }, [authReady, machine.phase, loadHistory]);

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

  useEffect(() => {
    if (machine.phase !== "IDLE") return;
    if (nextSpinTimerRef.current) {
      clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = null;
    }
    setStagedSelected([]);
    setSpinStep(0);
    setHighlightId(null);
    setOneShotReveal(false);
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

  useEffect(() => {
    if (!lastConfirmedText) return;
    const id = window.setTimeout(() => setLastConfirmedText(""), 3000);
    return () => window.clearTimeout(id);
  }, [lastConfirmedText]);

  const activeNormalPool = useMemo(() => {
    if (!state) return [];
    const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
    return (state.sigInventory || []).filter(
      (x) =>
        x.isActive &&
        x.id !== ONE_SHOT_SIG_ID &&
        !excluded.has(x.id) &&
        x.soldCount < x.maxCount &&
        (!memberFilterId || (x.memberId || "") === memberFilterId)
    );
  }, [state, memberFilterId]);
  const menuCount = useMemo(
    () => clampSigSalesMenuCount(state?.rouletteState?.menuCount),
    [state?.rouletteState?.menuCount]
  );
  const menuFillFromAllActive = state?.rouletteState?.menuFillFromAllActive === true;
  const wheelDisplayPool = useMemo(() => {
    if (!state) return [];
    return buildSigSalesWheelDisplayPool({
      inventory: state.sigInventory || [],
      sigSalesExcludedIds: state.sigSalesExcludedIds,
      sessionExcludedSigIds: state.rouletteState?.sessionExcludedSigIds,
      memberFilterId,
      menuCount,
      menuFillFromAllActive,
      ensureItems: [...(pendingLanding?.selected || []), ...(machine.selectedSigs || [])],
    });
  }, [
    state,
    memberFilterId,
    menuCount,
    menuFillFromAllActive,
    pendingLanding?.selected,
    machine.selectedSigs,
  ]);
  const wheelMenuSlices = useMemo(
    () => buildWheelMenuSlices(wheelDisplayPool, menuCount),
    [wheelDisplayPool, menuCount]
  );
  const wheelSpinTarget = useMemo(() => {
    const queue = (pendingLanding?.selected || machine.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
    const serverWinner = queue[spinStep] ?? null;
    return resolveWheelSpinTarget(wheelMenuSlices, serverWinner, spinStep);
  }, [wheelMenuSlices, pendingLanding?.selected, machine.selectedSigs, spinStep]);
  const wheelItemsWithResult = wheelSpinTarget.items;
  const wheelResultSliceId = wheelSpinTarget.sliceId;
  const displaySelectedSigs = useMemo(() => {
    if (stagedSelected.length > 0) return stagedSelected.slice(0, MAX_SELECTED_SIGS);
    return machine.selectedSigs.slice(0, MAX_SELECTED_SIGS);
  }, [machine.selectedSigs, stagedSelected]);
  const displaySelectedSigsForUi = useMemo(
    () =>
      displaySelectedSigs.map((s) => hydrateSigItemFromInventory(s, state?.sigInventory, userId)),
    [displaySelectedSigs, state?.sigInventory, userId]
  );
  const displayOneShot = useMemo(() => {
    if (displaySelectedSigs.length < MIN_ONE_SHOT_SIGS) return null;
    return buildOneShotFromSelected(displaySelectedSigs);
  }, [displaySelectedSigs]);
  const targetSelectionCount = useMemo(() => {
    if (pendingLanding?.selected?.length) return Math.max(1, Math.min(MAX_SELECTED_SIGS, pendingLanding.selected.length));
    if (machine.selectedSigs?.length) return Math.max(1, Math.min(MAX_SELECTED_SIGS, machine.selectedSigs.length));
    return 1;
  }, [pendingLanding?.selected, machine.selectedSigs]);
  const showFinalShowcase = displaySelectedSigs.length >= targetSelectionCount && !demoSpin && !pendingLanding;
  const oneShotImageUrl = useMemo(() => {
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    const fromOneShot = (oneShotItem?.imageUrl || "").trim();
    if (fromOneShot) return resolveSigAdminPreviewSrc(fromOneShot, oneShotItem?.name || "한방 시그", userId);
    const pick = displaySelectedSigsForUi.find((x) => (x.imageUrl || "").trim());
    if (pick) return resolveSigAdminPreviewSrc(pick.imageUrl, pick.name, userId);
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }, [state?.sigInventory, displaySelectedSigsForUi, userId]);

  useEffect(() => {
    if (!showFinalShowcase || !displayOneShot) {
      setOneShotReveal(false);
      return;
    }
    const id = window.setTimeout(() => setOneShotReveal(true), 950);
    return () => window.clearTimeout(id);
  }, [showFinalShowcase, displayOneShot]);

  const onStartRoulette = useCallback(async () => {
    if (!authReady) return;
    if (loadingSpin) return;
    if (!memberFilterId) {
      setToast("회전 전 멤버를 먼저 선택해주세요.");
      return;
    }
    if (machine.isFinishLoading) {
      setToast("판매 확정 처리 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    /** reset 직후에도 useCallback spin이 이전 phase를 보므로 API 가드 우회 */
    let forceSpinAfterRecover = false;
    if (machine.phase === "CONFIRM_PENDING") {
      cancelConfirm();
      resetToIdle();
      setShowConfirmModal(false);
      setToast("이전 처리 상태를 복구하고 새 회차를 시작합니다.");
      forceSpinAfterRecover = true;
    }
    if (machine.phase === "LANDED" || machine.phase === "CONFIRMED") {
      // 운영 중 멈춤 체감 방지를 위해 이전 회차를 자동 초기화하고 새 회차 시작
      resetToIdle();
    }
    if (activeNormalPool.length < 1) {
      setToast("선택한 멤버의 활성 시그가 없습니다. 멤버 시그를 추가/활성화해주세요.");
      return;
    }
    const nSpin = Math.max(1, Math.min(MAX_SELECTED_SIGS, Math.floor(cinematicSpinCount) || 5));
    setLoadingSpin(true);
    try {
      const data = await spin({ memberId: memberFilterId || null, force: forceSpinAfterRecover, spinCount: nSpin });
      const selected = (data.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
      const oneShot = buildOneShotFromSelected(selected);
      setPendingLanding({ selected, oneShot, resultId: data.result?.id || selected[selected.length - 1]?.id || null, persist: true });
      const firstTarget = resolveWheelSpinTarget(wheelMenuSlices, selected[0] ?? null, 0);
      setDemoSpin({
        startedAt: Date.now(),
        resultId: firstTarget.sliceId || selected[0]?.id || null,
      });
      setSpinStep(0);
      setStagedSelected([]);
      setHighlightId(null);
      confetti({ particleCount: 70, spread: 65, origin: { y: 0.25 } });
      setManualSoldSet(new Set());
      setOneShotSold(false);
      setShowConfirmModal(false);
      void loadRemote();
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "not_enough_active_sigs") {
        setToast(memberFilterId ? "선택 멤버의 활성 시그가 없습니다." : "활성 시그가 없습니다.");
        return;
      }
      // API 장애가 있어도 현장 테스트를 계속할 수 있도록 데모 회차로 즉시 대체
      const shuffled = [...PREVIEW_FILLER_POOL].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, Math.max(1, Math.min(MAX_SELECTED_SIGS, shuffled.length)));
      const resultId = selected[selected.length - 1]?.id || null;
      setPendingLanding({
        selected,
        oneShot: buildOneShotFromSelected(selected),
        resultId,
        persist: false,
      });
      const demoTarget = resolveWheelSpinTarget(wheelMenuSlices, selected[0] ?? null, 0);
      setDemoSpin({
        startedAt: Date.now(),
        resultId: demoTarget.sliceId || selected[0]?.id || resultId,
      });
      setSpinStep(0);
      setStagedSelected([]);
      setHighlightId(null);
      setManualSoldSet(new Set());
      setOneShotSold(false);
      setShowConfirmModal(false);
      setToast("서버 응답 실패로 데모 회차로 실행했습니다.");
    } finally {
      setLoadingSpin(false);
    }
  }, [
    authReady,
    loadingSpin,
    memberFilterId,
    cinematicSpinCount,
    machine.phase,
    machine.isFinishLoading,
    activeNormalPool.length,
    spin,
    resetToIdle,
    cancelConfirm,
    loadRemote,
    wheelMenuSlices,
  ]);

  useEffect(() => {
    if (!state?.members?.length) return;
    if (!memberFilterId) return;
    const exists = state.members.some((m) => m.id === memberFilterId);
    if (!exists) setMemberFilterId("");
  }, [state?.members, memberFilterId]);

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
  const onForceOverlayReload = useCallback(() => {
    const prev = Number(state?.rouletteState?.overlayReloadNonce || 0);
    void persistRouletteState({ overlayReloadNonce: prev + 1 });
    setToast("오버레이 새로고침 신호를 보냈습니다.");
  }, [state?.rouletteState?.overlayReloadNonce, persistRouletteState]);

  const clearLocalSpinUi = useCallback(() => {
    if (nextSpinTimerRef.current) {
      clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = null;
    }
    setPendingLanding(null);
    setDemoSpin(null);
    setStagedSelected([]);
    setSpinStep(0);
    setHighlightId(null);
    setOneShotReveal(false);
    setLastConfirmedText("");
    setManualSoldSet(new Set());
    setOneShotSold(false);
    setShowConfirmModal(false);
    setResultsPanelCollapsed(false);
    cancelConfirm();
    resetToIdle();
  }, [resetToIdle, cancelConfirm]);

  const resetRouletteOnServer = useCallback(
    async (clearWonPool: boolean) => {
      const res = await fetch(`/api/roulette/reset?user=${encodeURIComponent(userId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearWonPool }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(j.error || String(res.status));
      }
      clearLocalSpinUi();
      await loadRemote();
      const prev = Number(state?.rouletteState?.overlayReloadNonce || 0);
      await persistRouletteState({ overlayReloadNonce: prev + 1 });
    },
    [userId, clearLocalSpinUi, loadRemote, state?.rouletteState?.overlayReloadNonce, persistRouletteState]
  );

  const onRerollReset = useCallback(() => {
    void (async () => {
      try {
        await resetRouletteOnServer(false);
        setToast(
          memberFilterId
            ? "서버·OBS 회전 상태를 초기화했습니다. 같은 멤버로 다시 「회전판 시작」하세요."
            : "서버·OBS 회전 상태를 초기화했습니다. 「회전판 시작」으로 다시 진행하세요."
        );
      } catch (e) {
        setToast(`초기화 실패: ${String(e)}`);
      }
    })();
  }, [resetRouletteOnServer, memberFilterId]);

  const onResetRouletteIdle = useCallback(() => {
    void (async () => {
      try {
        await resetRouletteOnServer(true);
        setToast("회전판 IDLE + 당첨 제외 목록 비움. OBS도 새로고침됩니다.");
      } catch (e) {
        setToast(`회전판 초기화 실패: ${String(e)}`);
      }
    })();
  }, [resetRouletteOnServer]);

  const overlayObsUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const q = new URLSearchParams();
    q.set("u", userId);
    if (memberFilterId) q.set("memberId", memberFilterId);
    q.set("menuCount", String(menuCount));
    const rs = Number(state?.rouletteState?.sigResultScalePct);
    if (Number.isFinite(rs)) q.set("sigResultScalePct", String(Math.floor(rs)));
    return `${window.location.origin}/overlay/sig-sales?${q.toString()}`;
  }, [userId, memberFilterId, menuCount, state?.rouletteState?.sigResultScalePct]);

  const onConfirmSale = useCallback(async () => {
    if (!state || displaySelectedSigs.length === 0) return;
    setShowConfirmModal(false);
    markConfirmPending();
    try {
      const pr = await fetch(`/api/roulette/pending?user=${encodeURIComponent(userId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: machine.sessionId }),
      });
      if (!pr.ok) {
        throw new Error("pending_failed");
      }
    } catch {
      setError("판매 확정 준비 실패");
      cancelConfirm();
      setToast("판매 확정 준비 실패");
      return;
    }
    const manualCanon = new Set([...manualSoldSet].map((id) => canonicalSigIdFromWheelSliceId(id)));
    const selectedCanon = new Set(displaySelectedSigs.map((x) => canonicalSigIdFromWheelSliceId(x.id)));
    /** 판매 확정 시: 이번 회차 당첨 시그는 모두 재고 +1. 한방 카드 토글(oneShotSold) 없이도 반영되도록 함 */
    const nextInventory = state.sigInventory.map((item) => {
      const itemCanon = canonicalSigIdFromWheelSliceId(item.id);
      const markSold =
        manualCanon.has(itemCanon) ||
        selectedCanon.has(itemCanon) ||
        (item.id === ONE_SHOT_SIG_ID && Boolean(displayOneShot));
      if (!markSold) return item;
      const soldCount = Math.min(item.maxCount, Math.max(0, item.soldCount) + 1);
      return { ...item, soldCount };
    });
    try {
      await finish({
        sessionId: machine.sessionId,
        selectedSigs: displaySelectedSigs,
        oneShotResult: displayOneShot,
        finalPhase: "CONFIRMED",
      });
    } catch {
      setError("판매 확정 처리 실패");
      cancelConfirm();
      setToast("판매 확정 처리 실패");
      return;
    }
    const finishedAt = Date.now();
    const next: AppState = {
      ...state,
      sigInventory: nextInventory,
      rouletteState: {
        ...state.rouletteState,
        phase: "CONFIRMED",
        isRolling: false,
        lastFinishedAt: finishedAt,
        selectedSigs: displaySelectedSigs,
        oneShotResult: displayOneShot ?? state.rouletteState?.oneShotResult ?? null,
        sessionId: machine.sessionId || state.rouletteState?.sessionId || "",
      },
      updatedAt: finishedAt,
    };
    let saved = await saveStateAsync(next, userId);
    if (!saved.ok) {
      await new Promise((r) => setTimeout(r, 400));
      saved = await saveStateAsync(next, userId);
    }
    if (saved.ok) {
      setState(next);
      void loadHistory(8);
      setToast("판매 확정 완료!");
      confetti({ particleCount: 110, spread: 80, origin: { y: 0.22 } });
      setShowConfirmModal(false);
    } else {
      setToast(
        "서버에 회차는 반영되었으나 재고 저장에 실패했습니다. 새로고침 후 재고를 확인하세요.",
      );
      void loadRemote();
      setShowConfirmModal(false);
    }
  }, [
    state,
    displaySelectedSigs,
    machine.sessionId,
    displayOneShot,
    manualSoldSet,
    userId,
    finish,
    markConfirmPending,
    setError,
    cancelConfirm,
    loadRemote,
    loadHistory,
  ]);

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

  const persistInventoryPatch = useCallback(async (updater: (prev: AppState) => AppState) => {
    setState((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      void saveStateAsync(next, userId);
      return next;
    });
  }, [userId]);

  const runOcrForItem = useCallback(async (item: SigItem) => {
    const src = String(item.imageUrl || "").trim();
    if (!src) {
      setToast(`OCR 실패: ${item.name} 이미지 URL이 비어있습니다.`);
      return;
    }
    setOcrBusyIds((prev) => ({ ...prev, [item.id]: true }));
    try {
      const detail = await detectSigPriceFromImageUrlDetailed(src, { sigName: item.name || item.id });
      if (detail.price == null) {
        if (detail.reason === "unsupported_browser") {
          setToast(`OCR 실행 불가: 브라우저에서만 사용할 수 있습니다. (${item.name})`);
        } else if (detail.reason === "image_not_found") {
          setToast(`OCR 실패: 이미지 없음(404). 다시 업로드하거나 유효한 이미지 URL로 변경하세요. (${item.name})`);
        } else if (detail.reason === "image_load_failed") {
          setToast(`OCR 실패: 이미지를 불러오지 못했습니다(CORS·네트워크). (${item.name})`);
        } else {
          setToast(
            `OCR 실패: 금액을 찾지 못했습니다. (${item.name})${detail.previewText ? ` 감지: ${detail.previewText}` : ""}`
          );
        }
        return;
      }
      await persistInventoryPatch((prev) => ({
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => (x.id === item.id ? { ...x, price: detail.price! } : x)),
        updatedAt: Date.now(),
      }));
      setToast(`OCR 적용: ${item.name} ${detail.price.toLocaleString("ko-KR")}원`);
    } finally {
      setOcrBusyIds((prev) => ({ ...prev, [item.id]: false }));
    }
  }, [persistInventoryPatch]);

  const runOcrForAll = useCallback(async () => {
    if (ocrAllBusy || !state) return;
    const targets = (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID && String(x.imageUrl || "").trim());
    if (!targets.length) {
      setToast("OCR 대상 시그가 없습니다.");
      return;
    }
    setOcrAllBusy(true);
    setToast(`OCR 일괄 준비 중… (총 ${targets.length}건, 워커 로드)`);
    const priceById = new Map<string, number>();
    try {
      await prewarmSigOcrWorker();
      for (let i = 0; i < targets.length; i++) {
        const item = targets[i];
        setOcrBatchProgress({ current: i + 1, total: targets.length });
        setToast(`OCR 일괄 진행: ${i + 1}/${targets.length}${item.name ? ` · ${item.name}` : ""}`);
        setOcrBusyIds((prev) => ({ ...prev, [item.id]: true }));
        try {
          const detail = await detectSigPriceFromImageUrlDetailed(String(item.imageUrl || "").trim(), {
            sigName: item.name,
          });
          if (detail.price != null) {
            priceById.set(item.id, detail.price);
            const pr = detail.price;
            await persistInventoryPatch((prev) => ({
              ...prev,
              sigInventory: (prev.sigInventory || []).map((x) =>
                x.id === item.id ? { ...x, price: pr } : x
              ),
              updatedAt: Date.now(),
            }));
          }
          await new Promise((r) => setTimeout(r, 16));
        } finally {
          setOcrBusyIds((prev) => ({ ...prev, [item.id]: false }));
        }
      }
      const ok = priceById.size;
      const fail = targets.length - ok;
      if (ok > 0) {
        await persistInventoryPatch((prev) => ({
          ...prev,
          sigInventory: (prev.sigInventory || []).map((x) => {
            const pr = priceById.get(x.id);
            return pr != null ? { ...x, price: pr } : x;
          }),
          updatedAt: Date.now(),
        }));
      }
      setToast(`OCR 일괄 완료: 성공 ${ok}건 / 실패 ${fail}건`);
    } finally {
      await terminateSharedSigOcrWorker();
      setOcrBatchProgress(null);
      setOcrAllBusy(false);
    }
  }, [ocrAllBusy, state, persistInventoryPatch]);

  const dedupeSigInventoryItems = useCallback(
    (strategy: "imageUrl" | "nameAndPrice") => {
      const label = strategy === "imageUrl" ? "이미지 URL 또는 이름" : "이름+가격";
      if (!confirm(`동일 ${label}인 시그는 위쪽 행만 남기고 삭제합니다. 계속할까요?`)) return;
      void persistInventoryPatch((prev) => {
        if (!prev) return prev;
        const { nextInventory, removedCount } = dedupeSigInventory(prev.sigInventory || [], strategy);
        queueMicrotask(() => {
          setToast(
            removedCount === 0 ? "중복된 시그 행이 없습니다." : `중복 제거(${label}): ${removedCount}건 삭제`
          );
        });
        if (removedCount === 0) return prev;
        return { ...prev, sigInventory: nextInventory, updatedAt: Date.now() };
      });
    },
    [persistInventoryPatch]
  );

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-[1280px] space-y-4">
        <header className="sticky top-0 z-[200] -mx-2 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-white/10 bg-neutral-950/95 px-3 py-3 shadow-lg backdrop-blur-md">
          <div>
            <h1 className="text-2xl font-black text-yellow-200">시그 판매 회전판</h1>
            <p className="text-sm text-neutral-300">IDLE → SPINNING → LANDED → CONFIRM_PENDING → CONFIRMED 단일 플로우</p>
            <p className="mt-1 text-xs text-yellow-200/90">
              현재 상태: {machine.phase} · 회전판 칸 수: {menuCount}
              {menuFillFromAllActive ? " (전체 활성 시그로 채움)" : ""}
            </p>
            {overlayObsUrl ? (
              <p className="mt-2 max-w-xl text-[11px] text-neutral-400">
                OBS 소스 URL (u={userId}
                {memberFilterId ? ` · memberId=${memberFilterId}` : ""}):{" "}
                <code className="break-all text-emerald-300/90">{overlayObsUrl}</code>
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={memberFilterId}
              onChange={(e) => setMemberFilterId(e.target.value)}
              className="rounded border border-white/15 bg-neutral-900 px-2 py-2 text-xs text-neutral-200"
            >
              <option value="">멤버 선택</option>
              {(state?.members || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <label className="flex flex-col gap-0.5 text-[11px] text-neutral-400">
              회전판 칸 수
              <input
                type="number"
                min={5}
                max={20}
                value={menuCount}
                disabled={controlsDisabled}
                onChange={(e) => {
                  const n = clampSigSalesMenuCount(e.target.value);
                  void persistRouletteState({ menuCount: n });
                }}
                className="w-16 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              />
            </label>
            <label className="flex flex-col gap-0.5 text-[11px] text-neutral-400">
              당첨 시그 수
              <input
                type="number"
                min={1}
                max={MAX_SELECTED_SIGS}
                value={cinematicSpinCount}
                onChange={(e) => {
                  const raw = parseInt(String(e.target.value || ""), 10);
                  if (!Number.isFinite(raw)) return;
                  setCinematicSpinCount(Math.max(1, Math.min(MAX_SELECTED_SIGS, raw)));
                }}
                className="w-16 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
              />
            </label>
            <Link
              href="/admin?sigSales=wheel"
              className="rounded border border-white/20 bg-black/40 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10"
            >
              대시보드 모달
            </Link>
            {(machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading) && (
              <button
                type="button"
                onClick={() => {
                  cancelConfirm();
                  setShowConfirmModal(false);
                  resetToIdle();
                  setToast("확정 처리를 중단하고 IDLE로 복구했습니다.");
                }}
                className="rounded bg-rose-700 px-3 py-2 text-xs font-bold hover:bg-rose-600"
              >
                확정 멈춤·복구
              </button>
            )}
            <button
              type="button"
              onClick={onResetRouletteIdle}
              disabled={loadingSpin || machine.isFinishLoading}
              className="rounded border border-amber-400/50 bg-amber-950/60 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-900/80 disabled:opacity-50"
            >
              회전판 초기화
            </button>
            <button
              type="button"
              onClick={onRerollReset}
              disabled={loadingSpin || machine.isFinishLoading}
              className="rounded bg-slate-700 px-4 py-2 text-sm font-bold hover:bg-slate-600 disabled:opacity-50"
            >
              다시 돌리기
            </button>
            {overlayObsUrl ? (
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-2 text-xs text-neutral-200 hover:bg-white/10"
                onClick={() => {
                  void navigator.clipboard.writeText(overlayObsUrl);
                  setToast("OBS URL을 복사했습니다.");
                }}
              >
                OBS URL 복사
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void onStartRoulette()}
              disabled={loadingSpin || !memberFilterId}
              className="rounded bg-fuchsia-700 px-4 py-2 text-sm font-bold hover:bg-fuchsia-600 disabled:opacity-50"
            >
              {loadingSpin ? "추첨 준비중..." : "회전판 시작"}
            </button>
          </div>
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
          <button
            type="button"
            onClick={onForceOverlayReload}
            disabled={controlsDisabled}
            className="ml-3 rounded bg-slate-700 px-3 py-1.5 text-xs font-bold hover:bg-slate-600 disabled:opacity-50"
          >
            오버레이 강제 새로고침
          </button>
        </section>

        <section style={{ backgroundColor: "transparent" }} className="relative rounded-2xl border border-yellow-200/20 p-4">
          {lastConfirmedText ? (
            <div
              key={`confirmed-fx-${lastConfirmedFxKey}`}
              className="pointer-events-none absolute left-4 top-1/2 z-40 -translate-y-1/2 rounded-2xl border border-fuchsia-300/80 bg-fuchsia-500/25 px-5 py-3 text-3xl font-black text-fuchsia-100 shadow-[0_0_26px_rgba(217,70,239,0.6)] animate-pulse"
            >
              {lastConfirmedText}
            </div>
          ) : null}
          {!showFinalShowcase ? <RouletteWheel
            items={wheelItemsWithResult}
            isRolling={Boolean(demoSpin) || machine.isRolling || machine.phase === "SPINNING"}
            resultId={wheelResultSliceId || demoSpin?.resultId || machine.resultId}
            startedAt={demoSpin?.startedAt || machine.startedAt}
            volume={volume}
            muted={muted}
            onLanded={(landedId) => {
              if (!pendingLanding) return;
              const selectedQueue = pendingLanding.selected.slice(0, MAX_SELECTED_SIGS);
              if (selectedQueue.length === 0) return;
              const serverWinner = selectedQueue[Math.min(spinStep, selectedQueue.length - 1)];
              if (
                serverWinner &&
                landedId &&
                !wheelSliceMatchesServerWinner(landedId, serverWinner)
              ) {
                console.warn("[sig-sales admin] wheel/card mismatch — using server queue", {
                  landedId,
                  serverId: serverWinner.id,
                });
              }
              const current = serverWinner;
              if (!current) return;
              const nextSelected = [...stagedSelected, current].filter((item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx);
              const nextStep = spinStep + 1;
              setHighlightId(current.id);
              setLastConfirmedText(`${current.name} 확정!`);
              setLastConfirmedFxKey((v) => v + 1);

              if (nextStep < selectedQueue.length) {
                setStagedSelected(nextSelected);
                setSpinStep(nextStep);
                if (nextSpinTimerRef.current) clearTimeout(nextSpinTimerRef.current);
                nextSpinTimerRef.current = setTimeout(() => {
                  setLastConfirmedText("");
                  const nextTarget = resolveWheelSpinTarget(
                    wheelMenuSlices,
                    selectedQueue[nextStep] ?? null,
                    nextStep
                  );
                  setDemoSpin({
                    startedAt: Date.now(),
                    resultId: nextTarget.sliceId || selectedQueue[nextStep]?.id || null,
                  });
                }, STEP_CONFIRM_PAUSE_MS);
                return;
              }

              const finalSelected = nextSelected;
              const oneShot = buildOneShotFromSelected(finalSelected);
              landed(finalSelected, oneShot, pendingLanding.resultId || current.id);
              oneShotSound.stop();
              oneShotSound.play();
              setStagedSelected(finalSelected);
              setSpinStep(0);
              setDemoSpin(null);
              const snapSession = machine.sessionId;
              const snapStarted = machine.startedAt;
              const shouldPersist = pendingLanding.persist;
              setPendingLanding(null);
              if (!shouldPersist) return;
              void (async () => {
                if (!snapSession) return;
                try {
                  const res = await fetch(`/api/roulette/land?user=${encodeURIComponent(userId)}`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      sessionId: snapSession,
                      startedAt: snapStarted,
                      selectedSigs: finalSelected,
                      oneShotResult: oneShot,
                    }),
                  });
                  if (res.ok) void loadRemote();
                } catch {
                  /* land 실패 시에도 로컬 landed() UX는 유지 */
                }
              })();
            }}
          /> : null}

          {machine.phase === "CONFIRM_PENDING" ? (
            <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-yellow-300/40 bg-black/70 px-4 py-2">
              <div className="flex items-center gap-3 text-center">
                <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-yellow-300 border-t-transparent" />
                <p className="text-sm font-semibold text-yellow-100">판매 확정 처리 중…</p>
              </div>
            </div>
          ) : null}

          {(machine.phase === "SPINNING" || machine.phase === "LANDED" || machine.phase === "CONFIRM_PENDING" || machine.phase === "CONFIRMED" || stagedSelected.length > 0) &&
          displaySelectedSigs.length > 0 ? (
            <div className="mt-4 space-y-3">
              {showFinalShowcase ? (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-yellow-100">당첨 결과 ({displaySelectedSigsForUi.length}개)</p>
                  <button
                    type="button"
                    className="rounded border border-white/20 px-2 py-1 text-xs text-neutral-200 hover:bg-white/10"
                    onClick={() => setResultsPanelCollapsed((v) => !v)}
                  >
                    {resultsPanelCollapsed ? "결과 펼치기" : "결과 접기 (휠·컨트롤 보기)"}
                  </button>
                </div>
              ) : null}
              <div
                className={`space-y-4 ${showFinalShowcase && resultsPanelCollapsed ? "hidden" : ""} ${
                  showFinalShowcase ? "max-h-[min(58vh,560px)] overflow-y-auto pr-1" : ""
                }`}
              >
              <SelectedSigs
                items={displaySelectedSigsForUi}
                sigImageUserId={userId}
                soldOutStampUrl={soldOutStampUrl}
                manualSoldSet={manualSoldSet}
                disabled={controlsDisabled}
                highlightId={highlightId}
                compactGridJustify="start"
                trailingSlot={displayOneShot && oneShotReveal ? (
                  <OneShotSigCard
                    name={displayOneShot?.name || "한방 시그"}
                    price={displayOneShot?.price || 0}
                    imageUrl={oneShotImageUrl}
                    sigImageUserId={userId}
                    sold={oneShotSold}
                    soldOutStampUrl={soldOutStampUrl}
                    selectedSigCount={displaySelectedSigsForUi.length}
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
              <div className={`flex ${showFinalShowcase ? "justify-center" : "justify-end"}`}>
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
            </div>
          ) : null}

          {machine.phase === "CONFIRMED" ? (
            <div className="mt-4 rounded-xl border border-emerald-300/60 bg-emerald-900/30 p-4 text-center">
              <p className="text-2xl font-black text-emerald-200">판매 확정 완료!</p>
              <p className="mt-1 text-sm text-emerald-100">
                {displaySelectedSigs.map((s) => s.name).join(", ")}
                {displayOneShot?.name ? ` + ${displayOneShot.name}` : ""}
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
              {history.length === 0 ? <p className="text-xs text-neutral-400">아직 이력이 없습니다. (방송 착지 후 LANDED · 판매 확정 후 CONFIRMED)</p> : null}
              {history.slice(0, 8).map((h) => {
                const names = h.selectedSigs.map((s) => s.name).join(", ") || "-";
                const phaseStyle =
                  h.phase === "CONFIRMED"
                    ? "border-emerald-500/35 bg-emerald-950/20 text-neutral-100"
                    : h.phase === "LANDED"
                      ? "border-amber-500/40 bg-amber-950/25 text-neutral-100"
                      : "border-rose-500/35 bg-rose-950/20 text-neutral-100";
                const badgeStyle =
                  h.phase === "CONFIRMED" ? "bg-emerald-700/70" : h.phase === "LANDED" ? "bg-amber-700/75" : "bg-rose-700/70";
                return (
                <button
                  type="button"
                  key={h.id}
                  onClick={() => {
                    setSelectedHistory(h);
                    setShowHistoryModal(true);
                  }}
                  className={`w-full rounded border px-3 py-2 text-left text-xs ${phaseStyle}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">세션: {h.sessionId}</span>
                    <span className={`shrink-0 rounded px-1.5 py-0.5 ${badgeStyle}`}>{h.phase}</span>
                  </div>
                  <div className="mt-1 text-neutral-200">
                    당첨 시그: {names}
                  </div>
                  <div className="mt-0.5 text-neutral-300">
                    한방 시그: {h.oneShotPrice.toLocaleString("ko-KR")}원 · 합계 {h.totalPrice.toLocaleString("ko-KR")}원
                  </div>
                  <div className="mt-1 text-[11px] text-neutral-400">
                    {new Date(h.timestamp).toLocaleString("ko-KR")}
                  </div>
                </button>
                );
              })}
              <button type="button" className="mt-1 rounded bg-white/10 px-2 py-1 text-xs" onClick={() => void loadHistory(20)}>
                전체 이력 보기
              </button>
            </div>
          ) : null}
        </section>
        <section className="rounded-xl border border-white/10 bg-black/35 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-neutral-200">시그 관리 (멤버 지정 / OCR)</h2>
            <button
              type="button"
              onClick={() => void runOcrForAll()}
              disabled={ocrAllBusy}
              className="rounded bg-violet-700 px-3 py-1.5 text-xs font-bold hover:bg-violet-600 disabled:opacity-50"
            >
              {ocrAllBusy && ocrBatchProgress
                ? `OCR 처리 중 ${ocrBatchProgress.current}/${ocrBatchProgress.total}`
                : "금액 OCR 전체 적용"}
            </button>
            <button
              type="button"
              title="같은 이미지 URL(경로 기준) 또는 같은 시그 이름은 첫 행만 유지"
              className="rounded bg-amber-900/80 px-3 py-1.5 text-xs font-bold hover:bg-amber-800 disabled:opacity-50"
              disabled={ocrAllBusy}
              onClick={() => dedupeSigInventoryItems("imageUrl")}
            >
              중복 제거(URL·이름)
            </button>
            <button
              type="button"
              title="같은 이름+가격은 첫 행만 유지"
              className="rounded bg-amber-900/80 px-3 py-1.5 text-xs font-bold hover:bg-amber-800 disabled:opacity-50"
              disabled={ocrAllBusy}
              onClick={() => dedupeSigInventoryItems("nameAndPrice")}
            >
              중복 제거(이름+가격)
            </button>
          </div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/25 px-2 py-1.5 text-[11px] text-neutral-400">
            <span>행 접기: 헤더만 표시 · 금액/멤버/URL은 펼친 뒤 수정</span>
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded bg-neutral-700 px-2 py-1 text-[11px] hover:bg-neutral-600"
                onClick={() => {
                  const ids = (state?.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).map((x) => x.id);
                  setSigSalesSigRowOpen(Object.fromEntries(ids.map((id) => [id, true])));
                }}
              >
                모두 펼치기
              </button>
              <button
                type="button"
                className="rounded bg-neutral-700 px-2 py-1 text-[11px] hover:bg-neutral-600"
                onClick={() => {
                  const ids = (state?.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).map((x) => x.id);
                  setSigSalesSigRowOpen(Object.fromEntries(ids.map((id) => [id, false])));
                }}
              >
                모두 접기
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {(state?.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).map((item) => {
              const rowOpen = Boolean(sigSalesSigRowOpen[item.id]);
              return (
              <div key={item.id} className="overflow-hidden rounded border border-white/10 bg-[#1f1f1f] text-xs">
                <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-black/20 px-2 py-2">
                  <button
                    type="button"
                    className="shrink-0 rounded px-1.5 py-0.5 text-neutral-400 hover:bg-white/10"
                    aria-expanded={rowOpen}
                    aria-label={rowOpen ? "행 접기" : "행 펼치기"}
                    onClick={() =>
                      setSigSalesSigRowOpen((p) => ({
                        ...p,
                        [item.id]: !Boolean(p[item.id]),
                      }))
                    }
                  >
                    {rowOpen ? "▼" : "▶"}
                  </button>
                  <span className="min-w-[100px] font-semibold text-neutral-100">{item.name}</span>
                  <span className="text-neutral-500">{item.price.toLocaleString("ko-KR")}원</span>
                  <button
                    type="button"
                    onClick={() => void runOcrForItem(item)}
                    disabled={Boolean(ocrBusyIds[item.id])}
                    className="ml-auto rounded bg-violet-800 px-2 py-1 text-xs font-bold hover:bg-violet-700 disabled:opacity-50"
                  >
                    {ocrBusyIds[item.id] ? "OCR..." : "OCR"}
                  </button>
                </div>
                {rowOpen ? (
                  <div className="flex flex-wrap items-center gap-2 px-2 py-2">
                    <input
                      type="number"
                      min={0}
                      className="w-24 rounded border border-white/10 bg-neutral-900 px-2 py-1 text-xs"
                      value={item.price}
                      onChange={(e) => {
                        const price = Math.max(0, Math.floor(Number(e.target.value || 0) || 0));
                        void persistInventoryPatch((prev) => ({
                          ...prev,
                          sigInventory: (prev.sigInventory || []).map((x) => (x.id === item.id ? { ...x, price } : x)),
                          updatedAt: Date.now(),
                        }));
                      }}
                    />
                    <select
                      className="rounded border border-white/10 bg-neutral-900 px-2 py-1 text-xs"
                      value={item.memberId || ""}
                      onChange={(e) => {
                        const memberId = e.target.value;
                        void persistInventoryPatch((prev) => ({
                          ...prev,
                          sigInventory: (prev.sigInventory || []).map((x) => (x.id === item.id ? { ...x, memberId } : x)),
                          updatedAt: Date.now(),
                        }));
                      }}
                    >
                      <option value="">공통(전체 멤버)</option>
                      {(state?.members || []).map((m) => (
                        <option key={`sig-member-${item.id}-${m.id}`} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <span className="min-w-0 flex-1 truncate text-neutral-400">{item.imageUrl || "(이미지 URL 없음)"}</span>
                  </div>
                ) : null}
              </div>
              );
            })}
          </div>
        </section>
      </div>
      <ConfirmationModal
        open={showConfirmModal && machine.phase !== "CONFIRMED" && machine.phase !== "CONFIRM_PENDING"}
        loading={machine.isFinishLoading}
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
