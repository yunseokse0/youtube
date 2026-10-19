"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AppState } from "@/lib/state";
import {
  loadState,
  loadStateFromApi,
  saveSigSalesManualStateAsync,
  saveState,
  isRicherSigInventory,
  shouldPreferLocalSigInventoryOverIncoming,
} from "@/lib/state";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { buildSigSalesManualOverlayUrl } from "@/lib/sig-sales-overlay-urls";
import { DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE, resolveSigOverlayCardImageUrl } from "@/lib/constants";
import SigSaleMedia from "@/components/sig-sales/SigSaleMedia";
import SigSalesStampAndOneShotPanel from "@/components/admin/SigSalesStampAndOneShotPanel";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import {
  mergeManualSigBroadcastIntoOverlaySettings,
  readManualSigBroadcastFromState,
} from "@/lib/manual-sig-broadcast-state";
import {
  buildManualSigBroadcastState,
  buildManualSigSalesConfirmState,
  buildManualSigSoldPersistState,
  MANUAL_REROLL_MIN_POOL,
  pickRandomManualSigBundle,
  readManualSigDraftFromState,
  resolveManualOneShotDisplayFromState,
  resolveManualOverlaySelectedSigs,
  buildManualPanelSaleRows,
} from "@/lib/manual-sig-broadcast";
import { parseSigMetaFromFileName } from "@/lib/sig-filename-meta";
import { SigSalesPanelChrome } from "@/components/sig-sales/SigSalesPanelChrome";
import { formatSigSalesWon, sigSalesPanelStatusLabel } from "@/lib/sig-sales-panel-ui";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { SigItem } from "@/types";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  computeManualSoldTotal,
  emptyManualSoldFlags,
  MANUAL_SIG_GRID_COLS_KEY,
  MANUAL_SIG_GRID_ROWS_KEY,
  MANUAL_SIG_PANEL_ORIENTATION_KEY,
  MANUAL_SIG_PICK_COUNT_KEY,
  MANUAL_SIG_SLOT_PRICE_BANDS_KEY,
  MAX_MANUAL_SIG_GRID_COLS,
  MAX_MANUAL_SIG_GRID_ROWS,
  MAX_MANUAL_SIG_PICK_COUNT,
  MIN_MANUAL_SIG_GRID_COLS,
  MIN_MANUAL_SIG_GRID_ROWS,
  MIN_MANUAL_SIG_PICK_COUNT,
  normalizeManualSigDraftPersist,
  normalizeManualSigGrid,
  normalizeManualSigSlotPriceBands,
  readManualSigGridFromOverlaySettings,
  readManualSigPanelOrientationFromOverlaySettings,
  readManualSigSlotPriceBandsFromOverlaySettings,
  readToonaDefaultAlertImageFromOverlaySettings,
  resizeManualDrafts,
  resizeManualSoldFlags,
  type ManualSigSlotPriceBand,
  type SigSalesPanelOrientation,
} from "@/lib/manual-sig-workbench";

const SIG_INVENTORY_IMPORTED_EVENT = "youtube-sig-inventory-imported";
const MAX_SIG_UPLOAD_BYTES = 30 * 1024 * 1024;

