"use client";

export const dynamic = "force-dynamic";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamicImport from "next/dynamic";
import confetti from "canvas-confetti";
import { Howl } from "howler";
import type { SigItem } from "@/types";

const RouletteWheel = dynamicImport(() => import("@/components/sig-sales/RouletteWheel"), {
  ssr: false,
  loading: () => (
    <div
      className="flex items-center justify-center text-sm text-neutral-400"
      style={{ height: 360, maxWidth: 680 }}
    >
      회전판 로딩…
    </div>
  ),
});
import SelectedSigs from "@/components/sig-sales/SelectedSigs";
import OneShotSigCard from "@/components/sig-sales/OneShotSigCard";
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";
import ConfirmationModal from "@/components/sig-sales/ConfirmationModal";
import RouletteHistoryModal from "@/components/sig-sales/RouletteHistoryModal";
import {
  BUNDLED_SIG_PLACEHOLDER_URL,
  DEFAULT_SIG_SOLD_STAMP_URL,
  resolveSigAdminPreviewSrc,
} from "@/lib/constants";
import { loadState, loadStateFromApi, saveStateAsync, storageKey, type AppState } from "@/lib/state";
import { useSSEConnection } from "@/lib/sse-client";
import {
  createStateUpdatedScheduler,
  readOverlayPollIntervalMs,
  readSigSalesOverlayPollMs,
  shouldSyncOverlayFromStateUpdatedEvent,
  shouldSyncSigSalesFromRouletteSseHint,
  sigSalesRouletteSyncCursorFromState,
  type SigSalesRouletteSyncCursor,
} from "@/lib/overlay-pull-policy";
import {
  ONE_SHOT_SIG_ID,
  SPIN_SOUND_PATHS,
  clampOverlayOpacity,
  cancelRouletteSession,
  buildSigSalesWheelDisplayPool,
  buildWheelMenuSlices,
  resolveWheelSlicesForSpinVisual,
  clampSigSalesMenuCount,
  minSigSalesMenuCountForActive,
  resolveSigSalesMenuCount,
  canonicalSigIdFromWheelSliceId,
  hydrateSigItemFromInventory,
  rememberUsedWheelSliceId,
  resolveSpinQueueForSession,
  bindWheelAnimationToRoundWinner,
  type SpinQueueSessionPin,
  sigMatchesMemberFilter,
  wheelSliceMatchesServerWinner,
} from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";
import {
  detectSigPriceFromImageUrlDetailed,
  prewarmSigOcrWorker,
  terminateSharedSigOcrWorker,
} from "@/lib/sig-image-ocr";
import { dedupeSigInventory } from "@/lib/sig-inventory-dedup";
import {
  WHEEL_DEMO_MENU_COUNT,
  WHEEL_DEMO_WIN_COUNT,
  getWheelDemoOverlayPath,
  getWheelDemoPlaythroughAutoPath,
  getWheelDemoPlaythroughPath,
  getSigSalesWheelDemoOverlayPath,
  isWheelDemoHostAllowed,
  mergeWheelDemoSigInventory,
  pickWheelDemoWinners,
} from "@/lib/sig-wheel-demo-pool";

const STEP_CONFIRM_PAUSE_MS = 3000;
const MAX_SELECTED_SIGS = 20;
const MIN_ONE_SHOT_SIGS = 2;
const MAX_SIG_UPLOAD_BYTES = 30 * 1024 * 1024;
const MANUAL_SIG_DRAFT_STORAGE_PREFIX = "admin-sig-sales-manual-draft-v1";
const MANUAL_SIG_DRAFT_STATE_KEY = "sigSalesManualDraftV1";
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
type ManualSigDraft = {
  sourceSigId?: string;
  name: string;
  priceInput: string;
  imageUrl: string;
};
type ManualInputMode = "free" | "inventory";
type ManualSigDraftPersist = {
  inputMode?: ManualInputMode;
  drafts: ManualSigDraft[];
  oneShotName: string;
  oneShotPriceInput: string;
  oneShotImageUrl: string;
  sigSoldFlags: boolean[];
  oneShotMarkSold: boolean;
};
const buildOneShotFromSelected = (selected: SigItem[]) => {
  if (selected.length < MIN_ONE_SHOT_SIGS) return null;
  return {
    id: ONE_SHOT_SIG_ID,
    name: "한방 시그",
    price: selected.reduce((sum, x) => sum + x.price, 0),
  };
};

