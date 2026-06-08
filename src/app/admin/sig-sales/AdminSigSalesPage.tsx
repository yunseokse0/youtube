"use client";

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
  DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
  DEFAULT_SIG_SOLD_STAMP_URL,
  isDedicatedOneShotSigImageUrl,
  resolveSigAdminPreviewSrc,
} from "@/lib/constants";
import {
  buildRouletteIdlePreserveSettings,
  loadState,
  loadStateFromApi,
  saveSigSalesManualStateAsync,
  storageKey,
  type AppState,
} from "@/lib/state";
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
import { dedupeSigInventory } from "@/lib/sig-inventory-dedup";
import { formatSigImageUploadFailureMessage } from "@/lib/sig-upload-errors";
import {
  WHEEL_DEMO_MENU_COUNT,
  WHEEL_DEMO_WIN_COUNT,
  getWheelDemoOverlayPath,
  getWheelDemoPlaythroughAutoPath,
  getWheelDemoPlaythroughPath,
  getSigSalesWheelDemoOverlayPath,
  isWheelDemoHostAllowed,
  isWheelDemoModeFromSearchParams,
  mergeWheelDemoSigInventory,
  pickWheelDemoWinners,
} from "@/lib/sig-wheel-demo-pool";
import { stripBundledSigPlaceholderItems } from "@/lib/sig-placeholder";
import {
  buildOneShotFromSelected,
  computeNetOneShotPrice,
  resolveOneShotDisplayPrice,
} from "@/lib/sig-one-shot-price";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  buildSigSalesManualOverlayUrl,
  buildSigSalesWheelOverlayUrl,
} from "@/lib/sig-sales-overlay-urls";
import {
  buildManualRoundResetPatch,
  isManualOverlaySessionId,
  MANUAL_OVERLAY_SESSION_ID,
} from "@/lib/sig-sales-manual-round";
import {
  enrichManualDraftsWithInventoryImageUrls,
  hydrateManualOverlaySigItem,
} from "@/lib/manual-sig-broadcast";
import { pickRandomManualSigDrafts } from "@/lib/manual-sig-random";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  MANUAL_SIG_WORKBENCH_KEY,
  MAX_MANUAL_SIG_SLOTS,
  applyManualSlotToForm,
  captureManualFormToSlot,
  createEmptyManualSlot,
  emptyManualDrafts,
  defaultManualSigWorkbench,
  manualSigDraftsReady,
  mergeActiveSlotIntoWorkbench,
  normalizeManualSigWorkbench,
  parseManualSigDraftRows,
  readManualSigWorkbenchFromOverlaySettings,
  slotToDraftPersist,
  type ManualInputMode,
  type ManualSigDraft,
  type ManualSigSlot,
  type ManualSigWorkbench,
} from "@/lib/manual-sig-workbench";

type ManualLandApplyOverride = {
  drafts: ManualSigDraft[];
  soldFlags?: boolean[];
  oneShotMarkSold?: boolean;
  stateSnapshot?: AppState;
};

const STEP_CONFIRM_PAUSE_MS = 3000;
const MAX_SELECTED_SIGS = 20;
const MIN_ONE_SHOT_SIGS = 2;
const MAX_SIG_UPLOAD_BYTES = 30 * 1024 * 1024;
const MANUAL_SIG_WORKBENCH_STORAGE_PREFIX = "admin-sig-sales-manual-workbench-v1";
/** @deprecated 레거시 로컬 초안 — 워크벤치로 마이그레이션 */
const MANUAL_SIG_DRAFT_STORAGE_PREFIX = "admin-sig-sales-manual-draft-v1";
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
const normalizeManualNameKey = (raw: string) =>
  String(raw || "").trim().toLowerCase().replace(/\s+/g, "");

function findInventoryForManualRow(
  inventory: SigItem[],
  row: { name: string; price: number },
  sourceSigId?: string
): SigItem | undefined {
  const sid = String(sourceSigId || "").trim();
  if (sid && sid !== ONE_SHOT_SIG_ID) {
    const byId = inventory.find((x) => x.id === sid);
    if (byId) return byId;
  }
  const nk = normalizeManualNameKey(row.name);
  const price = Math.floor(Number(row.price || 0));
  return inventory.find((x) => {
    if (!x || x.id === ONE_SHOT_SIG_ID) return false;
    return (
      normalizeManualNameKey(x.name) === nk &&
      Math.floor(Number(x.price || 0)) === price
    );
  });
}

function findInventoryForDisplaySig(
  inventory: SigItem[],
  sig: Pick<SigItem, "id" | "name" | "price">,
  sourceSigId?: string
): SigItem | undefined {
  const sid = String(sourceSigId || sig.id || "").trim();
  if (sid && sid !== ONE_SHOT_SIG_ID) {
    const canon = canonicalSigIdFromWheelSliceId(sid);
    const byId = inventory.find(
      (x) => x.id === sid || canonicalSigIdFromWheelSliceId(x.id) === canon
    );
    if (byId) return byId;
  }
  return findInventoryForManualRow(
    inventory,
    { name: sig.name, price: sig.price },
    sourceSigId || sig.id
  );
}

/** 당첨 카드 id·이름·가격 → 수동 입력 행(0~4). 표시 순서와 폼 행 순서가 다를 수 있음 */
function resolveManualRowIndexForDisplaySig(
  sig: Pick<SigItem, "id" | "name" | "price">,
  displaySelectedSigs: SigItem[],
  manualParsedRows: { name: string; price: number }[],
  manualSigDrafts: Array<{ sourceSigId?: string }>
): number {
  const canon = canonicalSigIdFromWheelSliceId(sig.id);
  const nk = normalizeManualNameKey(sig.name);
  const price = Math.floor(Number(sig.price || 0));
  for (let i = 0; i < manualParsedRows.length; i++) {
    const row = manualParsedRows[i];
    if (!row?.name) continue;
    const sourceId = String(manualSigDrafts[i]?.sourceSigId || "").trim();
    if (sourceId && (sourceId === sig.id || canonicalSigIdFromWheelSliceId(sourceId) === canon)) {
      return i;
    }
    if (normalizeManualNameKey(row.name) === nk && Math.floor(Number(row.price || 0)) === price) {
      return i;
    }
  }
  const displayIdx = displaySelectedSigs.findIndex(
    (s) => s.id === sig.id || canonicalSigIdFromWheelSliceId(s.id) === canon
  );
  if (displayIdx >= 0 && displayIdx < 5) return displayIdx;
  return -1;
}

function bumpInventorySigSold(
  inventory: SigItem[],
  inv: SigItem,
  sold: boolean
): SigItem[] {
  return inventory.map((row) => {
    if (row.id !== inv.id) return row;
    const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
    const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
    if (sold) {
      const nextSold = Math.min(maxCount, soldCount + 1);
      return {
        ...row,
        soldCount: nextSold,
        isActive: nextSold >= maxCount ? false : row.isActive,
      };
    }
    const nextSold = Math.max(0, soldCount - 1);
    return { ...row, soldCount: nextSold, isActive: true };
  });
}

function isDisplaySigMarkedSold(sig: SigItem, soldSet: Set<string>): boolean {
  const canon = canonicalSigIdFromWheelSliceId(sig.id);
  return soldSet.has(sig.id) || soldSet.has(canon);
}

/** 당첨 N개 + 한방 모두 「판매 완료」 표시됐는지 */
function isFullRoundMarkedSold(params: {
  displaySelectedSigs: SigItem[];
  soldSet: Set<string>;
  oneShotMarkSold: boolean;
  displayOneShot: { price: number } | null;
}): boolean {
  const { displaySelectedSigs, soldSet, oneShotMarkSold, displayOneShot } = params;
  if (displaySelectedSigs.length < MIN_ONE_SHOT_SIGS || !displayOneShot) return false;
  if (!oneShotMarkSold) return false;
  return displaySelectedSigs.every((sig) => isDisplaySigMarkedSold(sig, soldSet));
}

/** 한방 판매 완료 시 당첨 N칸도 함께 판매 완료 */
function soldFlagsWithOneShotCascade(
  flags: boolean[],
  oneShotMarkSold: boolean,
  slotCount = 5
): boolean[] {
  const next = [...flags];
  while (next.length < slotCount) next.push(false);
  if (oneShotMarkSold) return Array.from({ length: slotCount }, () => true);
  return next.slice(0, slotCount);
}

function soldSetForFullManualRound(
  selected: SigItem[],
  flags: boolean[],
  oneShotMarkSold: boolean
): Set<string> {
  const cascade = soldFlagsWithOneShotCascade(flags, oneShotMarkSold);
  if (oneShotMarkSold && selected.length >= MIN_ONE_SHOT_SIGS) {
    const all = new Set<string>();
    selected.forEach((row) => {
      all.add(row.id);
      all.add(canonicalSigIdFromWheelSliceId(row.id));
    });
    return all;
  }
  const out = new Set<string>();
  selected.forEach((row, idx) => {
    if (!cascade[idx]) return;
    out.add(row.id);
    out.add(canonicalSigIdFromWheelSliceId(row.id));
  });
  return out;
}