export default function ManualSigSalesSimple() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [state, setState] = useState<AppState | null>(null);
  const [memberFilterId, setMemberFilterId] = useState("");
  /** 행·열·개수 입력 중 중간값이 바로 저장되어 기본 5로 튕기지 않게 로컬 초안 */
  const [rowsDraft, setRowsDraft] = useState("1");
  const [colsDraft, setColsDraft] = useState("5");
  const [pickCountDraft, setPickCountDraft] = useState("5");
  const [priceDraftByIdx, setPriceDraftByIdx] = useState<Record<number, string>>({});
  const [bandDraftByIdx, setBandDraftByIdx] = useState<Record<number, { min: string; max: string }>>(
    {}
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [defaultPrice, setDefaultPrice] = useState("10000");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  /** finalent 기본값 금지 — 로그인 전 타 계정 인벤을 불러오지 않음 */
  const userId = String(user?.id || "").trim();

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.user?.id) setUser(data.user);
        else router.replace("/login");
      })
      .finally(() => setAuthReady(true));
  }, [router]);

  const loadRemote = useCallback(async () => {
    if (!userId) return;
    const remote = await loadStateFromApi(userId, { forceFull: true });
    if (remote) {
      const local = loadState(userId);
      if (
        local &&
        shouldPreferLocalSigInventoryOverIncoming(local.sigInventory, remote.sigInventory, {
          localUpdatedAt: Number(local.updatedAt || 0),
          incomingUpdatedAt: Number(remote.updatedAt || 0),
        })
      ) {
        setState({ ...remote, sigInventory: local.sigInventory });
        return;
      }
      setState(remote);
      try {
        saveState(remote, userId);
      } catch {
        /* ignore */
      }
      return;
    }
    const local = loadState(userId);
    if (local) setState(local);
  }, [userId]);

  useEffect(() => {
    if (!authReady || !userId) return;
    void loadRemote();
  }, [authReady, userId, loadRemote]);

  useEffect(() => {
    if (!authReady || !userId) return;
    const onFocus = () => void loadRemote();
    const onImported = () => void loadRemote();
    window.addEventListener("focus", onFocus);
    window.addEventListener(SIG_INVENTORY_IMPORTED_EVENT, onImported);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(SIG_INVENTORY_IMPORTED_EVENT, onImported);
    };
  }, [authReady, userId, loadRemote]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  const inventoryCount = useMemo(
    () => (state?.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).length,
    [state?.sigInventory]
  );

  const pool = useMemo(
    () =>
      listActiveManualSigPool(state?.sigInventory, {
        memberFilterId: memberFilterId || undefined,
        sigSalesExcludedIds: state?.sigSalesExcludedIds,
        ignoreStock: true,
        ownerUserId: userId || undefined,
      }),
    [state?.sigInventory, state?.sigSalesExcludedIds, memberFilterId, userId]
  );

  const priceExcludedCount = useMemo(() => {
    const inv = state?.sigInventory || [];
    let n = 0;
    for (const row of inv) {
      if (row.id === ONE_SHOT_SIG_ID) continue;
      if (String(row.name || "").trim() && Math.floor(Number(row.price || 0)) <= 0) n += 1;
    }
    return n;
  }, [state?.sigInventory]);

  const overlayUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildSigSalesManualOverlayUrl(window.location.origin, userId, {
      memberId: memberFilterId || undefined,
      sigResultScalePct: 92,
    });
  }, [userId, memberFilterId]);

  const currentPhase = state
    ? (() => {
        const b = readManualSigBroadcastFromState(state);
        return b?.phase ?? "IDLE";
      })()
    : "IDLE";
  const overlayOs = useMemo(
    () =>
      state?.overlaySettings && typeof state.overlaySettings === "object"
        ? (state.overlaySettings as Record<string, unknown>)
        : null,
    [state]
  );
  const panelGrid = useMemo(() => readManualSigGridFromOverlaySettings(overlayOs), [overlayOs]);
  const panelOrientation = useMemo(
    () => readManualSigPanelOrientationFromOverlaySettings(overlayOs),
    [overlayOs]
  );
  const pickCount = panelGrid.pickCount;
  const slotPriceBands = useMemo(
    () => readManualSigSlotPriceBandsFromOverlaySettings(overlayOs, pickCount),
    [overlayOs, pickCount]
  );
  const toonaDefaultImageUrl = useMemo(
    () => readToonaDefaultAlertImageFromOverlaySettings(overlayOs),
    [overlayOs]
  );
  useEffect(() => {
    setRowsDraft(String(panelGrid.rows));
    setColsDraft(String(panelGrid.cols));
    setPickCountDraft(String(panelGrid.pickCount));
  }, [panelGrid.rows, panelGrid.cols, panelGrid.pickCount]);
  useEffect(() => {
    setBandDraftByIdx({});
  }, [pickCount, slotPriceBands]);
  const draft = useMemo(() => readManualSigDraftFromState(state), [state]);
  const displaySigs = useMemo(
    () => resolveManualOverlaySelectedSigs(state, userId),
    [state, userId]
  );
  const soldFlags = useMemo(() => {
    const raw = draft?.sigSoldFlags;
    if (!Array.isArray(raw)) return emptyManualSoldFlags(pickCount);
    return resizeManualSoldFlags(raw, pickCount);
  }, [draft?.sigSoldFlags, pickCount]);
  const oneShotMarkSold = Boolean(draft?.oneShotMarkSold);

  const saleRows = useMemo(
    () => buildManualPanelSaleRows(state, userId),
    [state, userId]
  );
  const needsRerollForPickCount =
    displaySigs.length > 0 && displaySigs.length < pickCount;

  const currentNames = displaySigs.map((s) => s.name).join(", ");
  const oneShotLabel = useMemo(() => {
    const resolved = resolveManualOneShotDisplayFromState(state, displaySigs, userId);
    if (resolved) {
      return `${resolved.name} ${resolved.price.toLocaleString("ko-KR")}원`;
    }
    const os = readManualSigBroadcastFromState(state)?.oneShotResult;
    if (!os) return null;
    return `${os.name} ${Number(os.price || 0).toLocaleString("ko-KR")}원`;
  }, [state, displaySigs, userId]);
  const rerollPickCount = Math.min(pickCount, pool.length);
  const canReroll = pool.length >= pickCount;
  const hasAnySoldMark =
    soldFlags.some(Boolean) || oneShotMarkSold;
  const phase = String(currentPhase || "");
  const soldTotal = useMemo(() => {
    const prices = Array.from({ length: pickCount }, (_, i) => {
      const row = saleRows.find((r) => r.draftIdx === i);
      return row?.price || 0;
    });
    const oneShotPrice = (() => {
      const resolved = resolveManualOneShotDisplayFromState(state, displaySigs, userId);
      if (resolved) return resolved.price;
      return Number(readManualSigBroadcastFromState(state)?.oneShotResult?.price || 0);
    })();
    return computeManualSoldTotal(prices, soldFlags, {
      oneShotSold: oneShotMarkSold,
      oneShotPrice,
    });
  }, [pickCount, saleRows, soldFlags, oneShotMarkSold, state, displaySigs, userId]);

  const persistState = useCallback(
    async (
      next: AppState,
      okMsg: string,
      failMsg: string,
      saveOpts?: { omitSigInventory?: boolean }
    ) => {
      setState(next);
      const saved = await saveSigSalesManualStateAsync(next, userId, saveOpts);
      if (saved.ok) {
        const remote = await loadStateFromApi(userId, { forceFull: true });
        if (remote) {
          /** 방금 추가한 시그를 구 GET(1~2개 차이)이 지워 버리지 않게, 더 풍부한 인벤만 수용 */
          const inventory = isRicherSigInventory(remote.sigInventory, next.sigInventory)
            ? remote.sigInventory
            : next.sigInventory;
          const nextOs =
            next.overlaySettings && typeof next.overlaySettings === "object"
              ? (next.overlaySettings as Record<string, unknown>)
              : {};
          const remoteOs =
            remote.overlaySettings && typeof remote.overlaySettings === "object"
              ? (remote.overlaySettings as Record<string, unknown>)
              : {};
          /** 개수·그리드 키가 GET에 아직 없으면 방금 저장값을 유지(기본 5 회귀 방지) */
          const overlaySettings = {
            ...remoteOs,
            ...Object.fromEntries(
              [
                MANUAL_SIG_PICK_COUNT_KEY,
                MANUAL_SIG_GRID_ROWS_KEY,
                MANUAL_SIG_GRID_COLS_KEY,
                MANUAL_SIG_PANEL_ORIENTATION_KEY,
                MANUAL_SIG_DRAFT_STATE_KEY,
                MANUAL_SIG_SLOT_PRICE_BANDS_KEY,
              ]
                .filter((k) => nextOs[k] != null && nextOs[k] !== "")
                .map((k) => [k, nextOs[k]])
            ),
          } as AppState["overlaySettings"];
          setState({ ...remote, sigInventory: inventory, overlaySettings });
        }
      }
      setToast(saved.ok ? okMsg : failMsg);
      return saved.ok;
    },
    [userId]
  );

  const onReroll = useCallback(async () => {
    if (!state) return;
    if (!canReroll) {
      setToast(
        `판매 중 시그가 ${pool.length}개뿐입니다. (${MANUAL_REROLL_MIN_POOL}개 이상 필요, 한방 시그 제외)`
      );
      return;
    }
    setBusy(true);
    try {
      const bundle = pickRandomManualSigBundle(state, userId, {
        memberFilterId: memberFilterId || undefined,
        pickCount,
      });
      if (!bundle) {
        const hasBand = slotPriceBands.some((b) => b.min > 0 || b.max > 0);
        setToast(
          hasBand
            ? "리롤 실패: 칸별 금액대에 맞는 시그가 부족합니다. 금액대를 넓히거나 시그를 추가하세요."
            : "리롤 실패 — 판매 가능 시그를 확인하세요."
        );
        return;
      }
      const drafts = bundle.selected.map((s) => ({
        sourceSigId: s.id,
        name: s.name,
        priceInput: String(Math.floor(Number(s.price || 0))),
        imageUrl: String(s.imageUrl || "").trim(),
      }));
      const persistDrafts = normalizeManualSigDraftPersist(
        {
          inputMode: "inventory",
          drafts,
          oneShotName: bundle.oneShot.name,
          oneShotPriceInput: String(bundle.oneShot.price),
          oneShotImageUrl:
            String((state.sigInventory || []).find((x) => x.id === ONE_SHOT_SIG_ID)?.imageUrl || "").trim() ||
            DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
          sigSoldFlags: emptyManualSoldFlags(pickCount),
          oneShotMarkSold: false,
        },
        pickCount
      );
      const next = buildManualSigBroadcastState(
        state,
        bundle.selected,
        bundle.oneShot,
        persistDrafts ? { persistDrafts } : undefined
      );
      await persistState(
        next,
        `리롤 · OBS 반영: ${bundle.selected.map((s) => s.name).join(", ")}`,
        "리롤은 적용됐지만 서버 저장이 지연됩니다. OBS 새로고침 후 확인하세요.",
        { omitSigInventory: true }
      );
    } catch (e) {
      setToast(`리롤 실패: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [state, canReroll, pool.length, userId, memberFilterId, persistState, pickCount, slotPriceBands]);

  const persistSlotPriceBands = useCallback(
    async (bands: ManualSigSlotPriceBand[]) => {
      if (!state) return;
      const normalized = normalizeManualSigSlotPriceBands(bands, pickCount);
      const prevOs =
        state.overlaySettings && typeof state.overlaySettings === "object"
          ? (state.overlaySettings as Record<string, unknown>)
          : {};
      const next: AppState = {
        ...state,
        updatedAt: Date.now(),
        overlaySettings: {
          ...prevOs,
          [MANUAL_SIG_SLOT_PRICE_BANDS_KEY]: normalized,
        } as AppState["overlaySettings"],
      };
      await persistState(next, "칸별 금액대 저장됨", "금액대 저장이 지연됩니다.", {
        omitSigInventory: true,
      });
    },
    [state, pickCount, persistState]
  );

  const persistPanelLayout = useCallback(
    async (rowsRaw: number, colsRaw: number, orientation: SigSalesPanelOrientation) => {
      if (!state) return;
      const grid = normalizeManualSigGrid(rowsRaw, colsRaw);
      const n = grid.pickCount;
      setRowsDraft(String(grid.rows));
      setColsDraft(String(grid.cols));
      setPickCountDraft(String(n));
      const prevOs =
        state.overlaySettings && typeof state.overlaySettings === "object"
          ? (state.overlaySettings as Record<string, unknown>)
          : {};
      const prevDraft = readManualSigDraftFromState(state);
      const nextDraft = prevDraft
        ? {
            ...prevDraft,
            drafts: resizeManualDrafts(prevDraft.drafts || [], n),
            sigSoldFlags: resizeManualSoldFlags(prevDraft.sigSoldFlags || [], n),
          }
        : undefined;
      const nextBands = normalizeManualSigSlotPriceBands(
        prevOs[MANUAL_SIG_SLOT_PRICE_BANDS_KEY],
        n
      );
      const next: AppState = {
        ...state,
        updatedAt: Date.now(),
        overlaySettings: {
          ...prevOs,
          [MANUAL_SIG_PICK_COUNT_KEY]: n,
          [MANUAL_SIG_GRID_ROWS_KEY]: grid.rows,
          [MANUAL_SIG_GRID_COLS_KEY]: grid.cols,
          [MANUAL_SIG_PANEL_ORIENTATION_KEY]: orientation,
          [MANUAL_SIG_SLOT_PRICE_BANDS_KEY]: nextBands,
          ...(nextDraft ? { [MANUAL_SIG_DRAFT_STATE_KEY]: nextDraft } : {}),
        } as AppState["overlaySettings"],
      };
      await persistState(
        next,
        `${grid.rows}×${grid.cols} (${n}칸) · ${orientation === "portrait" ? "세로형" : "가로형"} · 리롤하면 OBS 반영`,
        "판넬 설정 저장이 지연됩니다."
      );
    },
    [state, persistState]
  );

  /** 칸별 판매가 — ROLL 전에도 초안에 저장, ROLL 후면 OBS 당첨 금액도 갱신 */
  const onCommitCellPrice = useCallback(
    async (draftIdx: number, priceRaw: string) => {
      if (!state || draftIdx < 0 || draftIdx >= pickCount) return;
      const price = Math.max(0, Math.floor(Number(String(priceRaw).replace(/[^\d]/g, "")) || 0));
      const row = saleRows.find((r) => r.draftIdx === draftIdx);
      const prevDraft = readManualSigDraftFromState(state);
      const drafts = resizeManualDrafts(prevDraft?.drafts || [], pickCount);
      const cur = drafts[draftIdx] || {
        sourceSigId: "",
        name: "",
        priceInput: "",
        imageUrl: "",
      };
      const prevPrice = Math.max(0, Math.floor(Number(String(cur.priceInput || "").replace(/[^\d]/g, "")) || 0));
      if (prevPrice === price && (!row || row.price === price)) return;
      drafts[draftIdx] = {
        ...cur,
        name: cur.name || row?.name || "",
        imageUrl: cur.imageUrl || row?.imageUrl || "",
        priceInput: String(price),
      };
      const persistDrafts = normalizeManualSigDraftPersist(
        {
          inputMode: prevDraft?.inputMode || "inventory",
          drafts,
          oneShotName: prevDraft?.oneShotName || "한방 시그",
          oneShotPriceInput: prevDraft?.oneShotPriceInput || "",
          oneShotImageUrl: prevDraft?.oneShotImageUrl || DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
          sigSoldFlags: soldFlags,
          oneShotMarkSold,
        },
        pickCount
      );
      let next = buildManualSigSoldPersistState(state, {
        sigSoldFlags: soldFlags,
        oneShotMarkSold,
        persistDrafts,
        userId,
      });
      const broadcast = readManualSigBroadcastFromState(next);
      if (broadcast?.selectedSigs?.length) {
        const selectedSigs = broadcast.selectedSigs.map((s, i) =>
          i === draftIdx ? { ...s, price } : s
        );
        next = {
          ...next,
          overlaySettings: mergeManualSigBroadcastIntoOverlaySettings(next, {
            ...broadcast,
            selectedSigs,
          }),
          updatedAt: Date.now(),
        };
      }
      setBusy(true);
      try {
        const label = row?.name || `${draftIdx + 1}칸`;
        await persistState(
          next,
          `${label} 가격 ${price.toLocaleString("ko-KR")}원`,
          "가격 저장이 지연됩니다.",
          { omitSigInventory: true }
        );
      } finally {
        setBusy(false);
      }
    },
    [state, pickCount, saleRows, soldFlags, oneShotMarkSold, userId, persistState]
  );

  const onConfirmSales = useCallback(
    async (opts?: { onlyDraftIdx?: number }) => {
      if (!state) return;
      if (displaySigs.length < MANUAL_REROLL_MIN_POOL) {
        setToast("당첨 시그가 없습니다. 먼저 리롤을 실행하세요.");
        return;
      }
      const onlyIdx = opts?.onlyDraftIdx;
      if (onlyIdx != null && soldFlags[onlyIdx]) {
        setToast("이미 확정된 시그입니다.");
        return;
      }
      const flagsForConfirm =
        onlyIdx != null && onlyIdx >= 0 && onlyIdx < pickCount
          ? (() => {
              const merged = [...soldFlags];
              merged[onlyIdx] = true;
              return merged;
            })()
          : soldFlags;
      const oneShotForConfirm = onlyIdx != null ? oneShotMarkSold : oneShotMarkSold;
      const hasMark =
        onlyIdx != null ? true : flagsForConfirm.some(Boolean) || oneShotMarkSold;
      if (!hasMark) {
        setToast("판매완료할 시그를 체크한 뒤 「판매 확정」을 누르세요.");
        return;
      }
      const rowIndices = saleRows.map((r) => r.draftIdx);
      const allRowsConfirmed = rowIndices.every((i) => flagsForConfirm[i]);
      const oneShotRequired = Boolean(oneShotLabel);
      const oneShotDone = !oneShotRequired || oneShotForConfirm;
      const closeRound = allRowsConfirmed && oneShotDone;
      setBusy(true);
      try {
        const next = buildManualSigSalesConfirmState(state, {
          selected: displaySigs,
          sigSoldFlags: flagsForConfirm,
          oneShotMarkSold: oneShotForConfirm,
          userId,
          previousSoldFlags: soldFlags,
          previousOneShotMarkSold: oneShotMarkSold,
          closeRound,
        });
        const row = onlyIdx != null ? saleRows.find((r) => r.draftIdx === onlyIdx) : null;
        const ok = await persistState(
          next,
          row
            ? `${row.name} 판매 확정 · OBS 반영`
            : closeRound
              ? "판매 확정 완료 · OBS 반영"
              : "선택 시그 판매 확정 · 나머지 계속 가능",
          "판매 확정은 적용됐지만 서버 저장이 지연됩니다. OBS 새로고침 후 확인하세요.",
          { omitSigInventory: true }
        );
        if (ok) void loadRemote();
      } catch (e) {
        setToast(`판매 확정 실패: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [
      state,
      displaySigs,
      soldFlags,
      oneShotMarkSold,
      oneShotLabel,
      saleRows,
      userId,
      persistState,
      loadRemote,
    ]
  );

  const onToggleSigSold = useCallback(
    async (idx: number, sold: boolean) => {
      if (!state || idx < 0 || idx >= pickCount) return;
      const nextFlags = [...soldFlags];
      nextFlags[idx] = sold;
      setBusy(true);
      try {
        const next = buildManualSigSoldPersistState(state, {
          sigSoldFlags: nextFlags,
          oneShotMarkSold,
          userId,
        });
        const row = saleRows.find((r) => r.draftIdx === idx);
        const label = row?.name || `시그 ${idx + 1}`;
        await persistState(
          next,
          sold ? `${label} 판매완료 · OBS 반영` : `${label} 판매완료 해제 · OBS 반영`,
          "표시는 바뀌었지만 서버 저장이 지연됩니다. OBS 새로고침 후 확인하세요."
        );
      } catch (e) {
        setToast(`판매완료 처리 실패: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [state, soldFlags, oneShotMarkSold, saleRows, persistState, pickCount]
  );

  const onToggleOneShotSold = useCallback(
    async (sold: boolean) => {
      if (!state) return;
      setBusy(true);
      try {
        const nextFlags = sold ? soldFlags.map(() => true) : [...soldFlags];
        const next = buildManualSigSoldPersistState(state, {
          sigSoldFlags: nextFlags,
          oneShotMarkSold: sold,
          userId,
        });
        await persistState(
          next,
          sold ? "한방 시그 판매완료 · OBS 반영" : "한방 판매완료 해제 · OBS 반영",
          "표시는 바뀌었지만 서버 저장이 지연됩니다. OBS 새로고침 후 확인하세요."
        );
      } catch (e) {
        setToast(`한방 판매완료 처리 실패: ${String(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [state, soldFlags, persistState]
  );

  const uploadOneImage = useCallback(
    async (file: File): Promise<string | null> => {
      const mime = String(file.type || "").toLowerCase();
      const name = String(file.name || "").toLowerCase();
      if (!/image\/(gif|png|jpe?g|webp)/i.test(mime) && !/\.(gif|png|jpe?g|webp)$/i.test(name)) {
        setToast("gif, png, jpg, webp 파일만 올릴 수 있습니다.");
        return null;
      }
      if (file.size > MAX_SIG_UPLOAD_BYTES) {
        setToast(`이미지 용량이 30MB를 초과합니다. (${(file.size / (1024 * 1024)).toFixed(1)}MB)`);
        return null;
      }
      const fd = new FormData();
      fd.append("file", file);
      const q = new URLSearchParams({ user: userId, u: userId, skipMirror: "1" });
      const res = await fetch(`/api/upload/sig-image?${q.toString()}`, {
        method: "POST",
        credentials: "include",
        headers: { "x-user-id": userId, "x-sig-upload-skip-mirror": "1" },
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
      if (!res.ok || !j.ok || !j.url) {
        setToast(`이미지 업로드 실패(${res.status}): ${j.error || file.name}`);
        return null;
      }
      return j.url;
    },
    [userId]
  );

  const onStampFile = useCallback(
    async (file: File | null) => {
      if (!state || !file) return;
      setBusy(true);
      try {
        const url = await uploadOneImage(file);
        if (!url) return;
        await persistState(
          { ...state, sigSoldOutStampUrl: url, updatedAt: Date.now() },
          "판매 완료 이미지를 저장했습니다.",
          "이미지는 올렸지만 서버 저장이 지연됩니다."
        );
      } finally {
        setBusy(false);
      }
    },
    [state, persistState, uploadOneImage]
  );

  const onResetStamp = useCallback(async () => {
    if (!state) return;
    await persistState(
      { ...state, sigSoldOutStampUrl: "", updatedAt: Date.now() },
      "기본 판매 완료 도장을 사용합니다.",
      "설정 저장이 지연됩니다."
    );
  }, [state, persistState]);

  const onOneShotFile = useCallback(
    async (file: File | null) => {
      if (!state || !file) return;
      setBusy(true);
      try {
        const url = await uploadOneImage(file);
        if (!url) return;
        const inv = state.sigInventory || [];
        const has = inv.some((x) => x.id === ONE_SHOT_SIG_ID);
        const nextInv = has
          ? inv.map((x) => (x.id === ONE_SHOT_SIG_ID ? { ...x, imageUrl: url, isActive: true } : x))
          : [
              ...inv,
              {
                id: ONE_SHOT_SIG_ID,
                name: "한방 시그",
                price: 0,
                imageUrl: url,
                memberId: "",
                maxCount: 1,
                soldCount: 0,
                isRolling: false,
                isActive: true,
              },
            ];
        await persistState(
          { ...state, sigInventory: nextInv, updatedAt: Date.now() },
          "한방 시그 이미지를 저장했습니다.",
          "이미지는 올렸지만 서버 저장이 지연됩니다."
        );
      } finally {
        setBusy(false);
      }
    },
    [state, persistState, uploadOneImage]
  );

  const onImportFromHub = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/toona/hub", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import-signatures" }),
        signal: AbortSignal.timeout(12_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        deferred?: boolean;
      };
      if (!res.ok || data.ok === false) {
        setToast(data.error || "시그 가져오기 실패");
        return;
      }
      setToast(
        data.deferred
          ? "시그 가져오기는 백그라운드에서 진행 중. 잠시 후 이 페이지를 새로고침해 주세요."
          : "시그를 가져왔습니다."
      );
      window.setTimeout(() => {
        void loadRemote();
      }, 5000);
    } catch {
      setToast("시그 가져오기 실패 — 아래 PC 업로드를 사용하거나 시그 판매 관리에서 올려 주세요.");
    } finally {
      setBusy(false);
    }
  }, [loadRemote]);

  const onUploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!state) return;
      const files = Array.from(fileList || []).filter((f) => {
        const mime = String(f.type || "").toLowerCase();
        const name = String(f.name || "").toLowerCase();
        return /image\/(gif|png|jpe?g|webp)/i.test(mime) || /\.(gif|png|jpe?g|webp)$/i.test(name);
      });
      if (!files.length) {
        setToast("gif, png, jpg, webp 파일만 올릴 수 있습니다.");
        return;
      }
      const fallbackPrice = Math.max(0, Math.floor(Number(defaultPrice || 0) || 0));
      setBusy(true);
      try {
        const nextInventory: SigItem[] = [...(state.sigInventory || [])];
        let added = 0;
        let updated = 0;
        let failed = 0;
        for (const file of files) {
          if (file.size > MAX_SIG_UPLOAD_BYTES) {
            failed += 1;
            continue;
          }
          const fd = new FormData();
          fd.append("file", file);
          const q = new URLSearchParams({ user: userId, u: userId, skipMirror: "1" });
          const res = await fetch(`/api/upload/sig-image?${q.toString()}`, {
            method: "POST",
            credentials: "include",
            headers: { "x-user-id": userId, "x-sig-upload-skip-mirror": "1" },
            body: fd,
          });
          const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
          if (!res.ok || !j.ok || !j.url) {
            failed += 1;
            if (failed === 1) {
              setToast(
                `이미지 업로드 실패(${res.status}): ${j.error || file.name}`
              );
            }
            continue;
          }
          const meta = parseSigMetaFromFileName(file.name);
          const name = meta.name.replace(/\s*시그\s*(세로|가로|영상)?\s*$/u, "").trim() || meta.name;
          const price = meta.priceFromFileName ? meta.price : fallbackPrice;
          const nameKey = name.replace(/\s+/g, "").toLowerCase();
          const existing = nextInventory.find(
            (x) => x.id !== ONE_SHOT_SIG_ID && (x.name || "").replace(/\s+/g, "").toLowerCase() === nameKey
          );
          if (existing) {
            existing.imageUrl = j.url;
            if (price > 0 && !(Number(existing.price) > 0)) existing.price = price;
            existing.isActive = true;
            existing.isRolling = true;
            updated += 1;
          } else {
            nextInventory.push({
              id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              name,
              price,
              imageUrl: j.url,
              memberId: "",
              maxCount: 1,
              soldCount: 0,
              isRolling: true,
              isActive: true,
            });
            added += 1;
          }
        }
        const next: AppState = { ...state, sigInventory: nextInventory, updatedAt: Date.now() };
        const priced = nextInventory.filter(
          (x) => x.id !== ONE_SHOT_SIG_ID && Math.floor(Number(x.price || 0)) > 0
        ).length;
        await persistState(
          next,
          `업로드 완료: 추가 ${added} · 갱신 ${updated}${failed ? ` · 실패 ${failed}` : ""} · 가격 있는 시그 ${priced}개`,
          "이미지는 올렸지만 서버 저장이 지연됩니다. 새로고침 후 확인하세요."
        );
      } finally {
        setBusy(false);
        if (uploadInputRef.current) uploadInputRef.current.value = "";
      }
    },
    [state, defaultPrice, persistState, userId]
  );

  const members = state?.members || [];
  const statusLabel = sigSalesPanelStatusLabel(phase);
  const filterMember = members.find((m) => m.id === memberFilterId);

  return (
    <main className="min-h-screen bg-[#07070c] p-4 text-white md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex flex-wrap gap-3 text-xs">
          <Link href={`/admin?sigSales=inventory&u=${encodeURIComponent(userId)}`} className="text-yellow-300/90 underline">
            시그 판매 관리(목록·가격·업로드)
          </Link>
          <Link href="/admin/sig-sales" className="text-yellow-300/90 underline">
            회전판
          </Link>
        </div>

        {inventoryCount === 0 ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
            시그 인벤토리가 비어 있습니다. 허브에서 가져오거나 PC에서 올린 뒤, 가격이 있는 시그만 판매에 나옵니다.
          </p>
        ) : null}

        <SigSalesPanelChrome
          showGear
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((v) => !v)}
          tags={[
            `${panelGrid.rows}×${panelGrid.cols}`,
            panelOrientation === "landscape" ? "가로형" : "세로형",
            `${members.length}인 참여`,
            filterMember ? `${filterMember.name || filterMember.id} 그룹` : "전체 그룹",
            statusLabel,
          ]}
          totalAmount={soldTotal}
          settingsPanel={
            <div className="space-y-4 text-sm">
        <section className="rounded-xl border border-lime-400/25 bg-lime-950/20 p-4 space-y-3">
          <p className="text-sm font-semibold text-lime-100">시그 올리기</p>
          <p className="text-[11px] text-neutral-400">
            데스크톱 GIF를 여러 장 선택하면 판매 목록에 추가됩니다. 파일명에 금액이 없으면 아래 기본 가격을 씁니다.
          </p>
          <label className="block text-xs text-neutral-300">
            기본 가격(원)
            <input
              type="number"
              min={0}
              value={defaultPrice}
              disabled={busy}
              onChange={(e) => setDefaultPrice(e.target.value)}
              className="mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!authReady || busy}
              onClick={() => uploadInputRef.current?.click()}
              className="rounded-lg bg-lime-800 px-4 py-2 text-sm font-bold text-white hover:bg-lime-700 disabled:opacity-50"
            >
              {busy ? "처리 중…" : "PC에서 시그 올리기"}
            </button>
            <button
              type="button"
              disabled={!authReady || busy}
              onClick={() => void onImportFromHub()}
              className="rounded-lg border border-sky-400/50 bg-sky-900/50 px-4 py-2 text-sm font-semibold text-sky-100 hover:bg-sky-800/60 disabled:opacity-50"
            >
              허브에서 시그 가져오기
            </button>
          </div>
          <input
            ref={uploadInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".gif,.png,.jpg,.jpeg,.webp,image/gif,image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void onUploadFiles(e.target.files);
            }}
          />
        </section>

        <SigSalesStampAndOneShotPanel
          userId={userId}
          stampUrl={String(state?.sigSoldOutStampUrl || "")}
          oneShotImageUrl={String(
            (state?.sigInventory || []).find((x) => x.id === ONE_SHOT_SIG_ID)?.imageUrl || ""
          )}
          busy={busy}
          onStampFile={(file) => void onStampFile(file)}
          onResetStamp={() => void onResetStamp()}
          onOneShotFile={(file) => void onOneShotFile(file)}
        />

        <section className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
          <label className="block text-xs text-neutral-300">
            당첨 시그 개수 ({MIN_MANUAL_SIG_PICK_COUNT}~{MAX_MANUAL_SIG_PICK_COUNT}, 기본 5)
            <input
              type="number"
              min={MIN_MANUAL_SIG_PICK_COUNT}
              max={MAX_MANUAL_SIG_PICK_COUNT}
              value={pickCountDraft}
              disabled={busy}
              onChange={(e) => setPickCountDraft(e.target.value)}
              onBlur={() => {
                const n = Math.floor(Number(pickCountDraft));
                if (!Number.isFinite(n) || n === pickCount) {
                  setPickCountDraft(String(pickCount));
                  return;
                }
                void persistPanelLayout(1, n, panelOrientation);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-sm"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-neutral-300">
              행 ({MIN_MANUAL_SIG_GRID_ROWS}~{MAX_MANUAL_SIG_GRID_ROWS})
              <input
                type="number"
                min={MIN_MANUAL_SIG_GRID_ROWS}
                max={MAX_MANUAL_SIG_GRID_ROWS}
                value={rowsDraft}
                disabled={busy}
                onChange={(e) => setRowsDraft(e.target.value)}
                onBlur={() => {
                  const r = Math.floor(Number(rowsDraft));
                  if (!Number.isFinite(r) || r === panelGrid.rows) {
                    setRowsDraft(String(panelGrid.rows));
                    return;
                  }
                  void persistPanelLayout(r, panelGrid.cols, panelOrientation);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-sm"
              />
            </label>
            <label className="block text-xs text-neutral-300">
              열 ({MIN_MANUAL_SIG_GRID_COLS}~{MAX_MANUAL_SIG_GRID_COLS})
              <input
                type="number"
                min={MIN_MANUAL_SIG_GRID_COLS}
                max={MAX_MANUAL_SIG_GRID_COLS}
                value={colsDraft}
                disabled={busy}
                onChange={(e) => setColsDraft(e.target.value)}
                onBlur={() => {
                  const c = Math.floor(Number(colsDraft));
                  if (!Number.isFinite(c) || c === panelGrid.cols) {
                    setColsDraft(String(panelGrid.cols));
                    return;
                  }
                  void persistPanelLayout(panelGrid.rows, c, panelOrientation);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-sm"
              />
            </label>
          </div>
          <p className="text-[11px] text-neutral-400">
            판넬 {panelGrid.rows}×{panelGrid.cols} · {pickCount}칸 (최소 {MIN_MANUAL_SIG_PICK_COUNT} · 최대 {MAX_MANUAL_SIG_PICK_COUNT}). 개수·행·열은 입력 후 Enter/포커스 아웃 시 저장됩니다.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || panelOrientation === "landscape"}
              onClick={() => void persistPanelLayout(panelGrid.rows, panelGrid.cols, "landscape")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${
                panelOrientation === "landscape"
                  ? "bg-sky-700 text-white"
                  : "border border-white/15 bg-neutral-800 text-neutral-300"
              }`}
            >
              가로형 일괄
            </button>
            <button
              type="button"
              disabled={busy || panelOrientation === "portrait"}
              onClick={() => void persistPanelLayout(panelGrid.rows, panelGrid.cols, "portrait")}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-50 ${
                panelOrientation === "portrait"
                  ? "bg-sky-700 text-white"
                  : "border border-white/15 bg-neutral-800 text-neutral-300"
              }`}
            >
              세로형 일괄
            </button>
          </div>
          <p className="text-[11px] text-neutral-500">한 판넬에서 가로·세로를 섞지 않습니다. 전 칸이 같은 방향입니다.</p>
          <label className="block text-xs text-neutral-300">
            멤버 (선택)
            <select
              className="mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-sm"
              value={memberFilterId}
              onChange={(e) => setMemberFilterId(e.target.value)}
            >
              <option value="">전체 판매 중</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-neutral-400">
            등록 시그: <span className="text-neutral-200">{inventoryCount}개</span>
            {" · "}
            랜덤 풀: <span className="text-sky-200">{pool.length}개</span> (가격 있는 시그·한방·제외 필터)
            {priceExcludedCount > 0 ? (
              <span className="text-amber-300/90">
                {" "}
                · 가격 0원 {priceExcludedCount}개는 풀에서 제외(관리자에서 금액 설정)
              </span>
            ) : null}
            {canReroll ? (
              <span className="text-neutral-500">
                {" "}
                · 리롤 시 <span className="text-sky-300">{rerollPickCount}개</span> 추첨
              </span>
            ) : (
              <span className="text-amber-300/90"> · 리롤하려면 {MANUAL_REROLL_MIN_POOL}개 이상 필요</span>
            )}
          </p>
        </section>

        <section className="rounded-xl border border-amber-400/35 bg-amber-950/25 p-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-amber-100">칸별 나올 시그 금액대</p>
            <p className="mt-1 text-[11px] text-neutral-400">
              ROLL 시 각 칸에 뽑힐 시그의 가격 범위입니다. 최소·최대 모두 0(비움)이면 제한 없음. Enter/포커스 아웃 시 저장.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: pickCount }, (_, i) => {
              const band = slotPriceBands[i] || { min: 0, max: 0 };
              const draftBand = bandDraftByIdx[i];
              const minVal = draftBand?.min != null ? draftBand.min : band.min > 0 ? String(band.min) : "";
              const maxVal = draftBand?.max != null ? draftBand.max : band.max > 0 ? String(band.max) : "";
              const commitBand = () => {
                const nextBands = slotPriceBands.map((b, idx) => {
                  if (idx !== i) return b;
                  const d = bandDraftByIdx[i];
                  const minRaw = d?.min != null ? d.min : minVal;
                  const maxRaw = d?.max != null ? d.max : maxVal;
                  return {
                    min: Math.max(0, Math.floor(Number(String(minRaw).replace(/[^\d]/g, "")) || 0)),
                    max: Math.max(0, Math.floor(Number(String(maxRaw).replace(/[^\d]/g, "")) || 0)),
                  };
                });
                void persistSlotPriceBands(nextBands).then(() => {
                  setBandDraftByIdx((prev) => {
                    const n = { ...prev };
                    delete n[i];
                    return n;
                  });
                });
              };
              return (
                <div
                  key={`slot-band-${i}`}
                  className="rounded-lg border border-amber-400/20 bg-black/30 px-2.5 py-2 text-xs text-neutral-300"
                >
                  <p className="mb-1.5 font-semibold text-amber-50/95">{i + 1}칸 금액대</p>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={busy}
                      value={minVal}
                      placeholder="최소"
                      onChange={(e) =>
                        setBandDraftByIdx((prev) => ({
                          ...prev,
                          [i]: { min: e.target.value, max: prev[i]?.max ?? maxVal },
                        }))
                      }
                      onBlur={commitBand}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="w-full rounded border border-amber-400/30 bg-neutral-900 px-2 py-1.5 text-sm tabular-nums text-amber-100"
                    />
                    <span className="text-neutral-500">~</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      disabled={busy}
                      value={maxVal}
                      placeholder="최대"
                      onChange={(e) =>
                        setBandDraftByIdx((prev) => ({
                          ...prev,
                          [i]: { min: prev[i]?.min ?? minVal, max: e.target.value },
                        }))
                      }
                      onBlur={commitBand}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      className="w-full rounded border border-amber-400/30 bg-neutral-900 px-2 py-1.5 text-sm tabular-nums text-amber-100"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <p className="text-sm font-semibold text-amber-100">칸별 판매가(당첨 후)</p>
            <p className="mt-1 text-[11px] text-neutral-400">
              ROLL 후 당첨 시그의 판매가를 수정합니다. OBS·합산에도 반영됩니다.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {Array.from({ length: pickCount }, (_, i) => {
              const row = saleRows.find((r) => r.draftIdx === i);
              const draftRow = draft?.drafts?.[i];
              const draftPrice = String(draftRow?.priceInput || "").replace(/[^\d]/g, "");
              const shown =
                priceDraftByIdx[i] != null
                  ? priceDraftByIdx[i]!
                  : draftPrice || (row ? String(row.price || "") : "");
              return (
                <label
                  key={`slot-price-${i}`}
                  className="flex flex-col gap-1 rounded-lg border border-amber-400/20 bg-black/30 px-2.5 py-2 text-xs text-neutral-300"
                >
                  <span className="font-semibold text-amber-50/95">
                    {i + 1}칸
                    {row?.name ? (
                      <span className="ml-1 font-normal text-neutral-400">· {row.name}</span>
                    ) : (
                      <span className="ml-1 font-normal text-neutral-500">· (ROLL 전)</span>
                    )}
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={busy || phase === "CONFIRMED" || !row}
                    value={shown}
                    placeholder={row ? "예: 10000" : "ROLL 후 수정"}
                    onChange={(e) =>
                      setPriceDraftByIdx((prev) => ({ ...prev, [i]: e.target.value }))
                    }
                    onBlur={() => {
                      if (!row) return;
                      const raw = priceDraftByIdx[i] != null ? priceDraftByIdx[i]! : shown;
                      void onCommitCellPrice(i, raw).then(() => {
                        setPriceDraftByIdx((prev) => {
                          const next = { ...prev };
                          delete next[i];
                          return next;
                        });
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="rounded border border-yellow-400/35 bg-neutral-900 px-2 py-1.5 text-sm font-bold tabular-nums text-yellow-200 disabled:opacity-40"
                  />
                </label>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-sky-400/30 bg-sky-950/30 p-4">
          <p className="text-xs font-semibold text-sky-100">지금 OBS 당첨</p>
          {currentNames ? (
            <>
              <p className="mt-2 text-sm text-white">
                {currentNames}
                <span className="ml-2 text-xs text-sky-300/90">
                  ({displaySigs.length}/{pickCount}개)
                </span>
              </p>
              {oneShotLabel ? <p className="mt-1 text-sm text-yellow-200">+ {oneShotLabel}</p> : null}
              {needsRerollForPickCount ? (
                <p className="mt-2 text-xs font-semibold text-amber-200/95">
                  당첨 개수가 {pickCount}개입니다. 「ROLL」을 눌러 {pickCount}개를 새로 뽑아 주세요.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">아직 없음 — ROLL을 누르세요.</p>
          )}
          {oneShotLabel ? (
            <label className="mt-3 flex items-center gap-2 text-sm text-yellow-100">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={oneShotMarkSold}
                disabled={busy || phase === "CONFIRMED"}
                onChange={(e) => void onToggleOneShotSold(e.target.checked)}
              />
              한방 시그 판매완료 ({oneShotLabel})
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!overlayUrl}
              className="rounded-lg border border-sky-400/50 bg-sky-900/50 px-3 py-2 text-xs font-semibold text-sky-100"
              onClick={() => {
                void copyTextToClipboard(overlayUrl).then((ok) =>
                  setToast(ok ? "OBS URL 복사됨" : "복사 실패")
                );
              }}
            >
              OBS URL 복사
            </button>
            <button
              type="button"
              disabled={!overlayUrl}
              className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-bold"
              onClick={() => window.open(overlayUrl, "_blank", "noopener,noreferrer")}
            >
              OBS 미리보기
            </button>
          </div>
          {overlayUrl ? (
            <code className="mt-2 block break-all text-[10px] text-neutral-500">{overlayUrl}</code>
          ) : null}
        </section>
            </div>
          }
          controlBar={
            <>
              <button
                type="button"
                disabled={!authReady || !state || busy || !canReroll}
                onClick={() => void onReroll()}
                className="rounded-lg bg-yellow-400 px-5 py-2.5 text-sm font-black tracking-wide text-black shadow-[0_0_18px_rgba(250,204,21,0.45)] hover:bg-yellow-300 disabled:opacity-40"
              >
                {busy ? "처리 중…" : canReroll ? `ROLL  리롤 (${rerollPickCount})` : "ROLL 불가"}
              </button>
              <div
                className={`rounded-full border px-3 py-1 text-xs font-bold ${
                  statusLabel === "진행 중"
                    ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
                    : statusLabel === "판매 확정"
                      ? "border-emerald-300/50 bg-emerald-400/15 text-emerald-100"
                      : "border-white/20 bg-white/5 text-neutral-300"
                }`}
              >
                STATUS: {statusLabel}
              </div>
              <button
                type="button"
                disabled={!authReady || busy || phase === "CONFIRMED" || !hasAnySoldMark}
                onClick={() => void onConfirmSales()}
                className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-black tracking-wide text-white shadow-[0_8px_20px_rgba(5,150,105,0.35)] hover:bg-emerald-500 disabled:opacity-40"
              >
                {busy ? "처리 중…" : "COMPLETE SALES"}
              </button>
            </>
          }
        >
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${panelGrid.cols}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: pickCount }, (_, i) => {
              const row = saleRows.find((r) => r.draftIdx === i);
              const sold = Boolean(soldFlags[i]);
              return (
                <div
                  key={`cell_${i}`}
                  className={`relative min-h-[8.5rem] overflow-hidden rounded-lg border text-left ${
                    sold
                      ? "border-rose-500/50 bg-[#0c0c10]"
                      : "border-white/12 bg-[#121218]"
                  }`}
                  title={row ? undefined : "빈 칸 — ROLL로 채워 주세요"}
                >
                  <button
                    type="button"
                    disabled={busy || !row || phase === "CONFIRMED"}
                    onClick={() => {
                      if (!row) return;
                      void onToggleSigSold(i, !sold);
                    }}
                    className="relative block h-[4.75rem] w-full bg-black/40 disabled:opacity-60"
                    title={row ? "클릭하면 판매완료 전환" : undefined}
                  >
                    {row?.imageUrl ? (
                      <SigSaleMedia
                        src={resolveSigOverlayCardImageUrl(
                          row.name,
                          row.imageUrl || toonaDefaultImageUrl,
                          userId
                        )}
                        storedImageUrl={row.imageUrl || toonaDefaultImageUrl}
                        sigImageUserId={userId}
                        defaultImageUrl={toonaDefaultImageUrl || undefined}
                        alt={row.name}
                        fill
                        objectFit="contain"
                        className="object-contain"
                        sizes="160px"
                      />
                    ) : null}
                  </button>
                  <div className="px-2 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">SIG</div>
                    <div className="line-clamp-2 text-sm font-bold text-white">{row?.name || "빈 칸"}</div>
                    {row ? (
                      <label className="mt-1 block">
                        <span className="sr-only">칸 가격(원)</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          disabled={busy || phase === "CONFIRMED"}
                          value={
                            priceDraftByIdx[i] != null
                              ? priceDraftByIdx[i]
                              : String(row.price || "")
                          }
                          onChange={(e) =>
                            setPriceDraftByIdx((prev) => ({ ...prev, [i]: e.target.value }))
                          }
                          onBlur={() => {
                            const raw =
                              priceDraftByIdx[i] != null ? priceDraftByIdx[i]! : String(row.price || "");
                            void onCommitCellPrice(i, raw).then(() => {
                              setPriceDraftByIdx((prev) => {
                                const next = { ...prev };
                                delete next[i];
                                return next;
                              });
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                          className="w-full rounded border border-yellow-400/30 bg-black/40 px-1.5 py-0.5 text-sm font-black tabular-nums text-yellow-300"
                          title="칸별 판매가 (원)"
                        />
                      </label>
                    ) : null}
                  </div>
                  {sold ? (
                    <button
                      type="button"
                      disabled={busy || phase === "CONFIRMED"}
                      onClick={() => void onToggleSigSold(i, false)}
                      className="absolute inset-0 flex items-center justify-center bg-black/70"
                      title="클릭하면 판매완료 해제"
                    >
                      <span
                        className="rotate-[-12deg] border-[3px] border-rose-500 px-2 py-0.5 text-sm font-black tracking-wider text-rose-400"
                        style={{ textShadow: "0 0 12px rgba(244,63,94,0.8)" }}
                      >
                        SOLD OUT
                      </span>
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </SigSalesPanelChrome>

        {toast ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
            {toast}
          </p>
        ) : null}
      </div>
    </main>
  );
}