export default function AdminSigSalesPage() {
  const router = useRouter();
  const [initialView, setInitialView] = useState<"manual" | "default">("default");
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
  /** 로컬·LAN 전용 휠 데모 20칸(서버 인벤토리·Redis에는 저장되지 않음) */
  const [wheelDemoMode, setWheelDemoMode] = useState(false);
  const [pendingLanding, setPendingLanding] = useState<{ selected: SigItem[]; oneShot: { id: string; name: string; price: number } | null; resultId: string | null; persist: boolean } | null>(null);
  const [volume, setVolume] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [autoResetAfterConfirm, setAutoResetAfterConfirm] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [stagedSelected, setStagedSelected] = useState<SigItem[]>([]);
  const [manualPreviewSelected, setManualPreviewSelected] = useState<SigItem[]>([]);
  const [spinStep, setSpinStep] = useState(0);
  const [pinnedWheelLayout, setPinnedWheelLayout] = useState<{
    sessionId: string;
    queueSig: string;
    slices: SigItem[];
  } | null>(null);
  const usedWheelSliceIdsRef = useRef<Set<string>>(new Set());
  const spinQueuePinRef = useRef<SpinQueueSessionPin>({ sessionId: "", queue: [] });
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [lastConfirmedText, setLastConfirmedText] = useState("");
  const [lastConfirmedFxKey, setLastConfirmedFxKey] = useState(0);
  const [oneShotReveal, setOneShotReveal] = useState(false);
  const [ocrBusyIds, setOcrBusyIds] = useState<Record<string, boolean>>({});
  const [ocrAllBusy, setOcrAllBusy] = useState(false);
  const [ocrBatchProgress, setOcrBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [sigSalesSigRowOpen, setSigSalesSigRowOpen] = useState<Record<string, boolean>>({});
  const [resultsPanelCollapsed, setResultsPanelCollapsed] = useState(false);
  const [overlayObsUrl, setOverlayObsUrl] = useState("");
  const [overlayObsUrlManual, setOverlayObsUrlManual] = useState("");
  const [overlayObsMode, setOverlayObsMode] = useState<"wheel" | "manual">("wheel");
  const [manualInputMode, setManualInputMode] = useState<ManualInputMode>("free");
  const [manualSigDrafts, setManualSigDrafts] = useState<ManualSigDraft[]>(
    Array.from({ length: 5 }, () => ({ name: "", priceInput: "", imageUrl: "" }))
  );
  const [manualOneShotName, setManualOneShotName] = useState("한방 시그");
  const [manualOneShotPriceInput, setManualOneShotPriceInput] = useState("");
  const [manualOneShotImageUrl, setManualOneShotImageUrl] = useState("");
  const [manualSigSoldFlags, setManualSigSoldFlags] = useState<boolean[]>([false, false, false, false, false]);
  const [manualOneShotMarkSold, setManualOneShotMarkSold] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualDebugInfo, setManualDebugInfo] = useState<string>("");
  const [manualRowUploadBusy, setManualRowUploadBusy] = useState<Record<number, boolean>>({});
  const [manualOneShotUploadBusy, setManualOneShotUploadBusy] = useState(false);
  const nextSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualSectionRef = useRef<HTMLDivElement | null>(null);
  const manualDraftHydratedRef = useRef(false);
  const latestStateRef = useRef<AppState | null>(null);
  const manualDraftLastSavedRef = useRef<string>("");
  const [oneShotSound] = useState(() => new Howl({ src: [SPIN_SOUND_PATHS.oneShot], preload: true, volume: 0.7 }));
  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || DEFAULT_SIG_SOLD_STAMP_URL;
  const { machine, spin, landed, markConfirmPending, cancelConfirm, resetToIdle, finish, setOpacity, setError } = useSigSalesState(userId, state);
  const controlsDisabled = !authReady || machine.phase === "CONFIRM_PENDING" || machine.isFinishLoading;

  useEffect(() => {
    latestStateRef.current = state;
  }, [state]);

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

  const lastSyncedUpdatedAtRef = useRef(0);
  const lastRouletteSyncRef = useRef<SigSalesRouletteSyncCursor>({ sessionId: "", phase: "" });
  const loadRemote = useCallback(async () => {
    if (!authReady) return;
    const remote = await loadStateFromApi(userId);
    if (!remote) return;
    const ts = remote.updatedAt || 0;
    if (ts > 0) lastSyncedUpdatedAtRef.current = Math.max(lastSyncedUpdatedAtRef.current, ts);
    lastRouletteSyncRef.current = sigSalesRouletteSyncCursorFromState(remote.rouletteState);
    setState(remote);
  }, [authReady, userId]);

  const loadRemoteRef = useRef(loadRemote);
  loadRemoteRef.current = loadRemote;
  const scheduleSseLoadRef = useRef<(() => void) | null>(null);
  useSSEConnection((d: unknown) => {
    const o = d as {
      type?: string;
      updatedAt?: number;
      roulettePhase?: string;
      rouletteSessionId?: string;
    };
    if (o?.type !== "state_updated") return;
    const rouletteHint = shouldSyncSigSalesFromRouletteSseHint(o, lastRouletteSyncRef.current);
    if (
      !rouletteHint &&
      !shouldSyncOverlayFromStateUpdatedEvent(o.updatedAt, lastSyncedUpdatedAtRef.current)
    ) {
      return;
    }
    if (rouletteHint) {
      const sid = String(o.rouletteSessionId || lastRouletteSyncRef.current.sessionId || "").trim();
      const phase = String(o.roulettePhase || lastRouletteSyncRef.current.phase || "").trim();
      if (sid) lastRouletteSyncRef.current = { sessionId: sid, phase };
    }
    scheduleSseLoadRef.current?.();
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
    const sigSalesPollMs = pollMs > 0 ? 0 : readSigSalesOverlayPollMs();
    let pollId: number | undefined;
    const effectivePollMs = pollMs > 0 ? pollMs : sigSalesPollMs;
    if (effectivePollMs > 0) {
      pollId = window.setInterval(() => void loadRemote(), effectivePollMs);
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

  useEffect(() => {
    if (manualDraftHydratedRef.current) return;
    const stateDraftRaw = (() => {
      const os = state?.overlaySettings;
      if (!os || typeof os !== "object") return null;
      const raw = (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY];
      return raw && typeof raw === "object" ? (raw as Partial<ManualSigDraftPersist>) : null;
    })();
    if (stateDraftRaw) {
      if (Array.isArray(stateDraftRaw.drafts) && stateDraftRaw.drafts.length === 5) {
        setManualSigDrafts(
          stateDraftRaw.drafts.map((x) => ({
            sourceSigId: String(x?.sourceSigId || "").trim() || undefined,
            name: String(x?.name || ""),
            priceInput: String(x?.priceInput || ""),
            imageUrl: String(x?.imageUrl || ""),
          }))
        );
      }
      if (stateDraftRaw.inputMode === "free" || stateDraftRaw.inputMode === "inventory") {
        setManualInputMode(stateDraftRaw.inputMode);
      }
      if (typeof stateDraftRaw.oneShotName === "string") setManualOneShotName(stateDraftRaw.oneShotName);
      if (typeof stateDraftRaw.oneShotPriceInput === "string") setManualOneShotPriceInput(stateDraftRaw.oneShotPriceInput);
      if (typeof stateDraftRaw.oneShotImageUrl === "string") setManualOneShotImageUrl(stateDraftRaw.oneShotImageUrl);
      if (Array.isArray(stateDraftRaw.sigSoldFlags) && stateDraftRaw.sigSoldFlags.length === 5) {
        setManualSigSoldFlags(stateDraftRaw.sigSoldFlags.map((v) => Boolean(v)));
      }
      if (typeof stateDraftRaw.oneShotMarkSold === "boolean") setManualOneShotMarkSold(stateDraftRaw.oneShotMarkSold);
      manualDraftHydratedRef.current = true;
      return;
    }

    if (typeof window === "undefined") return;
    const key = `${MANUAL_SIG_DRAFT_STORAGE_PREFIX}:${userId || "default"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        inputMode?: ManualInputMode;
        drafts?: ManualSigDraft[];
        oneShotName?: string;
        oneShotPriceInput?: string;
        oneShotImageUrl?: string;
        sigSoldFlags?: boolean[];
        oneShotMarkSold?: boolean;
      };
      if (Array.isArray(parsed?.drafts) && parsed.drafts.length === 5) {
        setManualSigDrafts(
          parsed.drafts.map((x) => ({
            sourceSigId: String(x?.sourceSigId || "").trim() || undefined,
            name: String(x?.name || ""),
            priceInput: String(x?.priceInput || ""),
            imageUrl: String(x?.imageUrl || ""),
          }))
        );
      }
      if (parsed?.inputMode === "free" || parsed?.inputMode === "inventory") {
        setManualInputMode(parsed.inputMode);
      }
      if (typeof parsed?.oneShotName === "string") setManualOneShotName(parsed.oneShotName);
      if (typeof parsed?.oneShotPriceInput === "string") setManualOneShotPriceInput(parsed.oneShotPriceInput);
      if (typeof parsed?.oneShotImageUrl === "string") setManualOneShotImageUrl(parsed.oneShotImageUrl);
      if (Array.isArray(parsed?.sigSoldFlags) && parsed.sigSoldFlags.length === 5) {
        setManualSigSoldFlags(parsed.sigSoldFlags.map((v) => Boolean(v)));
      }
      if (typeof parsed?.oneShotMarkSold === "boolean") setManualOneShotMarkSold(parsed.oneShotMarkSold);
    } catch {
      /* ignore malformed local draft */
    } finally {
      /** 초안이 비어 있어도 이후 자동저장은 반드시 동작해야 함 */
      manualDraftHydratedRef.current = true;
    }
  }, [userId, state?.overlaySettings]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `${MANUAL_SIG_DRAFT_STORAGE_PREFIX}:${userId || "default"}`;
    const payload = {
      inputMode: manualInputMode,
      drafts: manualSigDrafts,
      oneShotName: manualOneShotName,
      oneShotPriceInput: manualOneShotPriceInput,
      oneShotImageUrl: manualOneShotImageUrl,
      sigSoldFlags: manualSigSoldFlags,
      oneShotMarkSold: manualOneShotMarkSold,
    };
    try {
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      /* ignore quota/storage errors */
    }
    if (!authReady) return;
    if (!manualDraftHydratedRef.current) return;
    const tid = window.setTimeout(() => {
      const current = latestStateRef.current;
      if (!current) return;
      const payloadText = JSON.stringify(payload);
      if (manualDraftLastSavedRef.current === payloadText) return;
      manualDraftLastSavedRef.current = payloadText;
      const prevOverlaySettings =
        current.overlaySettings && typeof current.overlaySettings === "object"
          ? (current.overlaySettings as Record<string, unknown>)
          : {};
      const nextOverlaySettings: Record<string, unknown> = {
        ...prevOverlaySettings,
        [MANUAL_SIG_DRAFT_STATE_KEY]: payload,
      };
      const next: AppState = {
        ...current,
        overlaySettings: nextOverlaySettings,
        updatedAt: Date.now(),
      };
      void saveStateAsync(next, userId);
    }, 300);
    return () => window.clearTimeout(tid);
  }, [
    authReady,
    userId,
    manualInputMode,
    manualSigDrafts,
    manualOneShotName,
    manualOneShotPriceInput,
    manualOneShotImageUrl,
    manualSigSoldFlags,
    manualOneShotMarkSold,
  ]);

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
    spinQueuePinRef.current = { sessionId: "", queue: [] };
    usedWheelSliceIdsRef.current = new Set();
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    setWheelDemoMode(isWheelDemoHostAllowed(window.location.hostname));
  }, []);

  const wheelInventory = useMemo(
    () => mergeWheelDemoSigInventory(state?.sigInventory, wheelDemoMode),
    [state?.sigInventory, wheelDemoMode]
  );

  const activeNormalPool = useMemo(() => {
    if (!state) return [];
    const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
    return wheelInventory.filter(
      (x) =>
        x.isActive &&
        x.id !== ONE_SHOT_SIG_ID &&
        !excluded.has(x.id) &&
        x.soldCount < x.maxCount &&
        (wheelDemoMode || sigMatchesMemberFilter(x, memberFilterId))
    );
  }, [state, memberFilterId, wheelInventory, wheelDemoMode]);
  const menuCountSetting = useMemo(
    () => clampSigSalesMenuCount(state?.rouletteState?.menuCount),
    [state?.rouletteState?.menuCount]
  );
  const menuCountMin = useMemo(
    () => minSigSalesMenuCountForActive(activeNormalPool.length),
    [activeNormalPool.length]
  );
  const effectiveMenuCount = useMemo(() => {
    const setting = wheelDemoMode ? WHEEL_DEMO_MENU_COUNT : menuCountSetting;
    return resolveSigSalesMenuCount(setting, activeNormalPool.length);
  }, [menuCountSetting, activeNormalPool.length, wheelDemoMode]);
  const sigResultScalePct = useMemo(() => {
    const n = Number(state?.rouletteState?.sigResultScalePct);
    if (Number.isFinite(n)) return Math.max(50, Math.min(100, Math.floor(n)));
    return 78;
  }, [state?.rouletteState?.sigResultScalePct]);
  const menuFillFromAllActive = state?.rouletteState?.menuFillFromAllActive === true;
  const wheelDisplayPool = useMemo(() => {
    if (!state) return [];
    return buildSigSalesWheelDisplayPool({
      inventory: wheelInventory,
      sigSalesExcludedIds: state.sigSalesExcludedIds,
      sessionExcludedSigIds: state.rouletteState?.sessionExcludedSigIds,
      memberFilterId,
      menuCount: effectiveMenuCount,
      menuFillFromAllActive,
      ensureItems: [...(pendingLanding?.selected || []), ...(machine.selectedSigs || [])],
    });
  }, [
    state,
    wheelInventory,
    memberFilterId,
    effectiveMenuCount,
    menuFillFromAllActive,
    pendingLanding?.selected,
    machine.selectedSigs,
  ]);
  const spinQueueSelected = useMemo(() => {
    const resolved = resolveSpinQueueForSession(
      spinQueuePinRef.current,
      machine.sessionId || "",
      machine.selectedSigs || [],
      pendingLanding?.selected || [],
      MAX_SELECTED_SIGS
    );
    spinQueuePinRef.current = resolved.pin;
    return resolved.queue;
  }, [machine.selectedSigs, machine.sessionId, pendingLanding?.selected]);
  const useSequentialWheel = spinQueueSelected.length > 1;
  /** 회전·대기 화면 모두 메뉴 칸 수(5~20) 풀 — 당첨 큐만으로 1~N칸 휠을 만들지 않음(시청자 랜덤감) */
  const wheelMenuSlices = useMemo(
    () => buildWheelMenuSlices(wheelDisplayPool, effectiveMenuCount),
    [wheelDisplayPool, effectiveMenuCount]
  );

  useEffect(() => {
    const sid = String(machine.sessionId || "").trim();
    if (!sid || machine.phase === "IDLE") {
      setPinnedWheelLayout(null);
      usedWheelSliceIdsRef.current = new Set();
      return;
    }
    if (wheelMenuSlices.length === 0) return;
    if (
      machine.phase !== "SPINNING" &&
      machine.phase !== "LANDED" &&
      machine.phase !== "CONFIRM_PENDING" &&
      machine.phase !== "CONFIRMED"
    ) {
      return;
    }
    const queueSig = spinQueueSelected.map((s) => canonicalSigIdFromWheelSliceId(s.id)).join(",");
    setPinnedWheelLayout((prev) => {
      if (prev?.sessionId === sid && (prev.slices?.length ?? 0) > 0) return prev;
      return { sessionId: sid, queueSig, slices: wheelMenuSlices };
    });
  }, [machine.phase, machine.sessionId, wheelMenuSlices, spinQueueSelected]);

  const currentRoundWinner = spinQueueSelected[spinStep] ?? null;
  const priorRoundWinners = useMemo(
    () => spinQueueSelected.slice(0, Math.max(0, spinStep)),
    [spinQueueSelected, spinStep]
  );
  const wheelSpinning =
    machine.phase !== "LANDED" &&
    machine.phase !== "CONFIRM_PENDING" &&
    machine.phase !== "CONFIRMED" &&
    (Boolean(demoSpin) || machine.isRolling || machine.phase === "SPINNING");

  const wheelSlicesForSpin = useMemo(
    () =>
      resolveWheelSlicesForSpinVisual({
        menuPool: wheelDisplayPool,
        menuCount: effectiveMenuCount,
        pinnedSlices:
          pinnedWheelLayout?.sessionId === machine.sessionId
            ? pinnedWheelLayout.slices
            : null,
      }),
    [
      wheelDisplayPool,
      effectiveMenuCount,
      pinnedWheelLayout,
      machine.sessionId,
    ]
  );

  const wheelRoundBinding = useMemo(
    () =>
      bindWheelAnimationToRoundWinner({
        wheelSlices: wheelSlicesForSpin,
        roundWinner: currentRoundWinner,
        roundIndex: useSequentialWheel ? spinStep : 0,
        usedSliceIds: useSequentialWheel ? usedWheelSliceIdsRef.current : undefined,
        priorWinners: useSequentialWheel ? priorRoundWinners : undefined,
      }),
    [wheelSlicesForSpin, currentRoundWinner, useSequentialWheel, spinStep, priorRoundWinners]
  );
  const wheelItemsWithResult = wheelRoundBinding.items;
  const wheelResultSliceId = wheelRoundBinding.sliceId;
  const wheelAnimationResultId = wheelRoundBinding.animationResultId;
  const wheelTargetSliceIndex = wheelRoundBinding.targetSliceIndex;
  const displaySelectedSigs = useMemo(() => {
    const fromServer = (machine.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
    const fromStaged = stagedSelected.slice(0, MAX_SELECTED_SIGS);
    const fromManualPreview = manualPreviewSelected.slice(0, MAX_SELECTED_SIGS);
    const terminalPhase =
      machine.phase === "LANDED" ||
      machine.phase === "CONFIRM_PENDING" ||
      machine.phase === "CONFIRMED";
    /** 착지 후·폴링 복원: 서버 `selectedSigs`가 정본(순차 연출 중 `stagedSelected`가 3개만 남는 경우 방지) */
    if (terminalPhase && fromServer.length > 0) return fromServer;
    if (fromStaged.length > 0) return fromStaged;
    if (fromManualPreview.length > 0) return fromManualPreview;
    return fromServer;
  }, [machine.selectedSigs, stagedSelected, manualPreviewSelected, machine.phase]);
  const displaySelectedSigsForUi = useMemo(
    () =>
      displaySelectedSigs.map((s) => hydrateSigItemFromInventory(s, state?.sigInventory, userId)),
    [displaySelectedSigs, state?.sigInventory, userId]
  );
  const displayOneShot = useMemo(() => {
    if (displaySelectedSigs.length < MIN_ONE_SHOT_SIGS) return null;
    const base = buildOneShotFromSelected(displaySelectedSigs);
    if (!base) return null;
    const soldPrice = displaySelectedSigs.reduce((sum, item) => {
      const canon = canonicalSigIdFromWheelSliceId(String(item.id || ""));
      const sold = manualSoldSet.has(item.id) || manualSoldSet.has(canon);
      if (!sold) return sum;
      return sum + Math.max(0, Math.floor(Number(item.price || 0)));
    }, 0);
    return {
      ...base,
      price: Math.max(0, Math.floor(Number(base.price || 0)) - soldPrice),
    };
  }, [displaySelectedSigs, manualSoldSet]);
  const resultCardCount = useMemo(() => {
    let n = displaySelectedSigsForUi.length;
    if (displayOneShot && oneShotReveal) n += 1;
    return Math.max(1, n);
  }, [displaySelectedSigsForUi.length, displayOneShot, oneShotReveal]);
  const resultRowLayout = useMemo(
    () => layoutSigOverlayResultRow({ cellCount: resultCardCount, userScalePct: sigResultScalePct }),
    [resultCardCount, sigResultScalePct]
  );
  const targetSelectionCount = useMemo(() => {
    if (pendingLanding?.selected?.length) return Math.max(1, Math.min(MAX_SELECTED_SIGS, pendingLanding.selected.length));
    if (machine.selectedSigs?.length) return Math.max(1, Math.min(MAX_SELECTED_SIGS, machine.selectedSigs.length));
    return 1;
  }, [pendingLanding?.selected, machine.selectedSigs]);
  /** 당첨 쇼케이스 중에만 휠 숨김(IDLE·SPINNING·회전 중에는 항상 표시) */
  const showFinalShowcase =
    machine.phase !== "IDLE" &&
    machine.phase !== "SPINNING" &&
    !demoSpin &&
    !pendingLanding &&
    !loadingSpin &&
    (machine.phase === "LANDED" ||
      machine.phase === "CONFIRM_PENDING" ||
      machine.phase === "CONFIRMED") &&
    displaySelectedSigs.length >= targetSelectionCount;
  const oneShotImageUrl = useMemo(() => {
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    const fromOneShot = (oneShotItem?.imageUrl || "").trim();
    if (fromOneShot) return resolveSigAdminPreviewSrc(fromOneShot, oneShotItem?.name || "한방 시그", userId);
    const pick = displaySelectedSigsForUi.find((x) => (x.imageUrl || "").trim());
    if (pick) return resolveSigAdminPreviewSrc(pick.imageUrl, pick.name, userId);
    return BUNDLED_SIG_PLACEHOLDER_URL;
  }, [state?.sigInventory, displaySelectedSigsForUi, userId]);
  const manualParsedRows = useMemo(
    () =>
      manualSigDrafts.map((row) => {
        const name = String(row.name || "").trim();
        const digits = String(row.priceInput || "").replace(/[^\d]/g, "");
        const price = digits ? Math.max(0, Math.floor(Number.parseInt(digits, 10) || 0)) : 0;
        return {
          name,
          price,
          imageUrl: String(row.imageUrl || "").trim(),
        };
      }),
    [manualSigDrafts]
  );
  const manualInventoryOptions = useMemo(() => {
    const mergedSource: SigItem[] = [
      ...((state?.sigInventory || []) as SigItem[]),
      ...(activeNormalPool || []),
      ...(wheelInventory || []),
      ...(displaySelectedSigsForUi || []),
    ].filter((row) => row && row.id !== ONE_SHOT_SIG_ID);
    const uniq = new Map<string, { id: string; name: string; price: number; imageUrl: string }>();
    mergedSource.forEach((row) => {
      const id = String(row.id || "").trim();
      if (!id) return;
      const name = String(row.name || "").trim() || id;
      uniq.set(id, {
        id,
        name,
        price: Math.max(0, Math.floor(Number(row.price || 0))),
        imageUrl: String(row.imageUrl || "").trim(),
      });
    });
    return Array.from(uniq.values()).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [state?.sigInventory, activeNormalPool, wheelInventory, displaySelectedSigsForUi]);
  const manualAutoOneShotPrice = useMemo(
    () => manualParsedRows.reduce((sum, row) => sum + row.price, 0),
    [manualParsedRows]
  );
  const manualParsedOneShotPrice = useMemo(() => {
    const raw = String(manualOneShotPriceInput || "").replace(/[^\d]/g, "");
    if (!raw) return manualAutoOneShotPrice;
    return Math.max(0, Math.floor(Number.parseInt(raw, 10) || 0));
  }, [manualOneShotPriceInput, manualAutoOneShotPrice]);
  const manualReady = useMemo(() => {
    if (manualParsedRows.length !== 5) return false;
    if (manualParsedRows.some((row) => !row.name || row.price <= 0)) return false;
    const uniq = new Set(
      manualSigDrafts.map((row, idx) => {
        const sourceKey = String(row?.sourceSigId || "").trim();
        if (sourceKey) return `id:${sourceKey}`;
        return `name:${String(manualParsedRows[idx]?.name || "").toLowerCase()}`;
      })
    );
    if (uniq.size !== 5) return false;
    return true;
  }, [manualParsedRows, manualSigDrafts]);

  useEffect(() => {
    if (!authReady) return;
    if (manualInventoryOptions.length > 0) return;
    void loadRemote();
  }, [authReady, manualInventoryOptions.length, loadRemote]);

  useEffect(() => {
    if (!showFinalShowcase || !displayOneShot) {
      setOneShotReveal(false);
      return;
    }
    setOneShotReveal(true);
  }, [showFinalShowcase, displayOneShot]);

  useEffect(() => {
    if (
      machine.phase !== "LANDED" &&
      machine.phase !== "CONFIRM_PENDING" &&
      machine.phase !== "CONFIRMED"
    ) {
      return;
    }
    const fromServer = (machine.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
    if (fromServer.length === 0) return;
    setDemoSpin(null);
    setPendingLanding(null);
    setStagedSelected(fromServer);
    setSpinStep(0);
    setHighlightId(null);
    setLastConfirmedText("");
    if (nextSpinTimerRef.current) {
      clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = null;
    }
  }, [machine.phase, machine.selectedSigs]);

  /** OBS·서버가 먼저 착지(LANDED)했는데 관리자만 로컬 demoSpin 으로 휠이 도는 경우 */
  useEffect(() => {
    const fromServer = (machine.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
    if (fromServer.length === 0) return;
    if (machine.phase !== "SPINNING") return;
    if (machine.isRolling) return;
    if (!demoSpin && !pendingLanding) return;
    const oneShot = buildOneShotFromSelected(fromServer);
    setDemoSpin(null);
    setPendingLanding(null);
    setStagedSelected(fromServer);
    setSpinStep(0);
    landed(
      fromServer,
      oneShot,
      machine.resultId || fromServer[fromServer.length - 1]?.id || null
    );
  }, [
    machine.phase,
    machine.isRolling,
    machine.selectedSigs,
    machine.resultId,
    demoSpin,
    pendingLanding,
    landed,
  ]);

  useEffect(() => {
    if (!state?.members?.length) return;
    if (!memberFilterId) return;
    const exists = state.members.some((m) => m.id === memberFilterId);
    if (!exists) setMemberFilterId("");
  }, [state?.members, memberFilterId]);

  const persistRouletteState = useCallback(
    async (
      nextPartial:
        | Partial<AppState["rouletteState"]>
        | ((rs: NonNullable<AppState["rouletteState"]>) => Partial<AppState["rouletteState"]>)
    ) => {
      let snapshot: AppState | null = null;
      setState((prev) => {
        if (!prev) return prev;
        const base = prev.rouletteState || {};
        const patch = typeof nextPartial === "function" ? nextPartial(base) : nextPartial;
        snapshot = {
          ...prev,
          rouletteState: {
            ...base,
            ...patch,
          },
        };
        return snapshot;
      });
      if (!snapshot) return;
      await saveStateAsync(snapshot, userId);
    },
    [userId]
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
    void persistRouletteState((rs) => ({
      overlayReloadNonce: Number(rs.overlayReloadNonce || 0) + 1,
    }));
    setToast("오버레이 새로고침 신호를 보냈습니다.");
  }, [persistRouletteState]);

  const clearLocalSpinUi = useCallback(() => {
    if (nextSpinTimerRef.current) {
      clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = null;
    }
    setPendingLanding(null);
    setDemoSpin(null);
    setStagedSelected([]);
    setManualPreviewSelected([]);
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
      await persistRouletteState((rs) => ({
        overlayReloadNonce: Number(rs.overlayReloadNonce || 0) + 1,
      }));
    },
    [userId, clearLocalSpinUi, loadRemote, persistRouletteState]
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

  const onStartRoulette = useCallback(async () => {
    if (!authReady) return;
    if (loadingSpin) return;
    if (!memberFilterId && !wheelDemoMode) {
      setToast("회전 전 멤버를 먼저 선택해주세요.");
      return;
    }
    if (machine.isFinishLoading) {
      setToast("판매 확정 처리 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    if (activeNormalPool.length < 1) {
      setToast("선택한 멤버의 활성 시그가 없습니다. 멤버 시그를 추가/활성화해주세요.");
      return;
    }
    if (wheelMenuSlices.length < 1) {
      setToast("회전판 메뉴가 비었습니다. 활성 시그·회전판 칸 수를 확인하세요.");
      return;
    }
    const distinctAvailable = activeNormalPool.length;
    const requestedSpin = Math.max(1, Math.min(MAX_SELECTED_SIGS, Math.floor(cinematicSpinCount) || 5));
    const nSpin = Math.min(requestedSpin, distinctAvailable);
    setLoadingSpin(true);
    try {
      if (machine.phase === "CONFIRM_PENDING") {
        cancelConfirm();
        setShowConfirmModal(false);
      }
      if (machine.phase === "LANDED" || machine.phase === "CONFIRMED") {
        resetToIdle();
      }
      setPendingLanding(null);
      setDemoSpin(null);
      setStagedSelected([]);
      setSpinStep(0);
      setHighlightId(null);
      setResultsPanelCollapsed(false);
      if (nSpin < requestedSpin) {
        setToast(`당첨 시그 수를 활성 ${distinctAvailable}개에 맞춰 ${nSpin}회로 시작합니다.`);
      }
      const data = await spin({
        memberId: memberFilterId || null,
        force: true,
        spinCount: nSpin,
      });
      const selected = (data.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
      const oneShot = buildOneShotFromSelected(selected);
      setPendingLanding({ selected, oneShot, resultId: data.result?.id || selected[selected.length - 1]?.id || null, persist: true });
      const queueSig = selected.map((s) => canonicalSigIdFromWheelSliceId(s.id)).join(",");
      setPinnedWheelLayout({
        sessionId: String(data.sessionId || "").trim(),
        queueSig,
        slices: wheelMenuSlices,
      });
      usedWheelSliceIdsRef.current = new Set();
      setDemoSpin({
        startedAt: Date.now(),
        resultId: null,
      });
      setSpinStep(0);
      setStagedSelected([]);
      setHighlightId(null);
      confetti({ particleCount: 70, spread: 65, origin: { y: 0.25 } });
      setManualSoldSet(new Set());
      setOneShotSold(false);
      setShowConfirmModal(false);
      setState((prev) => {
        if (!prev) return prev;
        const ts = data.startedAt || Date.now();
        return {
          ...prev,
          updatedAt: Math.max(prev.updatedAt || 0, ts),
          rouletteState: {
            ...prev.rouletteState,
            phase: "SPINNING",
            isRolling: true,
            startedAt: ts,
            sessionId: data.sessionId || prev.rouletteState?.sessionId || "",
            result: data.result || null,
            results: selected,
            selectedSigs: selected,
            oneShotResult: oneShot,
            spinCount: selected.length,
          },
        };
      });
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      if (code === "spin_blocked") {
        setToast("이전 회전 상태가 남아 있습니다. 「다시 돌리기」 또는 「회전판 초기화」 후 시도하세요.");
        return;
      }
      if (code === "not_enough_active_sigs") {
        setToast(memberFilterId ? "선택 멤버의 활성 시그가 없습니다." : "활성 시그가 없습니다.");
        return;
      }
      if (code === "not_enough_distinct_sigs") {
        setToast(
          `서로 다른 시그가 부족합니다. 당첨 시그 수를 ${distinctAvailable} 이하로 줄이거나 활성 시그를 추가하세요.`
        );
        return;
      }
      const selected = pickWheelDemoWinners(
        Math.max(2, Math.min(MAX_SELECTED_SIGS, WHEEL_DEMO_WIN_COUNT))
      );
      const resultId = selected[selected.length - 1]?.id || null;
      setPendingLanding({
        selected,
        oneShot: buildOneShotFromSelected(selected),
        resultId,
        persist: false,
      });
      setDemoSpin({
        startedAt: Date.now(),
        resultId: null,
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
    wheelMenuSlices,
    wheelDemoMode,
  ]);

  const applyManualSelection = useCallback(async (confirmNow: boolean) => {
    if (!state) return;
    if (!manualReady) {
      setToast("수동 설정은 서로 다른 시그 5개를 모두 선택해야 합니다.");
      return;
    }
    if (manualParsedOneShotPrice <= 0) {
      setToast("한방 시그 금액을 확인해 주세요. (자동 합산 또는 직접 입력)");
      return;
    }
    const tsId = Date.now();
    const normalizeManualKey = (raw: string) => String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    const selected: SigItem[] = manualParsedRows.map((row, idx) => {
      const safeName = row.name.replace(/\s+/g, "_").replace(/[^\w가-힣-]/g, "").slice(0, 24) || `sig_${idx + 1}`;
      const sourceSigId = String(manualSigDrafts[idx]?.sourceSigId || "").trim();
      const matchedInventoryItem = (state.sigInventory || []).find((item) => {
        if (!item || item.id === ONE_SHOT_SIG_ID) return false;
        if (sourceSigId) return String(item.id || "").trim() === sourceSigId;
        const nameMatched = normalizeManualKey(item.name) === normalizeManualKey(row.name);
        const priceMatched = Math.floor(Number(item.price || 0)) === Math.floor(Number(row.price || 0));
        return nameMatched && priceMatched;
      });
      return {
        id: matchedInventoryItem?.id || `manual_sig_${tsId}_${idx + 1}_${safeName}`,
        name: row.name,
        price: row.price,
        imageUrl: row.imageUrl,
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      };
    });
    setManualDebugInfo(
      `selected=${selected.length} | ${selected
        .map((x) => `${x.name}:${Math.max(0, Math.floor(Number(x.price || 0))).toLocaleString("ko-KR")}`)
        .join(" / ")}`
    );
    const oneShot = {
      id: ONE_SHOT_SIG_ID,
      name: String(manualOneShotName || "").trim() || "한방 시그",
      price: manualParsedOneShotPrice,
    };
    const now = Date.now();
    const sessionId = `manual_${now}`;
    const oneShotImage = String(manualOneShotImageUrl || "").trim();
    const inventoryWithOneShotImage = (state.sigInventory || []).map((row) =>
      row.id === ONE_SHOT_SIG_ID && oneShotImage ? { ...row, imageUrl: oneShotImage } : row
    );

    setManualBusy(true);
    try {
      const landedState: AppState = {
        ...state,
        sigInventory: inventoryWithOneShotImage,
        rouletteState: {
          ...state.rouletteState,
          phase: "LANDED",
          isRolling: false,
          startedAt: now,
          sessionId,
          result: selected[selected.length - 1] || null,
          results: selected,
          selectedSigs: selected,
          oneShotResult: oneShot,
          spinCount: selected.length,
        },
        updatedAt: now,
      };
      landed(selected, oneShot, selected[selected.length - 1]?.id || null);
      setState(landedState);
      setPendingLanding(null);
      setDemoSpin(null);
      setStagedSelected(selected);
      setManualPreviewSelected(selected);
      setSpinStep(0);
      setHighlightId(null);
      setManualSoldSet(
        new Set(
          selected
            .filter((_, idx) => Boolean(manualSigSoldFlags[idx]))
            .map((row) => row.id)
        )
      );
      setOneShotSold(manualOneShotMarkSold);
      setShowConfirmModal(false);
      setResultsPanelCollapsed(false);
      const landedSaved = await saveStateAsync(landedState, userId);
      if (!landedSaved.ok) {
        setToast("수동 결과는 먼저 표시했지만 서버 저장이 지연됩니다. 잠시 후 다시 확인해 주세요.");
      }

      if (!confirmNow) {
        setToast("수동 5개/한방 설정 적용 완료. 아래 Confirm Sale로 판매 완료 처리할 수 있습니다.");
        return;
      }

      const normalizeNameKey = (raw: string) => String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
      const soldTargetIds = new Set<string>();
      selected.forEach((row) => {
        const byId = canonicalSigIdFromWheelSliceId(String(row?.id || ""));
        if (byId && inventoryWithOneShotImage.some((x) => x.id === byId)) {
          soldTargetIds.add(byId);
          return;
        }
        const byNamePrice = inventoryWithOneShotImage.find((x) => {
          if (!x || x.id === ONE_SHOT_SIG_ID) return false;
          const nameMatched = normalizeNameKey(x.name) === normalizeNameKey(row.name);
          const priceMatched = Math.floor(Number(x.price || 0)) === Math.floor(Number(row.price || 0));
          return nameMatched && priceMatched;
        });
        if (byNamePrice?.id) soldTargetIds.add(byNamePrice.id);
      });
      const confirmedInventory = inventoryWithOneShotImage.map((row) => {
        if (row.id === ONE_SHOT_SIG_ID) {
          const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
          const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
          const nextSold = Math.min(maxCount, soldCount + 1);
          return {
            ...row,
            soldCount: nextSold,
            isActive: nextSold >= maxCount ? false : row.isActive,
          };
        }
        const key = canonicalSigIdFromWheelSliceId(String(row.id || ""));
        const delta = soldTargetIds.has(key) ? 1 : 0;
        if (!delta) return row;
        const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
        const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
        const nextSold = Math.min(maxCount, soldCount + delta);
        return {
          ...row,
          soldCount: nextSold,
          isActive: nextSold >= maxCount ? false : row.isActive,
        };
      });
      const soldPreviewSet = new Set(selected.map((row) => row.id));
      setManualSoldSet(soldPreviewSet);
      setOneShotSold(Boolean(oneShot));
      await finish({
        sessionId,
        selectedSigs: selected,
        oneShotResult: oneShot,
        finalPhase: "CONFIRMED",
      });
      const confirmedAt = Date.now();
      const confirmedState: AppState = {
        ...landedState,
        sigInventory: confirmedInventory,
        rouletteState: {
          ...landedState.rouletteState,
          phase: "CONFIRMED",
          isRolling: false,
          lastFinishedAt: confirmedAt,
          selectedSigs: selected,
          oneShotResult: oneShot,
          sessionId,
        },
        updatedAt: confirmedAt,
      };
      const confirmedSaved = await saveStateAsync(confirmedState, userId);
      if (confirmedSaved.ok) {
        setManualSoldSet(new Set(selected.map((row) => row.id)));
        setOneShotSold(Boolean(oneShot));
        setState(confirmedState);
        setToast("수동 5개 판매 완료 처리까지 반영했습니다.");
      } else {
        setToast("판매 완료 API는 반영됐지만 최종 상태 저장이 지연됩니다. 새로고침 후 확인해 주세요.");
        void loadRemote();
      }
    } catch (e) {
      setManualDebugInfo((prev) => `${prev} | error=${String(e)}`);
      setToast(`수동 설정 처리 실패: ${String(e)}`);
    } finally {
      setManualBusy(false);
    }
  }, [
    state,
    manualReady,
    manualParsedOneShotPrice,
    manualParsedRows,
    manualSigDrafts,
    manualOneShotName,
    manualOneShotImageUrl,
    manualSigSoldFlags,
    manualOneShotMarkSold,
    userId,
    landed,
    finish,
    loadRemote,
  ]);

  const uploadManualSigImage = useCallback(async (file: File | null): Promise<string | null> => {
    if (!file) return null;
    const mime = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    const isAllowedMime = /image\/(gif|png|jpe?g|webp)/i.test(mime);
    const isAllowedExt = /\.(gif|png|jpe?g|webp)$/i.test(name);
    if (!isAllowedMime && !isAllowedExt) {
      setToast("gif/png/jpg/webp 파일만 업로드 가능합니다.");
      return null;
    }
    if (file.size > MAX_SIG_UPLOAD_BYTES) {
      setToast(`이미지 용량이 30MB를 초과했습니다. (${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
      return null;
    }
    const fd = new FormData();
    fd.append("file", file);
    const uid = String(userId || "finalent").trim() || "finalent";
    const q = new URLSearchParams();
    q.set("user", uid);
    q.set("u", uid);
    const uploadUrl = `/api/upload/sig-image?${q.toString()}`;
    try {
      const res = await fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        headers: { "x-user-id": uid },
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !j.ok || !j.url) {
        setToast(`이미지 업로드 실패: ${String(j.error || res.status)}`);
        return null;
      }
      return String(j.url);
    } catch (e) {
      setToast(`이미지 업로드 오류: ${String(e)}`);
      return null;
    }
  }, [userId]);

  const handleManualRowFileUpload = useCallback(async (idx: number, file: File | null) => {
    if (!file) return;
    setManualRowUploadBusy((prev) => ({ ...prev, [idx]: true }));
    try {
      const url = await uploadManualSigImage(file);
      if (!url) return;
      setManualSigDrafts((prev) => {
        const next = [...prev];
        next[idx] = { ...(next[idx] || { name: "", priceInput: "", imageUrl: "" }), imageUrl: url };
        return next;
      });
      setToast(`${idx + 1}번째 시그 이미지 업로드 완료`);
    } finally {
      setManualRowUploadBusy((prev) => ({ ...prev, [idx]: false }));
    }
  }, [uploadManualSigImage]);

  const handleManualOneShotFileUpload = useCallback(async (file: File | null) => {
    if (!file) return;
    setManualOneShotUploadBusy(true);
    try {
      const url = await uploadManualSigImage(file);
      if (!url) return;
      setManualOneShotImageUrl(url);
      setToast("한방 이미지 업로드 완료");
    } finally {
      setManualOneShotUploadBusy(false);
    }
  }, [uploadManualSigImage]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams();
    q.set("u", userId);
    if (memberFilterId) q.set("memberId", memberFilterId);
    q.set("menuCount", String(effectiveMenuCount));
    if (wheelDemoMode) {
      q.set("wheelDemo", "1");
      q.set("menuCount", String(WHEEL_DEMO_MENU_COUNT));
      q.set("wheelDemoWins", String(WHEEL_DEMO_WIN_COUNT));
      q.set("wheelDemoAuto", "1");
    }
    const rs = Number(state?.rouletteState?.sigResultScalePct);
    if (Number.isFinite(rs)) q.set("sigResultScalePct", String(Math.floor(rs)));
    setOverlayObsUrl(`${window.location.origin}/overlay/sig-sales?${q.toString()}`);
    const qManual = new URLSearchParams();
    qManual.set("u", userId);
    if (memberFilterId) qManual.set("memberId", memberFilterId);
    qManual.set("menuCount", String(effectiveMenuCount));
    if (Number.isFinite(rs)) qManual.set("sigResultScalePct", String(Math.floor(rs)));
    qManual.set("mode", "manual");
    qManual.set("hideSigBoard", "1");
    /**
     * 개발 중 코드 수정/서버 재시작(메모리 state 초기화) 시에도 수동 오버레이가 비지 않도록
     * URL에 핵심 텍스트 데이터(이름/금액)만 함께 싣는다. (이미지 URL은 길이 증가로 제외)
     */
    manualSigDrafts.forEach((row, idx) => {
      const n = idx + 1;
      const name = String(row?.name || "").trim();
      const priceDigits = String(row?.priceInput || "").replace(/[^\d]/g, "");
      if (name) qManual.set(`m${n}n`, name);
      if (priceDigits) qManual.set(`m${n}p`, priceDigits);
    });
    const oneShotName = String(manualOneShotName || "").trim();
    const oneShotPriceDigits = String(manualOneShotPriceInput || "").replace(/[^\d]/g, "");
    if (oneShotName) qManual.set("osn", oneShotName);
    if (oneShotPriceDigits) qManual.set("osp", oneShotPriceDigits);
    setOverlayObsUrlManual(`${window.location.origin}/overlay/sig-sales?${qManual.toString()}`);
  }, [
    userId,
    memberFilterId,
    effectiveMenuCount,
    wheelDemoMode,
    state?.rouletteState?.sigResultScalePct,
    manualSigDrafts,
    manualOneShotName,
    manualOneShotPriceInput,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const view = new URLSearchParams(window.location.search).get("view") === "manual" ? "manual" : "default";
    setInitialView(view);
  }, []);

  useEffect(() => {
    if (initialView !== "manual") return;
    setOverlayObsMode("manual");
    const tid = window.setTimeout(() => {
      manualSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
    return () => window.clearTimeout(tid);
  }, [initialView]);

  const onConfirmSale = useCallback(async () => {
    if (!state || displaySelectedSigs.length === 0) return;
    setShowConfirmModal(false);
    if (wheelDemoMode) {
      setManualSoldSet(new Set(displaySelectedSigs.map((x) => x.id)));
      setOneShotSold(Boolean(displayOneShot));
      const finishedAt = Date.now();
      setState((prev) =>
        prev
          ? {
              ...prev,
              rouletteState: {
                ...prev.rouletteState,
                phase: "CONFIRMED",
                isRolling: false,
                lastFinishedAt: finishedAt,
                selectedSigs: displaySelectedSigs,
                oneShotResult: displayOneShot ?? prev.rouletteState?.oneShotResult ?? null,
              },
              updatedAt: finishedAt,
            }
          : prev
      );
      setToast("데모 판매 확정 완료 (로컬 연출만·데모 시그 재고는 서버에 저장되지 않음)");
      confetti({ particleCount: 110, spread: 80, origin: { y: 0.22 } });
      return;
    }
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
    const normalizeNameKey = (raw: string) => String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    const selectedNamePriceSet = new Set(
      displaySelectedSigs.map((x) => `${normalizeNameKey(x.name)}::${Math.floor(Number(x.price || 0))}`)
    );
    /** 판매 확정 시: 이번 회차 당첨 시그는 모두 재고 +1. 한방 카드 토글(oneShotSold) 없이도 반영되도록 함 */
    const soldAppliedNames: string[] = [];
    const nextInventory = state.sigInventory.map((item) => {
      const itemCanon = canonicalSigIdFromWheelSliceId(item.id);
      const markSold =
        manualCanon.has(itemCanon) ||
        selectedCanon.has(itemCanon) ||
        selectedNamePriceSet.has(`${normalizeNameKey(item.name)}::${Math.floor(Number(item.price || 0))}`) ||
        (item.id === ONE_SHOT_SIG_ID && Boolean(displayOneShot));
      if (!markSold) return item;
      const maxCount = Math.max(1, Math.floor(Number(item.maxCount || 1)));
      const soldCount = Math.max(0, Math.floor(Number(item.soldCount || 0)));
      const nextSold = Math.min(maxCount, soldCount + 1);
      soldAppliedNames.push(String(item.name || item.id || "").trim() || item.id);
      return {
        ...item,
        soldCount: nextSold,
        isActive: nextSold >= maxCount ? false : item.isActive,
      };
    });
    const soldPreviewSet = new Set(displaySelectedSigs.map((x) => x.id));
    setManualSoldSet(soldPreviewSet);
    setOneShotSold(Boolean(displayOneShot));
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
      setManualSoldSet(new Set(displaySelectedSigs.map((x) => x.id)));
      setOneShotSold(Boolean(displayOneShot));
      setState(next);
      void loadHistory(8);
      setToast(
        soldAppliedNames.length > 0
          ? `판매 확정 완료! 반영: ${soldAppliedNames.slice(0, 6).join(", ")}${soldAppliedNames.length > 6 ? " 외" : ""}`
          : "판매 확정 완료! (반영 대상 없음)"
      );
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
    wheelDemoMode,
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
              현재 상태: {machine.phase} · 회전판 {effectiveMenuCount}칸
              {activeNormalPool.length > 0 ? ` (활성 시그 ${activeNormalPool.length}개)` : ""}
              {effectiveMenuCount > menuCountSetting
                ? ` · 설정 ${menuCountSetting} → 최소 ${menuCountMin}칸 적용`
                : ""}
              {menuFillFromAllActive ? " · 전체 활성으로 풀 보충" : ""}
            </p>
            {authReady && !memberFilterId && !wheelDemoMode ? (
              <p className="mt-1 text-xs font-semibold text-amber-300">
                「회전판 시작」 전 상단에서 멤버를 선택하세요. (미선택 시 버튼이 동작하지 않습니다)
              </p>
            ) : null}
            {wheelDemoMode ? (
              <p className="mt-1 text-xs text-emerald-200/90">
                로컬 휠 데모: 멤버 없이 「회전판 시작」 가능 · 판매 확정은 서버 재고에 반영되지 않습니다. 연출 확인은
                「연출+판매 데모」 또는 OBS URL을 사용하세요.
              </p>
            ) : null}
            {overlayObsUrl ? (
              <p className="mt-2 max-w-xl text-[11px] text-neutral-400">
                OBS 소스 URL (u={userId}
                {memberFilterId ? ` · memberId=${memberFilterId}` : ""}):{" "}
                <code className="break-all text-emerald-300/90">
                  {overlayObsMode === "manual" ? overlayObsUrlManual : overlayObsUrl}
                </code>
                {wheelDemoMode ? (
                  <span className="mt-1 block text-amber-200/90">
                    로컬 휠 데모 · 회전판 {WHEEL_DEMO_MENU_COUNT}칸 · 당첨 {WHEEL_DEMO_WIN_COUNT}개 + 한방 시그(서버 미저장)
                  </span>
                ) : null}
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
                min={menuCountMin}
                max={20}
                value={menuCountSetting}
                disabled={controlsDisabled}
                title={`활성 시그보다 많은 칸(최소 ${menuCountMin}). 표시는 ${effectiveMenuCount}칸`}
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
            {wheelDemoMode ? (
              <>
                <button
                  type="button"
                  className="rounded bg-emerald-700 px-3 py-2 text-xs font-bold hover:bg-emerald-600"
                  onClick={() => {
                    window.open(
                      `${window.location.origin}${getWheelDemoPlaythroughAutoPath()}`,
                      "_blank",
                      "noopener,noreferrer"
                    );
                  }}
                >
                  연출+판매 데모
                </button>
                <button
                  type="button"
                  className="rounded border border-sky-500/50 bg-sky-950/40 px-3 py-2 text-xs font-bold text-sky-100 hover:bg-sky-900/50"
                  onClick={() => {
                    window.open(
                      `${window.location.origin}${getSigSalesWheelDemoOverlayPath(userId)}`,
                      "_blank",
                      "noopener,noreferrer"
                    );
                  }}
                >
                  OBS 5회전 데모
                </button>
                <button
                  type="button"
                  className="rounded border border-white/20 px-3 py-2 text-xs hover:bg-white/10"
                  onClick={() => {
                    window.open(
                      `${window.location.origin}${getWheelDemoOverlayPath(userId)}`,
                      "_blank",
                      "noopener,noreferrer"
                    );
                  }}
                >
                  착지 정합 점검
                </button>
              </>
            ) : null}
            {overlayObsUrl ? (
              <select
                value={overlayObsMode}
                onChange={(e) => setOverlayObsMode(e.target.value === "manual" ? "manual" : "wheel")}
                className="rounded border border-white/20 bg-neutral-900 px-2 py-2 text-xs text-neutral-200"
                title="OBS 오버레이 표시 모드"
              >
                <option value="wheel">회전판 모드 URL</option>
                <option value="manual">수동 결과 모드 URL</option>
              </select>
            ) : null}
            {overlayObsUrl ? (
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-2 text-xs text-neutral-200 hover:bg-white/10"
                onClick={() => {
                  const targetUrl = overlayObsMode === "manual" ? overlayObsUrlManual : overlayObsUrl;
                  void navigator.clipboard.writeText(targetUrl);
                  setToast("OBS URL을 복사했습니다.");
                }}
              >
                OBS URL 복사
              </button>
            ) : null}
            {overlayObsUrlManual ? (
              <>
                <button
                  type="button"
                  className="rounded border border-sky-400/50 bg-sky-950/40 px-2 py-2 text-xs text-sky-100 hover:bg-sky-900/50"
                  onClick={() => {
                    void navigator.clipboard.writeText(overlayObsUrlManual);
                    setToast("수동 결과 URL을 복사했습니다.");
                  }}
                >
                  수동 URL 복사
                </button>
                <button
                  type="button"
                  className="rounded bg-sky-700 px-2 py-2 text-xs font-bold text-white hover:bg-sky-600"
                  onClick={() => {
                    window.open(overlayObsUrlManual, "_blank", "noopener,noreferrer");
                  }}
                >
                  수동 오버레이 열기
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (!memberFilterId && !wheelDemoMode) {
                  setToast("회전 전 멤버를 먼저 선택해주세요.");
                  return;
                }
                void onStartRoulette();
              }}
              disabled={loadingSpin}
              title={!memberFilterId && !wheelDemoMode ? "멤버 선택 후 시작" : undefined}
              className={`rounded px-4 py-2 text-sm font-bold disabled:opacity-50 ${
                memberFilterId || wheelDemoMode
                  ? "bg-fuchsia-700 hover:bg-fuchsia-600"
                  : "cursor-not-allowed bg-fuchsia-900/50 text-fuchsia-200/70"
              }`}
            >
              {loadingSpin ? "추첨 준비중..." : "회전판 시작"}
            </button>
          </div>
        </header>
        {overlayObsUrlManual ? (
          <section className="rounded border border-sky-400/35 bg-sky-500/10 px-3 py-2">
            <div className="text-[11px] font-semibold text-sky-200">수동 모드 전용 URL (항상 이 URL 사용)</div>
            <code className="mt-1 block break-all text-[11px] text-sky-100/95">{overlayObsUrlManual}</code>
          </section>
        ) : null}

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

        <section ref={manualSectionRef} className="rounded-xl border border-sky-300/30 bg-sky-500/10 p-3">
          <div className="mb-2 text-sm font-semibold text-sky-100">수동 설정(5개 + 한방)</div>
          <p className="mb-3 text-[11px] text-sky-100/85">
            2가지 방식 지원: 완전 수동 입력 / 기존 시그 선택.
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-sky-100">
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="manual-input-mode"
                checked={manualInputMode === "free"}
                onChange={() => setManualInputMode("free")}
              />
              완전 수동 입력
            </label>
            <label className="inline-flex items-center gap-1">
              <input
                type="radio"
                name="manual-input-mode"
                checked={manualInputMode === "inventory"}
                onChange={() => setManualInputMode("inventory")}
              />
              기존 시그 선택
            </label>
          </div>
          <div className="space-y-2">
            {manualInventoryOptions.length === 0 ? (
              <div className="rounded border border-amber-300/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-100">
                기존 시그 목록을 불러오는 중입니다. 잠시 후 다시 확인하거나 페이지 새로고침을 해주세요.
              </div>
            ) : null}
            {Array.from({ length: 5 }, (_, idx) => (
              <div key={`manual-row-${idx}`} className="grid gap-2 rounded border border-white/10 bg-black/20 p-2 sm:grid-cols-3">
                <label className="flex flex-col text-[11px] text-neutral-300 sm:col-span-3">
                  {idx + 1}번째 기존 시그 선택(선택 시 자동 채움)
                  <select
                    className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                    value={manualSigDrafts[idx]?.sourceSigId || ""}
                    onChange={(e) => {
                      const selectedId = String(e.target.value || "");
                      const picked = manualInventoryOptions.find((x) => x.id === selectedId);
                      setManualSigDrafts((prev) => {
                        const next = [...prev];
                        if (!selectedId || !picked) {
                          next[idx] = { sourceSigId: "", name: "", priceInput: "", imageUrl: "" };
                          return next;
                        }
                        next[idx] = {
                          sourceSigId: picked.id,
                          name: picked.name,
                          priceInput: String(picked.price || ""),
                          imageUrl: picked.imageUrl,
                        };
                        return next;
                      });
                    }}
                  >
                    <option value="">직접 입력(완전 수동)</option>
                    {manualInventoryOptions.map((opt) => (
                      <option key={`manual-opt-${idx}-${opt.id}`} value={opt.id}>
                        {opt.name} ({opt.price.toLocaleString("ko-KR")}원)
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col text-[11px] text-neutral-300">
                  {idx + 1}번째 시그 이름
                  <input
                    type="text"
                    className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                    value={manualSigDrafts[idx]?.name || ""}
                    onChange={(e) =>
                      setManualSigDrafts((prev) => {
                        const next = [...prev];
                        next[idx] = {
                          ...(next[idx] || { sourceSigId: "", name: "", priceInput: "", imageUrl: "" }),
                          sourceSigId: manualInputMode === "free" ? "" : (next[idx]?.sourceSigId || ""),
                          name: e.target.value,
                        };
                        return next;
                      })
                    }
                    placeholder={`시그 ${idx + 1}`}
                  />
                </label>
                <label className="flex flex-col text-[11px] text-neutral-300">
                  금액(원)
                  <input
                    type="text"
                    inputMode="numeric"
                    className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                    value={manualSigDrafts[idx]?.priceInput || ""}
                    onChange={(e) =>
                      setManualSigDrafts((prev) => {
                        const next = [...prev];
                        next[idx] = {
                          ...(next[idx] || { sourceSigId: "", name: "", priceInput: "", imageUrl: "" }),
                          sourceSigId: manualInputMode === "free" ? "" : (next[idx]?.sourceSigId || ""),
                          priceInput: e.target.value,
                        };
                        return next;
                      })
                    }
                    placeholder="예: 100000"
                  />
                </label>
                <label className="flex flex-col text-[11px] text-neutral-300">
                  이미지 URL(선택)
                  <input
                    type="text"
                    className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                    value={manualSigDrafts[idx]?.imageUrl || ""}
                    onChange={(e) =>
                      setManualSigDrafts((prev) => {
                        const next = [...prev];
                        next[idx] = {
                          ...(next[idx] || { sourceSigId: "", name: "", priceInput: "", imageUrl: "" }),
                          sourceSigId: manualInputMode === "free" ? "" : (next[idx]?.sourceSigId || ""),
                          imageUrl: e.target.value,
                        };
                        return next;
                      })
                    }
                    placeholder="/uploads/sig.gif"
                  />
                  <input
                    type="file"
                    accept="image/gif,image/png,image/jpeg,image/webp"
                    className="mt-1 text-[11px] text-neutral-300 file:mr-2 file:rounded file:border-0 file:bg-sky-700 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-sky-600"
                    onChange={(e) => {
                      const file = e.currentTarget.files?.[0] || null;
                      void handleManualRowFileUpload(idx, file);
                      e.currentTarget.value = "";
                    }}
                  />
                  {manualRowUploadBusy[idx] ? (
                    <span className="mt-1 text-[11px] text-sky-200">업로드 중...</span>
                  ) : null}
                  <label className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-200">
                    <input
                      type="checkbox"
                      checked={Boolean(manualSigSoldFlags[idx])}
                      onChange={(e) =>
                        setManualSigSoldFlags((prev) => {
                          const next = [...prev];
                          next[idx] = e.target.checked;
                          return next;
                        })
                      }
                    />
                    이 시그 판매완료 처리
                  </label>
                </label>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col text-[11px] text-neutral-300">
              한방 시그 이름
              <input
                type="text"
                className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                value={manualOneShotName}
                onChange={(e) => setManualOneShotName(e.target.value)}
                placeholder="한방 시그"
              />
            </label>
            <label className="flex flex-col text-[11px] text-neutral-300">
              한방 시그 금액(빈칸=자동합산)
              <input
                type="text"
                inputMode="numeric"
                className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                value={manualOneShotPriceInput}
                onChange={(e) => setManualOneShotPriceInput(e.target.value)}
                placeholder={manualAutoOneShotPrice.toLocaleString("ko-KR")}
              />
            </label>
            <label className="flex flex-col text-[11px] text-neutral-300">
              한방 이미지 URL(선택)
              <input
                type="text"
                className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                value={manualOneShotImageUrl}
                onChange={(e) => setManualOneShotImageUrl(e.target.value)}
                placeholder="/uploads/one-shot.gif"
              />
              <input
                type="file"
                accept="image/gif,image/png,image/jpeg,image/webp"
                className="mt-1 text-[11px] text-neutral-300 file:mr-2 file:rounded file:border-0 file:bg-emerald-700 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white hover:file:bg-emerald-600"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0] || null;
                  void handleManualOneShotFileUpload(file);
                  e.currentTarget.value = "";
                }}
              />
              {manualOneShotUploadBusy ? (
                <span className="mt-1 text-[11px] text-emerald-200">업로드 중...</span>
              ) : null}
              <label className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-200">
                <input
                  type="checkbox"
                  checked={manualOneShotMarkSold}
                  onChange={(e) => setManualOneShotMarkSold(e.target.checked)}
                />
                한방도 판매완료 처리
              </label>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-black/30 px-2 py-1 text-neutral-300">
              자동합산: {manualAutoOneShotPrice.toLocaleString("ko-KR")}원
            </span>
            <span className="rounded bg-black/30 px-2 py-1 text-neutral-300">
              적용금액: {manualParsedOneShotPrice.toLocaleString("ko-KR")}원
            </span>
            <button
              type="button"
              disabled={manualBusy || !manualReady}
              className="rounded bg-sky-700 px-3 py-1.5 font-semibold text-sky-50 hover:bg-sky-600 disabled:opacity-50"
              onClick={() => void applyManualSelection(false)}
            >
              {manualBusy ? "처리 중..." : "수동 결과 적용(LANDED)"}
            </button>
            <button
              type="button"
              disabled={manualBusy || !manualReady}
              className="rounded bg-emerald-700 px-3 py-1.5 font-semibold text-emerald-50 hover:bg-emerald-600 disabled:opacity-50"
              onClick={() => void applyManualSelection(true)}
            >
              {manualBusy ? "처리 중..." : "수동 적용 + 판매 완료(CONFIRMED)"}
            </button>
          </div>
          {manualDebugInfo ? (
            <div className="mt-2 rounded border border-fuchsia-300/40 bg-fuchsia-500/10 px-2 py-1 text-[11px] text-fuchsia-100 break-all">
              디버그: {manualDebugInfo}
            </div>
          ) : null}
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
            isRolling={wheelSpinning}
            resultId={wheelSpinning ? wheelAnimationResultId : null}
            targetSliceIndex={wheelSpinning ? wheelTargetSliceIndex : null}
            startedAt={demoSpin?.startedAt || machine.startedAt}
            spinReplayNonce={spinStep}
            volume={volume}
            muted={muted}
            onLanded={(landedId) => {
              if (!pendingLanding) return;
              const selectedQueue = (
                pendingLanding?.selected?.length
                  ? pendingLanding.selected
                  : spinQueueSelected
              ).slice(0, MAX_SELECTED_SIGS);
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
                rememberUsedWheelSliceId(
                  usedWheelSliceIdsRef.current,
                  landedId || wheelResultSliceId
                );
                setStagedSelected(nextSelected);
                if (nextSpinTimerRef.current) clearTimeout(nextSpinTimerRef.current);
                nextSpinTimerRef.current = setTimeout(() => {
                  /** 착지 직후 spinStep+1 → 휠이 다음 회차 시그로 재바인딩됨. 다음 회전 시작 직전에만 증가 */
                  setSpinStep(nextStep);
                  setLastConfirmedText("");
                  setDemoSpin({
                    startedAt: Date.now(),
                    resultId: null,
                  });
                }, STEP_CONFIRM_PAUSE_MS);
                return;
              }

              const finalSelected = nextSelected;
              const oneShot = buildOneShotFromSelected(finalSelected);
              landed(
                finalSelected,
                oneShot,
                wheelAnimationResultId || current.id || finalSelected[finalSelected.length - 1]?.id || null
              );
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
              void persistRouletteState({
                phase: "LANDED",
                isRolling: false,
                selectedSigs: finalSelected,
                results: finalSelected,
                oneShotResult: oneShot,
                result: finalSelected[finalSelected.length - 1] || null,
                spinCount: finalSelected.length,
                sessionId: snapSession,
                startedAt: snapStarted,
              });
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

          {(machine.phase === "SPINNING" || machine.phase === "LANDED" || machine.phase === "CONFIRM_PENDING" || machine.phase === "CONFIRMED" || stagedSelected.length > 0 || manualPreviewSelected.length > 0) &&
          displaySelectedSigs.length > 0 ? (
            <div
              className={
                showFinalShowcase
                  ? "mt-4 flex w-full flex-col items-center space-y-3"
                  : "mt-4 space-y-3"
              }
            >
              {showFinalShowcase ? (
                <div className="flex w-full max-w-full flex-wrap items-center justify-between gap-2 px-1">
                  <p className="text-sm font-semibold text-yellow-100">
                    당첨 시그 {displaySelectedSigsForUi.length}개
                    {displayOneShot ? " + 한방 시그" : ""}
                  </p>
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
              <div
                className="mx-auto flex w-full max-w-full justify-center overflow-visible px-1"
                style={resultRowLayout.bandStyle}
              >
                <SelectedSigs
                  items={displaySelectedSigsForUi}
                  sigImageUserId={userId}
                  soldOutStampUrl={soldOutStampUrl}
                  manualSoldSet={manualSoldSet}
                  disabled={controlsDisabled}
                  highlightId={highlightId}
                  compact
                  matchOneShotCardSize
                  cardScalePct={resultRowLayout.cardScalePct}
                  disableCardMotion={showFinalShowcase}
                  compactGridJustify="center"
                  className="w-full max-w-full"
                  trailingSlot={
                    displayOneShot && oneShotReveal ? (
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
                        matchSigCardSize
                        cardScalePct={resultRowLayout.cardScalePct}
                        disableCardMotion={showFinalShowcase}
                        showToggle
                        onToggleSold={() => setOneShotSold((v) => !v)}
                      />
                    ) : null
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
              </div>
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
                  <div className="mt-1 text-[11px] text-neutral-400" suppressHydrationWarning>
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