function collectSoldSigIdsForFinish(
  selected: SigItem[],
  soldIdSet: Set<string>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const sig of selected) {
    const canon = canonicalSigIdFromWheelSliceId(String(sig.id || ""));
    if (!soldIdSet.has(sig.id) && !soldIdSet.has(canon)) continue;
    const key = canon || sig.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

async function postRoulettePending(
  userId: string,
  sessionId: string
): Promise<{ ok: true; alreadyConfirmed?: boolean } | { ok: false; message: string }> {
  const pr = await fetch(`/api/roulette/pending?user=${encodeURIComponent(userId)}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const j = (await pr.json().catch(() => ({}))) as {
    error?: string;
    phase?: string;
    serverSessionId?: string;
    alreadyConfirmed?: boolean;
  };
  if (pr.ok) {
    return { ok: true, alreadyConfirmed: Boolean(j.alreadyConfirmed) };
  }
  if (pr.status === 409 && j.error === "already_confirmed") {
    return { ok: true, alreadyConfirmed: true };
  }
  if (pr.status === 409 && j.error === "session_mismatch" && j.serverSessionId) {
    return { ok: false, message: `세션 불일치(서버: ${j.serverSessionId})` };
  }
  if (pr.status === 409 && j.error === "bad_phase") {
    return { ok: false, message: `단계 불일치(${String(j.phase || "unknown")}) — 수동 결과 적용(LANDED) 후 다시 시도` };
  }
  return { ok: false, message: j.error || `pending_${pr.status}` };
}

export function AdminSigSalesPage({ manualOnly = false }: { manualOnly?: boolean }) {
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
  const [sigSalesSigRowOpen, setSigSalesSigRowOpen] = useState<Record<string, boolean>>({});
  const [resultsPanelCollapsed, setResultsPanelCollapsed] = useState(false);
  const [overlayObsUrl, setOverlayObsUrl] = useState("");
  const [overlayObsUrlManual, setOverlayObsUrlManual] = useState("");
  const [overlayObsMode, setOverlayObsMode] = useState<"wheel" | "manual">("manual");
  const [manualInputMode, setManualInputMode] = useState<ManualInputMode>("free");
  const [manualSigDrafts, setManualSigDrafts] = useState<ManualSigDraft[]>(
    Array.from({ length: 5 }, () => ({ name: "", priceInput: "", imageUrl: "" }))
  );
  const [manualOneShotName, setManualOneShotName] = useState("한방 시그");
  const [manualOneShotPriceInput, setManualOneShotPriceInput] = useState("");
  const [manualOneShotImageUrl, setManualOneShotImageUrl] = useState("");
  const [manualSigSoldFlags, setManualSigSoldFlags] = useState<boolean[]>([false, false, false, false, false]);
  const [manualOneShotMarkSold, setManualOneShotMarkSold] = useState(false);
  const [manualWorkbench, setManualWorkbench] = useState<ManualSigWorkbench>(() =>
    defaultManualSigWorkbench()
  );
  const [manualBusy, setManualBusy] = useState(false);
  const [manualDebugInfo, setManualDebugInfo] = useState<string>("");
  const [manualRowUploadBusy, setManualRowUploadBusy] = useState<Record<number, boolean>>({});
  const [manualOneShotUploadBusy, setManualOneShotUploadBusy] = useState(false);
  const nextSpinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualSectionRef = useRef<HTMLDivElement | null>(null);
  const manualDraftHydratedRef = useRef(false);
  const latestStateRef = useRef<AppState | null>(null);
  const manualDraftLastSavedRef = useRef<string>("");
  const manualWorkbenchLastSavedRef = useRef<string>("");
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
  const lastAppliedRemoteUpdatedAtRef = useRef(0);
  const pendingLocalSaveRef = useRef(false);
  const lastRouletteSyncRef = useRef<SigSalesRouletteSyncCursor>({ sessionId: "", phase: "" });
  const loadRemote = useCallback(async (opts?: { force?: boolean }) => {
    if (!authReady) return;
    if (!opts?.force && pendingLocalSaveRef.current) return;
    const remote = await loadStateFromApi(userId, opts?.force ? { forceFull: true } : undefined);
    if (!remote) return;
    const ts = remote.updatedAt || 0;
    if (!opts?.force && ts > 0 && ts <= lastAppliedRemoteUpdatedAtRef.current) return;
    if (ts > 0) lastSyncedUpdatedAtRef.current = Math.max(lastSyncedUpdatedAtRef.current, ts);
    lastAppliedRemoteUpdatedAtRef.current = ts;
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

  const loadManualFormFromSlot = useCallback((slot: ManualSigSlot) => {
    const form = applyManualSlotToForm(slot);
    setManualInputMode(form.inputMode);
    setManualSigDrafts(form.drafts);
    setManualOneShotName(form.oneShotName);
    setManualOneShotPriceInput(form.oneShotPriceInput);
    setManualOneShotImageUrl(form.oneShotImageUrl);
    setManualSigSoldFlags(form.sigSoldFlags);
    setManualOneShotMarkSold(form.oneShotMarkSold);
  }, []);

  const buildWorkbenchForPersist = useCallback((): ManualSigWorkbench => {
    const activeSlot = manualWorkbench.slots.find((s) => s.id === manualWorkbench.activeSlotId);
    const captured = captureManualFormToSlot(
      manualWorkbench.activeSlotId,
      activeSlot?.name ?? "준비",
      {
        inputMode: manualInputMode,
        drafts: manualSigDrafts,
        oneShotName: manualOneShotName,
        oneShotPriceInput: manualOneShotPriceInput,
        oneShotImageUrl: manualOneShotImageUrl,
        sigSoldFlags: manualSigSoldFlags,
        oneShotMarkSold: manualOneShotMarkSold,
      }
    );
    return mergeActiveSlotIntoWorkbench(manualWorkbench, captured);
  }, [
    manualWorkbench,
    manualInputMode,
    manualSigDrafts,
    manualOneShotName,
    manualOneShotPriceInput,
    manualOneShotImageUrl,
    manualSigSoldFlags,
    manualOneShotMarkSold,
  ]);

  const switchManualSlot = useCallback(
    (nextId: string) => {
      if (nextId === manualWorkbench.activeSlotId) return;
      let nextSlot: ManualSigSlot | undefined;
      setManualWorkbench((prev) => {
        const activeSlot = prev.slots.find((s) => s.id === prev.activeSlotId);
        const captured = captureManualFormToSlot(prev.activeSlotId, activeSlot?.name ?? "준비", {
          inputMode: manualInputMode,
          drafts: manualSigDrafts,
          oneShotName: manualOneShotName,
          oneShotPriceInput: manualOneShotPriceInput,
          oneShotImageUrl: manualOneShotImageUrl,
          sigSoldFlags: manualSigSoldFlags,
          oneShotMarkSold: manualOneShotMarkSold,
        });
        const merged = mergeActiveSlotIntoWorkbench(prev, captured);
        nextSlot = merged.slots.find((s) => s.id === nextId) ?? merged.slots[0];
        return { ...merged, activeSlotId: nextSlot.id };
      });
      if (nextSlot) loadManualFormFromSlot(nextSlot);
    },
    [
      manualWorkbench.activeSlotId,
      manualInputMode,
      manualSigDrafts,
      manualOneShotName,
      manualOneShotPriceInput,
      manualOneShotImageUrl,
      manualSigSoldFlags,
      manualOneShotMarkSold,
      loadManualFormFromSlot,
    ]
  );

  const addManualSlot = useCallback(() => {
    let nextSlot: ManualSigSlot | undefined;
    setManualWorkbench((prev) => {
      if (prev.slots.length >= MAX_MANUAL_SIG_SLOTS) return prev;
      const activeSlot = prev.slots.find((s) => s.id === prev.activeSlotId);
      const captured = captureManualFormToSlot(prev.activeSlotId, activeSlot?.name ?? "준비", {
        inputMode: manualInputMode,
        drafts: manualSigDrafts,
        oneShotName: manualOneShotName,
        oneShotPriceInput: manualOneShotPriceInput,
        oneShotImageUrl: manualOneShotImageUrl,
        sigSoldFlags: manualSigSoldFlags,
        oneShotMarkSold: manualOneShotMarkSold,
      });
      const merged = mergeActiveSlotIntoWorkbench(prev, captured);
      const n = merged.slots.length + 1;
      nextSlot = createEmptyManualSlot(`준비 ${n}`);
      return {
        ...merged,
        slots: [...merged.slots, nextSlot],
        activeSlotId: nextSlot.id,
      };
    });
    if (nextSlot) loadManualFormFromSlot(nextSlot);
  }, [
    manualInputMode,
    manualSigDrafts,
    manualOneShotName,
    manualOneShotPriceInput,
    manualOneShotImageUrl,
    manualSigSoldFlags,
    manualOneShotMarkSold,
    loadManualFormFromSlot,
  ]);

  const removeManualSlot = useCallback(
    (slotId: string) => {
      let nextSlot: ManualSigSlot | undefined;
      setManualWorkbench((prev) => {
        if (prev.slots.length <= 1) return prev;
        const activeSlot = prev.slots.find((s) => s.id === prev.activeSlotId);
        const captured = captureManualFormToSlot(prev.activeSlotId, activeSlot?.name ?? "준비", {
          inputMode: manualInputMode,
          drafts: manualSigDrafts,
          oneShotName: manualOneShotName,
          oneShotPriceInput: manualOneShotPriceInput,
          oneShotImageUrl: manualOneShotImageUrl,
          sigSoldFlags: manualSigSoldFlags,
          oneShotMarkSold: manualOneShotMarkSold,
        });
        const merged = mergeActiveSlotIntoWorkbench(prev, captured);
        const slots = merged.slots.filter((s) => s.id !== slotId);
        if (slots.length === 0) return merged;
        const removingActive = slotId === merged.activeSlotId;
        nextSlot = removingActive ? slots[0] : slots.find((s) => s.id === merged.activeSlotId) ?? slots[0];
        const broadcastSlotId =
          merged.broadcastSlotId === slotId ? undefined : merged.broadcastSlotId;
        return {
          ...merged,
          slots,
          activeSlotId: nextSlot.id,
          broadcastSlotId,
        };
      });
      if (nextSlot) loadManualFormFromSlot(nextSlot);
    },
    [
      manualInputMode,
      manualSigDrafts,
      manualOneShotName,
      manualOneShotPriceInput,
      manualOneShotImageUrl,
      manualSigSoldFlags,
      manualOneShotMarkSold,
      loadManualFormFromSlot,
    ]
  );

  useEffect(() => {
    if (manualDraftHydratedRef.current) return;
    const os =
      state?.overlaySettings && typeof state.overlaySettings === "object"
        ? (state.overlaySettings as Record<string, unknown>)
        : undefined;
    const hasServerWorkbench = Boolean(os?.[MANUAL_SIG_WORKBENCH_KEY]);
    const hasServerDraft = Boolean(os?.[MANUAL_SIG_DRAFT_STATE_KEY]);

    let wb: ManualSigWorkbench | null = null;
    if (hasServerWorkbench || hasServerDraft) {
      wb = readManualSigWorkbenchFromOverlaySettings(os);
    } else if (typeof window !== "undefined") {
      const wbKey = `${MANUAL_SIG_WORKBENCH_STORAGE_PREFIX}:${userId || "default"}`;
      const legacyKey = `${MANUAL_SIG_DRAFT_STORAGE_PREFIX}:${userId || "default"}`;
      try {
        const rawWb = window.localStorage.getItem(wbKey);
        if (rawWb) {
          wb = normalizeManualSigWorkbench(JSON.parse(rawWb));
        } else {
          const rawLegacy = window.localStorage.getItem(legacyKey);
          wb = normalizeManualSigWorkbench(undefined, rawLegacy ? JSON.parse(rawLegacy) : undefined);
        }
      } catch {
        wb = defaultManualSigWorkbench();
      }
    } else {
      return;
    }

    setManualWorkbench(wb);
    const active = wb.slots.find((s) => s.id === wb.activeSlotId) ?? wb.slots[0];
    const form = applyManualSlotToForm(active);
    setManualInputMode(form.inputMode);
    setManualSigDrafts(form.drafts);
    setManualOneShotName(form.oneShotName);
    setManualOneShotPriceInput(form.oneShotPriceInput);
    setManualOneShotImageUrl(form.oneShotImageUrl);
    setManualSigSoldFlags(form.sigSoldFlags);
    setManualOneShotMarkSold(form.oneShotMarkSold);
    manualDraftHydratedRef.current = true;
  }, [userId, state?.overlaySettings]);

  useEffect(() => {
    if (manualOnly) return;
    if (typeof window === "undefined") return;
    if (!manualDraftHydratedRef.current) return;
    const wb = buildWorkbenchForPersist();
    const wbKey = `${MANUAL_SIG_WORKBENCH_STORAGE_PREFIX}:${userId || "default"}`;
    try {
      window.localStorage.setItem(wbKey, JSON.stringify(wb));
    } catch {
      /* ignore quota/storage errors */
    }
    if (!authReady) return;
    const tid = window.setTimeout(() => {
      const current = latestStateRef.current;
      if (!current) return;
      const payloadText = JSON.stringify(wb);
      if (manualWorkbenchLastSavedRef.current === payloadText) return;
      manualWorkbenchLastSavedRef.current = payloadText;
      const prevOverlaySettings =
        current.overlaySettings && typeof current.overlaySettings === "object"
          ? (current.overlaySettings as Record<string, unknown>)
          : {};
      const activeSlot = wb.slots.find((s) => s.id === wb.activeSlotId) ?? wb.slots[0];
      const nextOverlaySettings: Record<string, unknown> = {
        ...prevOverlaySettings,
        [MANUAL_SIG_WORKBENCH_KEY]: wb,
        /** OBS 수동 모드: 현재 탭 초안을 서버에 미러(적용 전에도 카드·OBS 동기화) */
        ...(activeSlot ? { [MANUAL_SIG_DRAFT_STATE_KEY]: slotToDraftPersist(activeSlot) } : {}),
      };
      const next: AppState = {
        ...current,
        overlaySettings: nextOverlaySettings,
        updatedAt: Date.now(),
      };
      void saveSigSalesManualStateAsync(next, userId);
    }, 300);
    return () => window.clearTimeout(tid);
  }, [authReady, userId, buildWorkbenchForPersist, manualOnly]);

  const loadHistory = useCallback(async (limit = 8) => {
    if (manualOnly) return;
    if (!authReady) return;
    const res = await fetch(`/api/roulette/history?user=${encodeURIComponent(userId)}&limit=${limit}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return;
    const data = (await res.json()) as { history?: HistoryItem[] };
    if (Array.isArray(data.history)) setHistory(data.history);
  }, [authReady, userId, manualOnly]);

  useEffect(() => {
    if (manualOnly) return;
    if (!authReady) return;
    void loadHistory(8);
  }, [authReady, loadHistory, manualOnly]);

  /** 방송 착지(LANDED) 직후 Redis 로그가 쌓이면 이력 패널 갱신 */
  useEffect(() => {
    if (manualOnly) return;
    if (!authReady) return;
    if (machine.phase === "LANDED") void loadHistory(8);
  }, [authReady, machine.phase, loadHistory, manualOnly]);

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
    const sp = new URLSearchParams(window.location.search);
    setWheelDemoMode(
      isWheelDemoModeFromSearchParams(
        { get: (key) => sp.get(key) },
        window.location.hostname
      )
    );
  }, []);

  const wheelInventory = useMemo(() => {
    const merged = mergeWheelDemoSigInventory(state?.sigInventory, wheelDemoMode);
    if (wheelDemoMode) return merged;
    return stripBundledSigPlaceholderItems(merged);
  }, [state?.sigInventory, wheelDemoMode]);

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

  const manualParsedRowsEarly = useMemo(
    () => parseManualSigDraftRows(manualSigDrafts),
    [manualSigDrafts]
  );
  const manualReadyEarly = useMemo(() => manualSigDraftsReady(manualSigDrafts), [manualSigDrafts]);
  const manualRandomPool = useMemo(
    () =>
      activeNormalPool.map((x) => ({
        id: String(x.id || ""),
        name: String(x.name || "").trim(),
        price: Math.max(0, Math.floor(Number(x.price || 0))),
        imageUrl: String(x.imageUrl || "").trim(),
      })),
    [activeNormalPool]
  );
  const manualPreviewFromDraft = useMemo((): SigItem[] => {
    if (!manualReadyEarly) return [];
    return manualParsedRowsEarly.map((row, idx) => {
      const sourceSigId = String(manualSigDrafts[idx]?.sourceSigId || "").trim();
      const safeName =
        row.name.replace(/\s+/g, "_").replace(/[^\w가-힣-]/g, "").slice(0, 24) || `sig_${idx + 1}`;
      return {
        id: sourceSigId || `manual_preview_${idx + 1}_${safeName}`,
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
  }, [manualReadyEarly, manualParsedRowsEarly, manualSigDrafts]);
  const preferManualDraftPreview = useMemo(
    () =>
      overlayObsMode === "manual" &&
      manualPreviewFromDraft.length >= MIN_ONE_SHOT_SIGS &&
      machine.phase !== "SPINNING" &&
      !machine.isRolling,
    [overlayObsMode, manualPreviewFromDraft.length, machine.phase, machine.isRolling]
  );

  const displaySelectedSigs = useMemo(() => {
    /** 수동 모드: 현재 탭 입력을 하단 당첨 미리보기로 즉시 반영(LANDED 이전 회차에 묶이지 않음) */
    if (preferManualDraftPreview) {
      return manualPreviewFromDraft.slice(0, MAX_SELECTED_SIGS);
    }
    /** 회전 전(IDLE)에는 하단 당첨·수동 미리보기를 표시하지 않음 */
    if (machine.phase === "IDLE") return [];
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
  }, [
    preferManualDraftPreview,
    manualPreviewFromDraft,
    machine.selectedSigs,
    stagedSelected,
    manualPreviewSelected,
    machine.phase,
  ]);
  const displaySelectedSigsForUi = useMemo(
    () =>
      stripBundledSigPlaceholderItems(
        displaySelectedSigs.map((s) => hydrateSigItemFromInventory(s, state?.sigInventory, userId))
      ),
    [displaySelectedSigs, state?.sigInventory, userId]
  );
  const isManualBroadcastRound = useMemo(() => {
    const sid = String(machine.sessionId || state?.rouletteState?.sessionId || "").trim();
    return sid.startsWith("manual_") || overlayObsMode === "manual";
  }, [machine.sessionId, state?.rouletteState?.sessionId, overlayObsMode]);
  /** 확정·재고 완판 시 관리 화면·오버레이와 동일하게 판매 완료 스탬프 */
  const adminSoldOverrideSet = useMemo(() => {
    const next = new Set<string>();
    for (const id of manualSoldSet) {
      next.add(id);
      next.add(canonicalSigIdFromWheelSliceId(id));
    }
    if (
      !isManualBroadcastRound &&
      machine.phase === "LANDED" &&
      (oneShotSold || manualOneShotMarkSold)
    ) {
      next.add(ONE_SHOT_SIG_ID);
      next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
    }
    /** 수동 방송: 체크한 시그만 스탬프(재고 완판 전체를 붙이지 않음 → 해제 가능) */
    if (isManualBroadcastRound) {
      if (manualOneShotMarkSold || oneShotSold) {
        next.add(ONE_SHOT_SIG_ID);
        next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
      }
      return next;
    }
    if (machine.phase === "CONFIRM_PENDING" || machine.phase === "CONFIRMED") {
      const soldMarksActive = manualSoldSet.size > 0;
      if (soldMarksActive) {
        for (const id of manualSoldSet) {
          next.add(id);
          next.add(canonicalSigIdFromWheelSliceId(id));
        }
      } else {
        for (const s of displaySelectedSigs) {
          next.add(s.id);
          next.add(canonicalSigIdFromWheelSliceId(s.id));
        }
      }
      if (oneShotSold || (!soldMarksActive && displaySelectedSigs.length >= MIN_ONE_SHOT_SIGS)) {
        next.add(ONE_SHOT_SIG_ID);
        next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
      }
    }
    for (const row of state?.sigInventory || []) {
      if (row.soldCount >= row.maxCount) {
        next.add(row.id);
        next.add(canonicalSigIdFromWheelSliceId(row.id));
      }
    }
    return next;
  }, [
    manualSoldSet,
    machine.phase,
    displaySelectedSigs,
    oneShotSold,
    manualOneShotMarkSold,
    isManualBroadcastRound,
    state?.sigInventory,
  ]);

  const targetSelectionCount = useMemo(() => {
    if (preferManualDraftPreview) {
      return Math.max(1, Math.min(MAX_SELECTED_SIGS, manualPreviewFromDraft.length));
    }
    if (pendingLanding?.selected?.length) return Math.max(1, Math.min(MAX_SELECTED_SIGS, pendingLanding.selected.length));
    if (machine.selectedSigs?.length) return Math.max(1, Math.min(MAX_SELECTED_SIGS, machine.selectedSigs.length));
    return 1;
  }, [preferManualDraftPreview, manualPreviewFromDraft.length, pendingLanding?.selected, machine.selectedSigs]);
  /** 착지·확정 단계: 회전판만 숨기고 당첨·한방·판매 버튼은 유지(판매 관리) */
  const hideWheelAfterSpin =
    (machine.phase === "LANDED" ||
      machine.phase === "CONFIRM_PENDING" ||
      machine.phase === "CONFIRMED") &&
    displaySelectedSigs.length > 0 &&
    !demoSpin &&
    !pendingLanding &&
    !wheelSpinning &&
    !loadingSpin;
  /** 당첨 쇼케이스 레이아웃(접기·스크롤) — 휠 숨김과 동일 조건 + 전체 당첨 수 충족 */
  const showFinalShowcase =
    (hideWheelAfterSpin && displaySelectedSigs.length >= targetSelectionCount) ||
    (preferManualDraftPreview && displaySelectedSigs.length >= MIN_ONE_SHOT_SIGS);
  const oneShotImageUrl = useMemo(() => {
    if (manualOneShotImageUrl.trim()) {
      return resolveSigAdminPreviewSrc(manualOneShotImageUrl, manualOneShotName || "한방 시그", userId);
    }
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    const fromOneShot = (oneShotItem?.imageUrl || "").trim();
    if (isDedicatedOneShotSigImageUrl(fromOneShot)) {
      return resolveSigAdminPreviewSrc(fromOneShot, oneShotItem?.name || "한방 시그", userId);
    }
    return resolveSigAdminPreviewSrc(
      DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
      manualOneShotName || "한방 시그",
      userId
    );
  }, [state?.sigInventory, manualOneShotImageUrl, manualOneShotName, userId]);
  const manualParsedRows = manualParsedRowsEarly;
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
  const manualSoldDeduction = useMemo(
    () =>
      manualParsedRows.reduce(
        (sum, row, idx) => (manualSigSoldFlags[idx] ? sum + row.price : sum),
        0
      ),
    [manualParsedRows, manualSigSoldFlags]
  );
  const manualNetOneShotPrice = useMemo(
    () => Math.max(0, manualAutoOneShotPrice - manualSoldDeduction),
    [manualAutoOneShotPrice, manualSoldDeduction]
  );
  /** 한방 금액·차감은 당첨 5개(수동 폼 또는 manual_ 적용본)와 동일 배열 기준 — displaySelectedSigs(이전 회차)와 분리 */
  const sigsForOneShotCalc = useMemo(() => {
    if (preferManualDraftPreview) {
      return manualParsedRows.map((row, idx) => ({
        id:
          String(manualSigDrafts[idx]?.sourceSigId || "").trim() ||
          `manual_draft_${idx + 1}`,
        name: row.name,
        price: row.price,
      }));
    }
    const sid = String(machine.sessionId || state?.rouletteState?.sessionId || "").trim();
    if (sid.startsWith("manual_") && (machine.selectedSigs?.length ?? 0) >= MIN_ONE_SHOT_SIGS) {
      return (machine.selectedSigs || []).slice(0, MAX_SELECTED_SIGS).map((s) => ({
        id: s.id,
        name: s.name,
        price: Math.max(0, Math.floor(Number(s.price || 0))),
      }));
    }
    if (
      manualParsedRows.length === 5 &&
      !manualParsedRows.some((row) => !row.name || row.price <= 0)
    ) {
      return manualParsedRows.map((row, idx) => ({
        id:
          String(manualSigDrafts[idx]?.sourceSigId || "").trim() ||
          `manual_draft_${idx + 1}`,
        name: row.name,
        price: row.price,
      }));
    }
    return displaySelectedSigs.map((s) => ({
      id: s.id,
      name: s.name,
      price: Math.max(0, Math.floor(Number(s.price || 0))),
    }));
  }, [
    preferManualDraftPreview,
    machine.sessionId,
    machine.selectedSigs,
    state?.rouletteState?.sessionId,
    manualParsedRows,
    manualSigDrafts,
    displaySelectedSigs,
  ]);
  const manualParsedOneShotPrice = useMemo(() => {
    if (sigsForOneShotCalc.length < MIN_ONE_SHOT_SIGS) return 0;
    return (
      resolveOneShotDisplayPrice({
        selected: sigsForOneShotCalc,
        soldIdSet: manualSoldSet,
        manualPriceInput: manualOneShotPriceInput,
        fallbackName: manualOneShotName,
      })?.price ?? 0
    );
  }, [sigsForOneShotCalc, manualSoldSet, manualOneShotPriceInput, manualOneShotName]);
  const displayOneShot = useMemo(() => {
    if (sigsForOneShotCalc.length < MIN_ONE_SHOT_SIGS) return null;
    return resolveOneShotDisplayPrice({
      selected: sigsForOneShotCalc,
      soldIdSet: manualSoldSet,
      manualPriceInput: manualOneShotPriceInput,
      fallbackName: manualOneShotName,
    });
  }, [sigsForOneShotCalc, manualSoldSet, manualOneShotPriceInput, manualOneShotName]);
  const resultCardCount = useMemo(() => {
    let n = displaySelectedSigsForUi.length;
    if (displayOneShot && oneShotReveal) n += 1;
    return Math.max(1, n);
  }, [displaySelectedSigsForUi.length, displayOneShot, oneShotReveal]);
  const resultRowLayout = useMemo(
    () => layoutSigOverlayResultRow({ cellCount: resultCardCount, userScalePct: sigResultScalePct }),
    [resultCardCount, sigResultScalePct]
  );
  const manualReady = manualReadyEarly;

  useEffect(() => {
    if (!preferManualDraftPreview) return;
    const next = new Set<string>();
    manualPreviewFromDraft.forEach((sig, idx) => {
      if (!manualSigSoldFlags[idx]) return;
      next.add(sig.id);
      next.add(canonicalSigIdFromWheelSliceId(sig.id));
    });
    setManualSoldSet(next);
    setOneShotSold(manualOneShotMarkSold);
  }, [
    preferManualDraftPreview,
    manualPreviewFromDraft,
    manualSigSoldFlags,
    manualOneShotMarkSold,
  ]);

  useEffect(() => {
    if (!authReady) return;
    if (manualInventoryOptions.length > 0) return;
    void loadRemote();
  }, [authReady, manualInventoryOptions.length, loadRemote]);

  useEffect(() => {
    if (!displayOneShot) {
      setOneShotReveal(false);
      return;
    }
    if (hideWheelAfterSpin || preferManualDraftPreview) {
      setOneShotReveal(true);
      return;
    }
    if (!showFinalShowcase) {
      setOneShotReveal(false);
      return;
    }
    setOneShotReveal(true);
  }, [hideWheelAfterSpin, preferManualDraftPreview, showFinalShowcase, displayOneShot]);

  const landedShowcaseSigKeyRef = useRef("");
  useEffect(() => {
    if (pendingLanding || demoSpin) return;
    if (
      machine.phase !== "LANDED" &&
      machine.phase !== "CONFIRM_PENDING" &&
      machine.phase !== "CONFIRMED"
    ) {
      landedShowcaseSigKeyRef.current = "";
      return;
    }
    const fromServer = (machine.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
    if (fromServer.length === 0) return;
    const sigKey = `${machine.sessionId}:${fromServer.map((s) => s.id).join(",")}`;
    if (landedShowcaseSigKeyRef.current === sigKey) return;
    landedShowcaseSigKeyRef.current = sigKey;
    setStagedSelected(fromServer);
    setSpinStep(Math.max(0, fromServer.length - 1));
    setHighlightId(fromServer[fromServer.length - 1]?.id || null);
    setLastConfirmedText("");
    if (nextSpinTimerRef.current) {
      clearTimeout(nextSpinTimerRef.current);
      nextSpinTimerRef.current = null;
    }
  }, [machine.phase, machine.selectedSigs, machine.sessionId, pendingLanding, demoSpin]);

  /** OBS·서버가 먼저 착지(LANDED)했는데 관리자만 로컬 demoSpin 으로 휠이 도는 경우 */
  useEffect(() => {
    const fromServer = (machine.selectedSigs || []).slice(0, MAX_SELECTED_SIGS);
    if (fromServer.length === 0) return;
    if (machine.phase !== "SPINNING") return;
    if (machine.isRolling) return;
    if (!demoSpin && !pendingLanding) return;
    if (useSequentialWheel && spinQueueSelected.length > 1) return;
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
    useSequentialWheel,
    spinQueueSelected.length,
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
      pendingLocalSaveRef.current = true;
      try {
        const saved = await saveSigSalesManualStateAsync(snapshot, userId);
        if (saved.ok && typeof saved.serverUpdatedAt === "number") {
          lastAppliedRemoteUpdatedAtRef.current = saved.serverUpdatedAt;
        }
      } finally {
        pendingLocalSaveRef.current = false;
      }
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
    setPinnedWheelLayout(null);
    landedShowcaseSigKeyRef.current = "";
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
      setState((prev) => {
        if (!prev) return prev;
        const idleRs = buildRouletteIdlePreserveSettings(prev.rouletteState, { clearSessionExcluded: clearWonPool });
        return {
          ...prev,
          updatedAt: Date.now(),
          rouletteState: idleRs,
        };
      });
      await loadRemote({ force: true });
      await persistRouletteState((rs) => ({
        ...buildRouletteIdlePreserveSettings(rs, { clearSessionExcluded: clearWonPool }),
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

  /** 수동 판매만 리셋 — 회전판 API·당첨 제외 목록은 건드리지 않음 */
  const onResetManualRoundForResale = useCallback(() => {
    if (!state) return;
    void (async () => {
      setManualBusy(true);
      try {
        const patch = buildManualRoundResetPatch(state);
        const next: AppState = { ...state, ...patch };
        setState(next);
        setManualSoldSet(new Set());
        setOneShotSold(false);
        setManualSigDrafts(emptyManualDrafts());
        setManualOneShotPriceInput("");
        setManualSigSoldFlags([false, false, false, false, false]);
        setManualOneShotMarkSold(false);
        setManualDebugInfo("");
        setShowConfirmModal(false);
        cancelConfirm();
        resetToIdle();
        await saveSigSalesManualStateAsync(next, userId);
        setToast(
          "수동 판매 라운드를 리셋했습니다. 「리롤」 또는 「리롤 (목록만)」로 다음 라운드를 진행하세요."
        );
      } catch (e) {
        setToast(`수동 리셋 실패: ${String(e)}`);
      } finally {
        setManualBusy(false);
      }
    })();
  }, [state, userId, cancelConfirm, resetToIdle]);

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
        setToast("이전 회전 상태가 남아 있습니다. 「회전 리셋」 또는 「회전판 초기화」 후 시도하세요.");
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
      const host = typeof window !== "undefined" ? window.location.hostname : "";
      if (!wheelDemoMode && !isWheelDemoHostAllowed(host)) {
        setToast(
          code === "spin_failed" || !code
            ? "회전판 시작에 실패했습니다. 「회전판 초기화」 후 멤버·활성 시그를 확인하세요."
            : `회전판 시작 실패: ${code}`
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
      setToast("서버 응답 실패로 로컬 데모 회차로 실행했습니다. (로컬·LAN 전용)");
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

  const applyManualSelection = useCallback(async (confirmNow: boolean, override?: ManualLandApplyOverride) => {
    const baseState = override?.stateSnapshot ?? state;
    if (!baseState) return;
    const soldFlags = override?.soldFlags ?? manualSigSoldFlags;
    const oneShotSoldFlag = override?.oneShotMarkSold ?? manualOneShotMarkSold;
    const drafts = enrichManualDraftsWithInventoryImageUrls(
      {
        drafts: override?.drafts ?? manualSigDrafts,
        oneShotName: manualOneShotName,
        oneShotPriceInput: manualOneShotPriceInput,
        oneShotImageUrl: manualOneShotImageUrl,
        sigSoldFlags: soldFlags,
        oneShotMarkSold: oneShotSoldFlag,
      },
      baseState.sigInventory,
      userId
    ).drafts;
    const ready = manualSigDraftsReady(drafts);
    if (!ready) {
      setToast("수동 설정은 서로 다른 시그 5개를 모두 선택해야 합니다.");
      return;
    }
    const parsedRows = parseManualSigDraftRows(drafts);
    const tsId = Date.now();
    const normalizeManualKey = (raw: string) => String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    const selected: SigItem[] = parsedRows.map((row, idx) => {
      const safeName = row.name.replace(/\s+/g, "_").replace(/[^\w가-힣-]/g, "").slice(0, 24) || `sig_${idx + 1}`;
      const sourceSigId = String(drafts[idx]?.sourceSigId || "").trim();
      const matchedInventoryItem = (baseState.sigInventory || []).find((item) => {
        if (!item || item.id === ONE_SHOT_SIG_ID) return false;
        if (sourceSigId) return String(item.id || "").trim() === sourceSigId;
        const nameMatched = normalizeManualKey(item.name) === normalizeManualKey(row.name);
        const priceMatched = Math.floor(Number(item.price || 0)) === Math.floor(Number(row.price || 0));
        return nameMatched && priceMatched;
      });
      const base: SigItem = {
        id: matchedInventoryItem?.id || `manual_sig_${tsId}_${idx + 1}_${safeName}`,
        name: row.name,
        price: row.price,
        imageUrl: String(row.imageUrl || matchedInventoryItem?.imageUrl || "").trim(),
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      };
      return hydrateManualOverlaySigItem(base, baseState.sigInventory, userId, drafts[idx]);
    });
    setManualDebugInfo(
      `selected=${selected.length} | ${selected
        .map((x) => `${x.name}:${Math.max(0, Math.floor(Number(x.price || 0))).toLocaleString("ko-KR")}`)
        .join(" / ")}`
    );
    const soldSetForApply = new Set<string>();
    selected.forEach((row, idx) => {
      if (!soldFlags[idx]) return;
      soldSetForApply.add(row.id);
      soldSetForApply.add(canonicalSigIdFromWheelSliceId(row.id));
    });
    const oneShotResolved = resolveOneShotDisplayPrice({
      selected,
      soldIdSet: soldSetForApply,
      manualPriceInput: manualOneShotPriceInput,
      fallbackName: manualOneShotName,
    });
    if (!oneShotResolved || oneShotResolved.price <= 0) {
      setToast("한방 시그 금액을 확인해 주세요. (자동 합산 또는 직접 입력)");
      return;
    }
    const oneShot = oneShotResolved;
    const now = Date.now();
    const sessionId = MANUAL_OVERLAY_SESSION_ID;
    const oneShotImage = String(manualOneShotImageUrl || "").trim();
    const inventoryWithOneShotImage = (baseState.sigInventory || []).map((row) =>
      row.id === ONE_SHOT_SIG_ID && oneShotImage ? { ...row, imageUrl: oneShotImage } : row
    );

    setManualBusy(true);
    try {
      const prevOverlaySettings =
        baseState.overlaySettings && typeof baseState.overlaySettings === "object"
          ? (baseState.overlaySettings as Record<string, unknown>)
          : {};
      let wbApplied = buildWorkbenchForPersist();
      if (override?.drafts) {
        const activeSlotMeta = manualWorkbench.slots.find((s) => s.id === manualWorkbench.activeSlotId);
        const captured = captureManualFormToSlot(
          manualWorkbench.activeSlotId,
          activeSlotMeta?.name ?? "준비",
          {
            inputMode: "inventory",
            drafts: override.drafts,
            oneShotName: manualOneShotName,
            oneShotPriceInput: manualOneShotPriceInput,
            oneShotImageUrl: manualOneShotImageUrl,
            sigSoldFlags: soldFlags,
            oneShotMarkSold: oneShotSoldFlag,
          }
        );
        wbApplied = mergeActiveSlotIntoWorkbench(manualWorkbench, captured);
      }
      const activeSlot =
        wbApplied.slots.find((s) => s.id === wbApplied.activeSlotId) ?? wbApplied.slots[0];
      const manualDraftPayload = enrichManualDraftsWithInventoryImageUrls(
        slotToDraftPersist(activeSlot),
        inventoryWithOneShotImage,
        userId
      );
      const wbWithBroadcast: ManualSigWorkbench = {
        ...wbApplied,
        broadcastSlotId: wbApplied.activeSlotId,
      };
      setManualWorkbench(wbWithBroadcast);
      const landedState: AppState = {
        ...baseState,
        sigInventory: inventoryWithOneShotImage,
        overlaySettings: {
          ...prevOverlaySettings,
          [MANUAL_SIG_WORKBENCH_KEY]: wbWithBroadcast,
          [MANUAL_SIG_DRAFT_STATE_KEY]: manualDraftPayload,
        },
        rouletteState: {
          ...baseState.rouletteState,
          phase: "LANDED",
          isRolling: false,
          startedAt: now,
          sessionId,
          result: selected[selected.length - 1] || null,
          results: selected,
          selectedSigs: selected,
          oneShotResult: oneShot,
          spinCount: selected.length,
          overlayReloadNonce: Number(baseState.rouletteState?.overlayReloadNonce || 0) + 1,
        },
        updatedAt: now,
      };
      landed(selected, oneShot, selected[selected.length - 1]?.id || null, {
        sessionId,
        startedAt: now,
      });
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
            .filter((_, idx) => Boolean(soldFlags[idx]))
            .map((row) => row.id)
        )
      );
      setOneShotSold(oneShotSoldFlag);
      setShowConfirmModal(false);
      setResultsPanelCollapsed(false);
      manualDraftLastSavedRef.current = JSON.stringify(manualDraftPayload);
      manualWorkbenchLastSavedRef.current = JSON.stringify(wbWithBroadcast);
      const landedSaved = await saveSigSalesManualStateAsync(landedState, userId);

      if (!confirmNow) {
        if (!landedSaved.ok) {
          setToast("수동 결과는 먼저 표시했지만 서버 저장이 지연됩니다. 잠시 후 OBS를 새로고침해 주세요.");
        } else {
          setToast("수동 5개/한방 적용 완료 · OBS에 반영되었습니다. (회차 저장 없음)");
        }
        return;
      }
      const cascadeFlags = soldFlagsWithOneShotCascade(soldFlags, oneShotSoldFlag);
      const soldPreviewSet = soldSetForFullManualRound(selected, cascadeFlags, oneShotSoldFlag);
      const soldSigIdsForFinish = collectSoldSigIdsForFinish(selected, soldPreviewSet);
      const soldTargetIds = new Set(soldSigIdsForFinish);
      const confirmedInventory = inventoryWithOneShotImage.map((row) => {
        if (row.id === ONE_SHOT_SIG_ID) {
          if (!oneShotSoldFlag) return row;
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
      setManualSigSoldFlags(cascadeFlags);
      setManualSoldSet(soldPreviewSet);
      setOneShotSold(oneShotSoldFlag);
      const soldAt = Date.now();
      const manualConfirmed = manualOnly || isManualOverlaySessionId(sessionId);
      const soldState: AppState = {
        ...landedState,
        sigInventory: confirmedInventory,
        rouletteState: {
          ...landedState.rouletteState,
          phase: manualConfirmed ? "CONFIRMED" : "LANDED",
          isRolling: false,
          selectedSigs: selected,
          oneShotResult: oneShot,
          sessionId,
          ...(manualConfirmed ? { lastFinishedAt: soldAt } : {}),
          overlayReloadNonce: Number(landedState.rouletteState?.overlayReloadNonce || 0) + 1,
        },
        updatedAt: soldAt,
      };
      const soldSaved = await saveSigSalesManualStateAsync(soldState, userId);
      if (soldSaved.ok) {
        setState(soldState);
        setToast(
          manualConfirmed
            ? "판매 확정 완료! (수동 회차·재고 반영)"
            : "판매 완료(재고만 반영). 수동 판매는 회차·이력에 저장하지 않습니다."
        );
      } else {
        setToast("재고 반영 저장이 지연됩니다. OBS 새로고침 후 다시 확인해 주세요.");
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
    manualOneShotPriceInput,
    manualSigDrafts,
    manualOneShotName,
    manualOneShotImageUrl,
    manualSigSoldFlags,
    manualOneShotMarkSold,
    buildWorkbenchForPersist,
    manualWorkbench,
    userId,
    landed,
    loadRemote,
    manualOnly,
  ]);

  const fillRandomManualDrafts = useCallback(() => {
    const picked = pickRandomManualSigDrafts(manualRandomPool, 5);
    if (!picked) {
      setToast(
        memberFilterId
          ? `랜덤 실패: 선택 멤버 판매 가능 시그 ${manualRandomPool.length}개 (5개 필요).`
          : `랜덤 실패: 판매 가능 시그 ${manualRandomPool.length}개. 상단에서 멤버를 선택하거나 재고를 확인하세요.`
      );
      return;
    }
    setManualInputMode("inventory");
    setManualSigDrafts(picked);
    setManualSigSoldFlags([false, false, false, false, false]);
    setManualOneShotMarkSold(false);
    setToast(`리롤 (목록만): ${picked.map((p) => p.name).join(", ")}`);
  }, [manualRandomPool, memberFilterId]);

  const onRandomManualRerollAndObs = useCallback(() => {
    if (!state) return;
    const picked = pickRandomManualSigDrafts(manualRandomPool, 5);
    if (!picked) {
      setToast(
        memberFilterId
          ? `리롤 실패: 선택 멤버 판매 가능 시그 ${manualRandomPool.length}개 (5개 필요).`
          : `리롤 실패: 판매 가능 시그 ${manualRandomPool.length}개. 멤버·재고를 확인하세요.`
      );
      return;
    }
    void (async () => {
      setManualBusy(true);
      try {
        setManualInputMode("inventory");
        setManualSigDrafts(picked);
        setManualSigSoldFlags([false, false, false, false, false]);
        setManualOneShotMarkSold(false);
        setManualSoldSet(new Set());
        setOneShotSold(false);
        setManualDebugInfo("");
        setShowConfirmModal(false);
        cancelConfirm();
        /** IDLE·resetToIdle·중간 저장 없이 LANDED만 1회 저장 — OBS가 빈 상태·회전판을 보지 않게 */
        await applyManualSelection(false, {
          drafts: picked,
          soldFlags: [false, false, false, false, false],
          oneShotMarkSold: false,
        });
      } catch (e) {
        setToast(`리롤 실패: ${String(e)}`);
      } finally {
        setManualBusy(false);
      }
    })();
  }, [
    state,
    manualRandomPool,
    memberFilterId,
    cancelConfirm,
    applyManualSelection,
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
        setToast(`이미지 업로드 실패: ${formatSigImageUploadFailureMessage(res.status, file.size, j.error)}`);
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
    const origin = window.location.origin;
    const rs = Number(state?.rouletteState?.sigResultScalePct);
    const scale = Number.isFinite(rs) ? Math.floor(rs) : undefined;
    setOverlayObsUrl(
      buildSigSalesWheelOverlayUrl(origin, userId, {
        memberId: memberFilterId || undefined,
        menuCount: wheelDemoMode ? WHEEL_DEMO_MENU_COUNT : effectiveMenuCount,
        sigResultScalePct: scale,
        wheelDemo: wheelDemoMode,
      })
    );
    setOverlayObsUrlManual(
      buildSigSalesManualOverlayUrl(origin, userId, {
        memberId: memberFilterId || undefined,
        sigResultScalePct: scale,
      })
    );
  }, [
    userId,
    memberFilterId,
    effectiveMenuCount,
    wheelDemoMode,
    state?.rouletteState?.sigResultScalePct,
  ]);

  useEffect(() => {
    if (manualOnly || typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("view") !== "manual") return;
    const q = new URLSearchParams(window.location.search);
    q.delete("view");
    const qs = q.toString();
    router.replace(qs ? `/admin/sig-sales-manual?${qs}` : "/admin/sig-sales-manual");
  }, [manualOnly, router]);

  useEffect(() => {
    if (manualOnly) setOverlayObsMode("manual");
  }, [manualOnly]);

  const onConfirmSaleRef = useRef<() => Promise<void>>(async () => {});
  const applyManualSelectionRef =
    useRef<(confirmNow: boolean, override?: ManualLandApplyOverride) => Promise<void>>(
      async () => {}
    );
  const autoConfirmInFlightRef = useRef(false);

  useEffect(() => {
    applyManualSelectionRef.current = applyManualSelection;
  }, [applyManualSelection]);

  const onConfirmSale = useCallback(async () => {
    if (!state || displaySelectedSigs.length === 0) return;
    const effectiveSessionId = String(state.rouletteState?.sessionId || machine.sessionId || "").trim();
    if (!effectiveSessionId) {
      setToast("회차 ID가 없습니다. 「수동 결과 적용(LANDED)」 또는 회전 후 다시 시도하세요.");
      return;
    }
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
    const landedSyncState: AppState = {
      ...state,
      rouletteState: {
        ...state.rouletteState,
        phase: "LANDED",
        isRolling: false,
        sessionId: effectiveSessionId,
        startedAt: state.rouletteState?.startedAt || machine.startedAt || Date.now(),
        selectedSigs: displaySelectedSigs,
        results: displaySelectedSigs,
        result: displaySelectedSigs[displaySelectedSigs.length - 1] || state.rouletteState?.result || null,
        oneShotResult: displayOneShot ?? state.rouletteState?.oneShotResult ?? null,
      },
      updatedAt: Date.now(),
    };
    const landedSaved = await saveSigSalesManualStateAsync(landedSyncState, userId);
    if (landedSaved.ok) {
      setState(landedSyncState);
      landed(displaySelectedSigs, displayOneShot, displaySelectedSigs[displaySelectedSigs.length - 1]?.id || null, {
        sessionId: effectiveSessionId,
        startedAt: landedSyncState.rouletteState?.startedAt,
      });
    }

    const manualSession = isManualOverlaySessionId(effectiveSessionId);
    if (!manualSession) {
      markConfirmPending();
      let pendingResult = await postRoulettePending(userId, effectiveSessionId);
      if (!pendingResult.ok && pendingResult.message.includes("세션 불일치")) {
        await loadRemote();
        const remoteSid = String(
          (await loadStateFromApi(userId))?.rouletteState?.sessionId || effectiveSessionId
        ).trim();
        if (remoteSid) {
          pendingResult = await postRoulettePending(userId, remoteSid);
        }
      }
      if (!pendingResult.ok) {
        setError("판매 확정 준비 실패");
        cancelConfirm();
        setToast(`판매 확정 준비 실패: ${pendingResult.message}`);
        return;
      }
      if (pendingResult.alreadyConfirmed) {
        const afterRemote = await loadStateFromApi(userId);
        if (afterRemote?.rouletteState?.phase === "CONFIRMED") {
          setToast("이미 판매 확정된 회차입니다.");
          cancelConfirm();
          void loadRemote();
          return;
        }
      }
    }
    const allRegularMarked = displaySelectedSigs.every((sig) =>
      isDisplaySigMarkedSold(sig, manualSoldSet)
    );
    const effectiveOneShotSold = Boolean(
      oneShotSold || manualOneShotMarkSold || (allRegularMarked && displayOneShot)
    );
    const soldSigIdsForFinish = collectSoldSigIdsForFinish(displaySelectedSigs, manualSoldSet);
    const soldMarksActive = soldSigIdsForFinish.length > 0;
    const soldCanonForFinish = new Set(soldSigIdsForFinish);
    const selectedCanon = new Set(displaySelectedSigs.map((x) => canonicalSigIdFromWheelSliceId(x.id)));
    const normalizeNameKey = (raw: string) => String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    const selectedNamePriceSet = new Set(
      displaySelectedSigs.map((x) => `${normalizeNameKey(x.name)}::${Math.floor(Number(x.price || 0))}`)
    );
    const soldAppliedNames: string[] = [];
    const nextInventory = state.sigInventory.map((item) => {
      const itemCanon = canonicalSigIdFromWheelSliceId(item.id);
      const markSold =
        (soldMarksActive
          ? soldCanonForFinish.has(itemCanon)
          : selectedCanon.has(itemCanon) ||
            selectedNamePriceSet.has(
              `${normalizeNameKey(item.name)}::${Math.floor(Number(item.price || 0))}`
            )) ||
        (item.id === ONE_SHOT_SIG_ID && effectiveOneShotSold);
      if (!markSold) return item;
      const maxCount = Math.max(1, Math.floor(Number(item.maxCount || 1)));
      const soldCount = Math.max(0, Math.floor(Number(item.soldCount || 0)));
      if (soldCount >= maxCount) return item;
      const nextSold = Math.min(maxCount, soldCount + 1);
      soldAppliedNames.push(String(item.name || item.id || "").trim() || item.id);
      return {
        ...item,
        soldCount: nextSold,
        isActive: nextSold >= maxCount ? false : item.isActive,
      };
    });
  const soldPreviewSet = soldMarksActive
      ? new Set(
          displaySelectedSigs
            .filter((x) => {
              const canon = canonicalSigIdFromWheelSliceId(x.id);
              return manualSoldSet.has(x.id) || manualSoldSet.has(canon);
            })
            .map((x) => x.id)
        )
      : new Set(displaySelectedSigs.map((x) => x.id));
    setManualSoldSet(soldPreviewSet);
    setOneShotSold(effectiveOneShotSold);
    try {
      await finish({
        sessionId: effectiveSessionId,
        selectedSigs: displaySelectedSigs,
        oneShotResult: displayOneShot,
        soldSigIds: soldMarksActive ? soldSigIdsForFinish : undefined,
        oneShotInventorySold: effectiveOneShotSold,
        finalPhase: "CONFIRMED",
      });
    } catch (e) {
      setError("판매 확정 처리 실패");
      cancelConfirm();
      const detail = e instanceof Error ? e.message : String(e);
      setToast(
        detail === "finish_failed" || detail.includes("finish")
          ? `판매 확정 API 실패 — ${detail}`
          : `판매 확정 처리 실패: ${detail}`
      );
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
        sessionId: effectiveSessionId,
      },
      updatedAt: finishedAt,
    };
    let saved = await saveSigSalesManualStateAsync(next, userId);
    if (!saved.ok) {
      await new Promise((r) => setTimeout(r, 400));
      saved = await saveSigSalesManualStateAsync(next, userId);
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
    machine.startedAt,
    manualOneShotMarkSold,
    oneShotSold,
    displayOneShot,
    manualSoldSet,
    userId,
    finish,
    landed,
    markConfirmPending,
    setError,
    cancelConfirm,
    loadRemote,
    loadHistory,
    wheelDemoMode,
    displayOneShot,
  ]);

  onConfirmSaleRef.current = onConfirmSale;

  const tryAutoConfirmFullRound = useCallback(
    (soldSet: Set<string>, oneShotMarkSold: boolean) => {
      if (wheelDemoMode) return;
      if (machine.isFinishLoading || autoConfirmInFlightRef.current || manualBusy) return;
      const phase = state?.rouletteState?.phase || machine.phase;
      if (phase === "CONFIRMED" || phase === "CONFIRM_PENDING") return;
      if (
        phase !== "LANDED" &&
        !(
          isManualBroadcastRound && displaySelectedSigs.length >= MIN_ONE_SHOT_SIGS
        )
      ) {
        return;
      }
      if (
        !isFullRoundMarkedSold({
          displaySelectedSigs,
          soldSet,
          oneShotMarkSold,
          displayOneShot,
        })
      ) {
        return;
      }
      autoConfirmInFlightRef.current = true;
      setToast("당첨·한방 모두 판매 완료 — 전체 확정 처리 중…");
      const done = () => {
        autoConfirmInFlightRef.current = false;
      };
      if (manualOnly) {
        const flags = soldFlagsWithOneShotCascade(manualSigSoldFlags, oneShotMarkSold);
        void applyManualSelectionRef
          .current(true, {
            drafts: manualSigDrafts,
            soldFlags: flags,
            oneShotMarkSold: true,
          })
          .finally(done);
        return;
      }
      void onConfirmSaleRef.current().finally(done);
    },
    [
      wheelDemoMode,
      machine.phase,
      machine.isFinishLoading,
      state?.rouletteState?.phase,
      isManualBroadcastRound,
      displaySelectedSigs,
      displayOneShot,
      manualBusy,
      manualOnly,
      manualSigSoldFlags,
      manualSigDrafts,
    ]
  );

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
      void saveSigSalesManualStateAsync(next, userId);
      return next;
    });
  }, [userId]);

  const buildSoldSetFromFlags = useCallback(
    (flags: boolean[]) => {
      const next = new Set<string>();
      flags.forEach((sold, idx) => {
        if (!sold) return;
        const displayRow = displaySelectedSigs[idx];
        if (displayRow) {
          next.add(displayRow.id);
          next.add(canonicalSigIdFromWheelSliceId(displayRow.id));
          return;
        }
        const sid = String(manualSigDrafts[idx]?.sourceSigId || "").trim();
        if (sid) {
          next.add(sid);
          next.add(canonicalSigIdFromWheelSliceId(sid));
        }
      });
      return next;
    },
    [displaySelectedSigs, manualSigDrafts]
  );

  const buildLiveOneShotSnapshot = useCallback(
    (soldSet: Set<string>) => {
      const selected: Array<{ id: string; name: string; price: number }> =
        sigsForOneShotCalc.length >= MIN_ONE_SHOT_SIGS
          ? sigsForOneShotCalc
          : manualParsedRows.map((row, idx) => ({
              id:
                String(manualSigDrafts[idx]?.sourceSigId || "").trim() ||
                `manual_draft_${idx}_${normalizeManualNameKey(row.name)}`,
              name: row.name,
              price: row.price,
            }));
      if (selected.length < MIN_ONE_SHOT_SIGS) return null;
      return resolveOneShotDisplayPrice({
        selected,
        soldIdSet: soldSet,
        manualPriceInput: manualOneShotPriceInput,
        fallbackName: manualOneShotName,
      });
    },
    [sigsForOneShotCalc, manualParsedRows, manualSigDrafts, manualOneShotName, manualOneShotPriceInput]
  );

  const pushLiveRoundToServer = useCallback(
    async (
      nextInventory: SigItem[],
      soldSet: Set<string>,
      opts?: {
        toastLabel?: string;
        bumpOneShot?: boolean;
        unbumpOneShot?: boolean;
        sigSoldFlags?: boolean[];
        oneShotMarkSold?: boolean;
        bumpOverlay?: boolean;
      }
    ) => {
      if (!state) return;
      const oneShot = buildLiveOneShotSnapshot(soldSet);
      let inventory = nextInventory.map((row) =>
        row.id === ONE_SHOT_SIG_ID && oneShot
          ? { ...row, name: oneShot.name, price: oneShot.price }
          : row
      );
      if (opts?.bumpOneShot) {
        inventory = inventory.map((row) => {
          if (row.id !== ONE_SHOT_SIG_ID) return row;
          const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
          const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
          const nextSold = Math.min(maxCount, soldCount + 1);
          return {
            ...row,
            soldCount: nextSold,
            isActive: nextSold >= maxCount ? false : row.isActive,
          };
        });
      }
      if (opts?.unbumpOneShot) {
        inventory = inventory.map((row) => {
          if (row.id !== ONE_SHOT_SIG_ID) return row;
          const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
          const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)) - 1);
          return { ...row, soldCount, isActive: true };
        });
      }
      const selectedForState =
        displaySelectedSigs.length >= MIN_ONE_SHOT_SIGS
          ? displaySelectedSigs
          : (machine.selectedSigs?.length ?? 0) >= MIN_ONE_SHOT_SIGS
            ? machine.selectedSigs
            : undefined;
      const phase = state.rouletteState?.phase;
      const nextPhase =
        phase === "IDLE" || phase === "SPINNING" ? "LANDED" : phase || "LANDED";
      const flags = opts?.sigSoldFlags ?? manualSigSoldFlags;
      const prevOverlaySettings =
        state.overlaySettings && typeof state.overlaySettings === "object"
          ? (state.overlaySettings as Record<string, unknown>)
          : {};
      const manualDraftPayload = {
        inputMode: manualInputMode,
        drafts: manualSigDrafts,
        oneShotName: manualOneShotName,
        oneShotPriceInput: manualOneShotPriceInput,
        oneShotImageUrl: manualOneShotImageUrl,
        sigSoldFlags: flags,
        oneShotMarkSold: opts?.oneShotMarkSold ?? manualOneShotMarkSold,
      };
      manualDraftLastSavedRef.current = JSON.stringify(manualDraftPayload);
      const nextState: AppState = {
        ...state,
        sigInventory: inventory,
        overlaySettings: {
          ...prevOverlaySettings,
          [MANUAL_SIG_DRAFT_STATE_KEY]: manualDraftPayload,
        },
        rouletteState: {
          ...state.rouletteState,
          phase: nextPhase,
          isRolling: false,
          ...(selectedForState
            ? {
                selectedSigs: selectedForState,
                results: selectedForState,
                result: selectedForState[selectedForState.length - 1] || null,
              }
            : {}),
          oneShotResult: oneShot,
          ...(opts?.bumpOverlay
            ? {
                overlayReloadNonce: Number(state.rouletteState?.overlayReloadNonce || 0) + 1,
              }
            : {}),
        },
        updatedAt: Date.now(),
      };
      setState(nextState);
      const saved = await saveSigSalesManualStateAsync(nextState, userId);
      if (!saved.ok) {
        setToast("변경은 화면에 반영됐지만 서버 저장이 지연됩니다. 잠시 후 다시 시도하세요.");
      } else if (opts?.toastLabel) {
        setToast(`${opts.toastLabel} 판매 완료 반영`);
      }
    },
    [
      state,
      machine.sessionId,
      machine.selectedSigs,
      buildLiveOneShotSnapshot,
      displaySelectedSigs,
      userId,
      manualInputMode,
      manualSigDrafts,
      manualOneShotName,
      manualOneShotPriceInput,
      manualOneShotImageUrl,
      manualSigSoldFlags,
      manualOneShotMarkSold,
    ]
  );

  const markDisplaySigSoldByItem = useCallback(
    async (sig: SigItem, sold: boolean, manualIdxHint?: number) => {
      const canon = canonicalSigIdFromWheelSliceId(sig.id);
      const manualIdx =
        manualIdxHint ??
        resolveManualRowIndexForDisplaySig(sig, displaySelectedSigs, manualParsedRows, manualSigDrafts);

      const nextFlags = [...manualSigSoldFlags];
      while (nextFlags.length < 5) nextFlags.push(false);
      if (manualIdx >= 0 && manualIdx < 5) nextFlags[manualIdx] = sold;
      setManualSigSoldFlags(nextFlags);

      const nextSoldSet = buildSoldSetFromFlags(nextFlags);
      if (sold) {
        nextSoldSet.add(sig.id);
        nextSoldSet.add(canon);
      } else {
        nextSoldSet.delete(sig.id);
        nextSoldSet.delete(canon);
      }
      setManualSoldSet(nextSoldSet);

      if (!state) return;

      const parsed = manualIdx >= 0 ? manualParsedRows[manualIdx] : null;
      const lookupRow =
        parsed?.name && normalizeManualNameKey(parsed.name)
          ? parsed
          : { name: sig.name, price: sig.price };
      const label = lookupRow.name || sig.name;

      let nextInventory = [...(state.sigInventory || [])];
      const inv = findInventoryForDisplaySig(
        nextInventory,
        sig,
        manualIdx >= 0 ? manualSigDrafts[manualIdx]?.sourceSigId : sig.id
      );

      if (sold) {
        if (!inv) {
          setToast(`${label}: 재고에서 찾지 못해 표시만 반영했습니다.`);
        } else if (inv.soldCount >= inv.maxCount) {
          setToast(`${label}은(는) 이미 완판입니다.`);
        } else {
          nextInventory = bumpInventorySigSold(nextInventory, inv, true);
        }
        await pushLiveRoundToServer(nextInventory, nextSoldSet, {
          sigSoldFlags: nextFlags,
          oneShotMarkSold: manualOneShotMarkSold,
          bumpOverlay: true,
          toastLabel: label,
        });
        tryAutoConfirmFullRound(nextSoldSet, manualOneShotMarkSold);
        return;
      }

      if (inv) nextInventory = bumpInventorySigSold(nextInventory, inv, false);
      await pushLiveRoundToServer(nextInventory, nextSoldSet, {
        sigSoldFlags: nextFlags,
        oneShotMarkSold: manualOneShotMarkSold,
        bumpOverlay: true,
      });
      setToast(`${label} 판매완료 해제 · OBS 반영`);
    },
    [
      manualSigSoldFlags,
      manualOneShotMarkSold,
      buildSoldSetFromFlags,
      state,
      displaySelectedSigs,
      manualParsedRows,
      manualSigDrafts,
      pushLiveRoundToServer,
      tryAutoConfirmFullRound,
    ]
  );

  const markManualSigSoldImmediate = useCallback(
    async (idx: number, sold: boolean, displaySigHint?: SigItem) => {
      const displayRow = displaySigHint ?? displaySelectedSigs[idx];
      if (displayRow) {
        const manualIdx = resolveManualRowIndexForDisplaySig(
          displayRow,
          displaySelectedSigs,
          manualParsedRows,
          manualSigDrafts
        );
        await markDisplaySigSoldByItem(displayRow, sold, manualIdx >= 0 ? manualIdx : idx);
        return;
      }
      const parsed = manualParsedRows[idx];
      if (!parsed?.name) {
        const nextFlags = [...manualSigSoldFlags];
        while (nextFlags.length < 5) nextFlags.push(false);
        nextFlags[idx] = sold;
        setManualSigSoldFlags(nextFlags);
        const nextSoldSet = buildSoldSetFromFlags(nextFlags);
        setManualSoldSet(nextSoldSet);
        if (state) {
          await pushLiveRoundToServer(state.sigInventory || [], nextSoldSet, {
            sigSoldFlags: nextFlags,
            oneShotMarkSold: manualOneShotMarkSold,
            bumpOverlay: true,
          });
        }
        return;
      }
      await markDisplaySigSoldByItem(
        {
          id:
            String(manualSigDrafts[idx]?.sourceSigId || "").trim() ||
            `manual_row_${idx}_${normalizeManualNameKey(parsed.name)}`,
          name: parsed.name,
          price: parsed.price,
          imageUrl: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: false,
          isActive: true,
        },
        sold,
        idx
      );
    },
    [
      displaySelectedSigs,
      manualParsedRows,
      manualSigDrafts,
      manualSigSoldFlags,
      manualOneShotMarkSold,
      buildSoldSetFromFlags,
      state,
      markDisplaySigSoldByItem,
      pushLiveRoundToServer,
    ]
  );

  const toggleDisplaySigSold = useCallback(
    (id: string) => {
      const canon = canonicalSigIdFromWheelSliceId(id);
      const currently = manualSoldSet.has(id) || manualSoldSet.has(canon);
      const displaySig = displaySelectedSigs.find(
        (s) => s.id === id || canonicalSigIdFromWheelSliceId(s.id) === canon
      );
      if (displaySig) {
        void markDisplaySigSoldByItem(displaySig, !currently);
        return;
      }
      const nextSoldSet = new Set(manualSoldSet);
      if (currently) {
        nextSoldSet.delete(id);
        nextSoldSet.delete(canon);
      } else {
        nextSoldSet.add(id);
        nextSoldSet.add(canon);
      }
      setManualSoldSet(nextSoldSet);
      if (!state) return;
      void pushLiveRoundToServer(state.sigInventory || [], nextSoldSet, {
        sigSoldFlags: manualSigSoldFlags,
        oneShotMarkSold: manualOneShotMarkSold,
        bumpOverlay: true,
      });
    },
    [
      manualSoldSet,
      displaySelectedSigs,
      markDisplaySigSoldByItem,
      state,
      manualSigSoldFlags,
      manualOneShotMarkSold,
      pushLiveRoundToServer,
    ]
  );

  const markOneShotSoldImmediate = useCallback(
    async (sold: boolean) => {
      if (!state) return;
      if (!sold) {
        setManualOneShotMarkSold(false);
        setOneShotSold(false);
        const nextSoldSet = buildSoldSetFromFlags(manualSigSoldFlags);
        await pushLiveRoundToServer(state.sigInventory || [], nextSoldSet, {
          sigSoldFlags: manualSigSoldFlags,
          oneShotMarkSold: false,
          unbumpOneShot: true,
          bumpOverlay: true,
        });
        setToast("한방 판매완료 해제 · OBS 반영");
        return;
      }
      const cascadeFlags = soldFlagsWithOneShotCascade(manualSigSoldFlags, true);
      setManualSigSoldFlags(cascadeFlags);
      setManualOneShotMarkSold(true);
      setOneShotSold(true);
      const nextSoldSet = soldSetForFullManualRound(
        displaySelectedSigs,
        cascadeFlags,
        true
      );
      setManualSoldSet(nextSoldSet);

      let nextInventory = [...(state.sigInventory || [])];
      for (const sig of displaySelectedSigs) {
        const manualIdx = resolveManualRowIndexForDisplaySig(
          sig,
          displaySelectedSigs,
          manualParsedRows,
          manualSigDrafts
        );
        const inv = findInventoryForDisplaySig(
          nextInventory,
          sig,
          manualIdx >= 0 ? manualSigDrafts[manualIdx]?.sourceSigId : sig.id
        );
        if (inv && inv.soldCount < inv.maxCount) {
          nextInventory = bumpInventorySigSold(nextInventory, inv, true);
        }
      }

      await pushLiveRoundToServer(nextInventory, nextSoldSet, {
        sigSoldFlags: cascadeFlags,
        oneShotMarkSold: true,
        bumpOneShot: true,
        bumpOverlay: true,
        toastLabel: "한방 시그(당첨 전체)",
      });
      queueMicrotask(() => tryAutoConfirmFullRound(nextSoldSet, true));
    },
    [
      manualSigSoldFlags,
      state,
      displaySelectedSigs,
      manualParsedRows,
      manualSigDrafts,
      pushLiveRoundToServer,
      tryAutoConfirmFullRound,
    ]
  );

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
            <h1 className="text-2xl font-black text-yellow-200">
              {manualOnly ? "수동 시그 판매" : "시그 판매 회전판"}
            </h1>
            <p className="text-sm text-neutral-300">
              {manualOnly
                ? "회전판 없이 시그 5개·한방 입력 → OBS 수동 오버레이에 반영"
                : "IDLE → SPINNING → LANDED → CONFIRM_PENDING → CONFIRMED 단일 플로우"}
            </p>
            <p className="mt-1 text-xs text-yellow-200/90">
              현재 상태: {machine.phase}
              {manualOnly ? null : (
                <>
                  {" "}
                  · 회전판 {effectiveMenuCount}칸
                </>
              )}
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
                <span className="block rounded border border-rose-400/40 bg-rose-950/40 px-2 py-1.5 text-rose-100">
                  {manualOnly ? (
                    <>
                      수동 OBS: <code className="text-rose-50">/overlay/sig-sales-manual</code> (회전판 URL과 별도
                      소스). <code className="text-rose-50/90">/admin/...</code> 경로는 사용하지 마세요.
                    </>
                  ) : (
                    <>
                      회전판 OBS: <code className="text-rose-50">/overlay/sig-sales</code> · 수동 판매는{" "}
                      <Link href="/admin/sig-sales-manual" className="text-sky-300 underline">
                        오버레이 관리 → 수동 시그 판매
                      </Link>
                      .
                    </>
                  )}
                </span>
                OBS 소스 URL (u={userId}
                {memberFilterId ? ` · memberId=${memberFilterId}` : ""}):{" "}
                <code className="break-all text-emerald-300/90">
                  {manualOnly || overlayObsMode === "manual" ? overlayObsUrlManual : overlayObsUrl}
                </code>
                {manualOnly || overlayObsMode === "manual" ? (
                  <span className="mt-1 block text-sky-200/95">
                    시그 5개·한방 입력 → 「수동 결과 적용(LANDED)」 → OBS는 이 URL 고정(캐시 새로고침만).
                  </span>
                ) : null}
                {!manualOnly && wheelDemoMode ? (
                  <span className="mt-1 block text-amber-200/90">
                    로컬 휠 데모 · 회전판 {WHEEL_DEMO_MENU_COUNT}칸 · 당첨 {WHEEL_DEMO_WIN_COUNT}개 + 한방 시그(서버 미저장)
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {manualOnly ? (
              <Link
                href="/admin#overlay-settings"
                className="rounded-lg border border-sky-500/40 bg-sky-950/50 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/60"
              >
                오버레이 관리
              </Link>
            ) : (
              <Link
                href="/admin/sig-sales-manual"
                className="rounded-lg border border-sky-500/40 bg-sky-950/50 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/60"
              >
                수동 시그 판매
              </Link>
            )}
            <Link
              href={`/admin/obs-text?u=${encodeURIComponent(userId)}`}
              className="rounded-lg border border-violet-500/40 bg-violet-950/50 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-900/60"
            >
              OBS 텍스트
            </Link>
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
            {!manualOnly ? (
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
            ) : null}
            {!manualOnly ? (
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
            ) : null}
            {!manualOnly ? (
            <Link
              href="/admin?sigSales=wheel"
              className="rounded border border-white/20 bg-black/40 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10"
            >
              대시보드 모달
            </Link>
            ) : null}
            {manualOnly ? (
            <Link
              href="/admin/sig-sales"
              className="rounded border border-yellow-400/40 bg-yellow-950/40 px-3 py-2 text-xs font-bold text-yellow-100 hover:bg-yellow-900/50"
            >
              회전판 추첨
            </Link>
            ) : null}
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
            {!manualOnly ? (
            <button
              type="button"
              onClick={onResetRouletteIdle}
              disabled={loadingSpin || machine.isFinishLoading}
              className="rounded border border-amber-400/50 bg-amber-950/60 px-3 py-2 text-xs font-bold text-amber-100 hover:bg-amber-900/80 disabled:opacity-50"
            >
              회전판 초기화
            </button>
            ) : null}
            {!manualOnly ? (
            <button
              type="button"
              onClick={onRerollReset}
              disabled={loadingSpin || machine.isFinishLoading}
              title="랜덤 추첨이 아닙니다. 확정·착지 상태만 IDLE로 되돌린 뒤 「회전판 시작」으로 다시 추첨하세요."
              className="rounded bg-slate-700 px-4 py-2 text-sm font-bold hover:bg-slate-600 disabled:opacity-50"
            >
              회전 리셋
            </button>
            ) : null}
            {!manualOnly && wheelDemoMode ? (
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
            {overlayObsUrl && !manualOnly ? (
              <button
                type="button"
                className="rounded border border-white/20 px-2 py-2 text-xs text-neutral-200 hover:bg-white/10"
                onClick={() => {
                  const targetUrl = overlayObsUrl;
                  void (async () => {
                    const ok = await copyTextToClipboard(targetUrl);
                    setToast(
                      ok ? "OBS URL을 복사했습니다." : "복사 실패 — URL을 직접 선택해 복사하세요."
                    );
                  })();
                }}
              >
                회전판 URL 복사
              </button>
            ) : null}
            {overlayObsUrlManual && (manualOnly || overlayObsUrl) ? (
              <>
                <button
                  type="button"
                  className="rounded border border-sky-400/50 bg-sky-950/40 px-2 py-2 text-xs text-sky-100 hover:bg-sky-900/50"
                  onClick={() => {
                    void (async () => {
                      const ok = await copyTextToClipboard(overlayObsUrlManual);
                      setToast(
                        ok
                          ? "수동 결과 URL을 복사했습니다."
                          : "복사 실패 — URL을 직접 선택해 복사하세요."
                      );
                    })();
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
                <button
                  type="button"
                  disabled={manualBusy || manualRandomPool.length < 5}
                  title={
                    manualRandomPool.length < 5
                      ? "판매 가능 시그가 5개 미만입니다"
                      : "재고에서 시그 5개 랜덤 → 수동 OBS에 바로 반영(LANDED)"
                  }
                  className="rounded bg-fuchsia-700 px-3 py-2 text-xs font-bold text-white hover:bg-fuchsia-600 disabled:opacity-50"
                  onClick={() => void onRandomManualRerollAndObs()}
                >
                  {manualBusy ? "리롤 중…" : "리롤"}
                </button>
              </>
            ) : null}
            {!manualOnly ? (
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
            ) : null}
          </div>
        </header>
        {manualOnly && overlayObsUrlManual ? (
          <section className="rounded border border-sky-400/35 bg-sky-500/10 px-3 py-2">
            <div className="text-[11px] font-semibold text-sky-200">수동 모드 OBS URL (한 번만 등록)</div>
            <p className="mt-1 text-[10px] text-sky-100/75 leading-snug">
              시그 입력·판매 완료 체크 후에도 URL은 바뀌지 않습니다. OBS는 이 주소 그대로 두고 소스 새로고침만 하면 서버 상태가 반영됩니다.
            </p>
            <code className="mt-1 block break-all text-[11px] text-sky-100/95">{overlayObsUrlManual}</code>
          </section>
        ) : null}

        {!manualOnly && overlayObsUrlManual ? (
          <section className="rounded border border-sky-400/35 bg-sky-500/10 px-3 py-2">
            <div className="text-[11px] font-semibold text-sky-200">수동 시그 판매</div>
            <p className="mt-1 text-[10px] text-sky-100/75 leading-snug">
              회전판 없이 운영할 때는{" "}
              <Link href="/admin/sig-sales-manual" className="font-semibold text-sky-50 underline">
                수동 시그 판매(오버레이 관리)
              </Link>
              에서 설정하세요. OBS URL은 <code className="text-sky-100/90">/overlay/sig-sales-manual</code> 입니다.
            </p>
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

        {manualOnly ? (
        <section ref={manualSectionRef} className="rounded-xl border border-sky-300/30 bg-sky-500/10 p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-sky-100">수동 설정(5개 + 한방)</div>
            {manualWorkbench.broadcastSlotId ? (
              <span className="text-[11px] text-emerald-200/90">
                OBS 방송:{" "}
                {manualWorkbench.slots.find((s) => s.id === manualWorkbench.broadcastSlotId)?.name ??
                  "적용됨"}
              </span>
            ) : null}
          </div>
          {!manualOnly ? (
          <div className="mb-2 flex flex-wrap items-end gap-1 border-b border-sky-300/25 pb-2">
            {manualWorkbench.slots.map((slot) => {
              const isActive = slot.id === manualWorkbench.activeSlotId;
              const isBroadcast = slot.id === manualWorkbench.broadcastSlotId;
              return (
                <div key={slot.id} className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => switchManualSlot(slot.id)}
                    className={`rounded-t px-2.5 py-1 text-xs font-semibold ${
                      isActive
                        ? "bg-sky-400/30 text-sky-50 ring-1 ring-sky-300/50"
                        : "bg-black/25 text-sky-100/80 hover:bg-black/40"
                    }`}
                  >
                    {slot.name}
                    {isBroadcast ? (
                      <span className="ml-1 rounded bg-emerald-600/50 px-1 text-[9px] font-bold text-emerald-100">
                        OBS
                      </span>
                    ) : null}
                  </button>
                  {manualWorkbench.slots.length > 1 ? (
                    <button
                      type="button"
                      title={`${slot.name} 탭 닫기`}
                      onClick={() => removeManualSlot(slot.id)}
                      className="rounded px-1 py-0.5 text-[10px] text-sky-200/60 hover:bg-red-500/20 hover:text-red-200"
                    >
                      ×
                    </button>
                  ) : null}
                </div>
              );
            })}
            {manualWorkbench.slots.length < MAX_MANUAL_SIG_SLOTS ? (
              <button
                type="button"
                onClick={addManualSlot}
                className="rounded px-2 py-1 text-xs text-sky-100/90 hover:bg-sky-400/15"
              >
                + 탭
              </button>
            ) : null}
          </div>
          ) : null}
          {manualOnly ? (
            <p className="mb-3 text-[11px] text-sky-100/85">
              수동 판매는 <strong className="text-sky-50">회차·판매 이력에 저장하지 않습니다</strong>. 「리롤」·「수동
              결과 적용」만 OBS에 반영됩니다.
            </p>
          ) : (
            <p className="mb-3 text-[11px] text-sky-100/85">
              탭마다 5개+한방을 미리 채워 두고 전환할 수 있습니다. OBS 반영은 「수동 결과 적용」 시{" "}
              <strong className="font-semibold text-sky-50">현재 탭</strong>만 적용됩니다.
            </p>
          )}
          <p className="mb-3 text-[11px] text-sky-100/85">
            2가지 방식: 완전 수동 입력 / 기존 시그 선택. 재고 랜덤은 상단 「리롤」(OBS 반영) 또는 「리롤 (목록만)」(관리 화면만 채움). 회전판 랜덤은 「회전판 시작」.
            {manualRandomPool.length > 0 ? (
              <span className="ml-1 text-sky-50/90">
                (랜덤 풀: 활성 {manualRandomPool.length}개
                {memberFilterId ? "" : " · 멤버 미선택 시 전체 활성"})
              </span>
            ) : (
              <span className="ml-1 text-amber-200"> (랜덤 풀 없음 — 멤버·재고 확인)</span>
            )}
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
                      onChange={(e) => void markManualSigSoldImmediate(idx, e.target.checked)}
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
                  onChange={(e) => void markOneShotSoldImmediate(e.target.checked)}
                />
                한방도 판매완료 처리
              </label>
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded bg-black/30 px-2 py-1 text-neutral-300">
              자동합산: {manualAutoOneShotPrice.toLocaleString("ko-KR")}원
            </span>
            {manualSoldDeduction > 0 ? (
              <span className="rounded bg-rose-950/50 px-2 py-1 text-rose-200">
                판매 차감: −{manualSoldDeduction.toLocaleString("ko-KR")}원
              </span>
            ) : null}
            <span className="rounded bg-black/30 px-2 py-1 text-neutral-300">
              적용금액(한방): {manualParsedOneShotPrice.toLocaleString("ko-KR")}원
            </span>
            <button
              type="button"
              disabled={manualBusy || manualRandomPool.length < 5}
              className="rounded bg-violet-800/90 px-3 py-1.5 font-semibold text-violet-50 hover:bg-violet-700 disabled:opacity-50"
              onClick={fillRandomManualDrafts}
              title={
                manualRandomPool.length < 5
                  ? "판매 가능 시그가 5개 미만입니다"
                  : "활성 재고에서 서로 다른 시그 5개를 랜덤 채움"
              }
            >
              리롤 (목록만)
            </button>
            <button
              type="button"
              disabled={manualBusy || manualRandomPool.length < 5}
              className="rounded bg-fuchsia-800/90 px-3 py-1.5 font-semibold text-fuchsia-50 hover:bg-fuchsia-700 disabled:opacity-50"
              onClick={onRandomManualRerollAndObs}
              title="라운드 리셋 후 랜덤 5개를 OBS(수동 URL)에 바로 반영"
            >
              {manualBusy ? "리롤 중…" : "리롤"}
            </button>
            {!manualOnly ? (
            <button
              type="button"
              disabled={manualBusy}
              className="rounded bg-amber-800/90 px-3 py-1.5 font-semibold text-amber-50 hover:bg-amber-700 disabled:opacity-50"
              onClick={onResetManualRoundForResale}
            >
              라운드 리셋 → 재판매
            </button>
            ) : null}
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
              {manualBusy ? "처리 중..." : manualOnly ? "판매 완료(재고)" : "수동 적용 + 판매 완료(CONFIRMED)"}
            </button>
          </div>
          {manualDebugInfo ? (
            <div className="mt-2 rounded border border-fuchsia-300/40 bg-fuchsia-500/10 px-2 py-1 text-[11px] text-fuchsia-100 break-all">
              디버그: {manualDebugInfo}
            </div>
          ) : null}
        </section>
        ) : null}

        <section style={{ backgroundColor: "transparent" }} className="relative rounded-2xl border border-yellow-200/20 p-4">
          {lastConfirmedText ? (
            <div
              key={`confirmed-fx-${lastConfirmedFxKey}`}
              className="pointer-events-none absolute left-4 top-1/2 z-40 -translate-y-1/2 rounded-2xl border border-fuchsia-300/80 bg-fuchsia-500/25 px-5 py-3 text-3xl font-black text-fuchsia-100 shadow-[0_0_26px_rgba(217,70,239,0.6)] animate-pulse"
            >
              {lastConfirmedText}
            </div>
          ) : null}
          {!manualOnly && overlayObsMode !== "manual" && !hideWheelAfterSpin ? <RouletteWheel
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

          {(preferManualDraftPreview ||
            machine.phase === "SPINNING" ||
            machine.phase === "LANDED" ||
            machine.phase === "CONFIRM_PENDING" ||
            machine.phase === "CONFIRMED" ||
            stagedSelected.length > 0 ||
            manualPreviewSelected.length > 0) &&
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
                  soldOverrideSet={adminSoldOverrideSet}
                  disabled={controlsDisabled}
                  highlightId={highlightId}
                  compact
                  matchOneShotCardSize
                  cardScalePct={resultRowLayout.cardScalePct}
                  disableCardMotion={showFinalShowcase}
                  compactGridJustify="start"
                  className="w-max max-w-full shrink-0"
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
                        onToggleSold={() => void markOneShotSoldImmediate(!oneShotSold)}
                      />
                    ) : null
                  }
                  onToggleSold={(id) => toggleDisplaySigSold(id)}
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

          {machine.phase === "CONFIRMED" || state?.rouletteState?.phase === "CONFIRMED" ? (
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

        {!manualOnly ? (
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
        ) : null}
        <section className="rounded-xl border border-white/10 bg-black/35 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-neutral-200">시그 관리 (멤버 지정)</h2>
            <button
              type="button"
              title="같은 이미지 URL(경로 기준) 또는 같은 시그 이름은 첫 행만 유지"
              className="rounded bg-amber-900/80 px-3 py-1.5 text-xs font-bold hover:bg-amber-800 disabled:opacity-50"
              onClick={() => dedupeSigInventoryItems("imageUrl")}
            >
              중복 제거(URL·이름)
            </button>
            <button
              type="button"
              title="같은 이름+가격은 첫 행만 유지"
              className="rounded bg-amber-900/80 px-3 py-1.5 text-xs font-bold hover:bg-amber-800 disabled:opacity-50"
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
