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
import { DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE } from "@/lib/constants";
import SigSalesStampAndOneShotPanel from "@/components/admin/SigSalesStampAndOneShotPanel";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";
import {
  buildManualSigBroadcastState,
  buildManualSigSalesConfirmState,
  buildManualSigSoldPersistState,
  MANUAL_REROLL_MIN_POOL,
  pickRandomManualSigBundle,
  readManualSigDraftFromState,
  readManualSigPickCount,
  resolveManualOneShotDisplayFromState,
  resolveManualOverlaySelectedSigs,
} from "@/lib/manual-sig-broadcast";
import { parseSigMetaFromFileName } from "@/lib/sig-filename-meta";
import { ONE_SHOT_SIG_ID } from "@/lib/sig-roulette";
import type { SigItem } from "@/types";
import {
  MANUAL_SIG_DRAFT_STATE_KEY,
  clampManualSigPickCount,
  DEFAULT_MANUAL_SIG_PICK_COUNT,
  emptyManualSoldFlags,
  MANUAL_SIG_PICK_COUNT_KEY,
  MAX_MANUAL_SIG_PICK_COUNT,
  MIN_MANUAL_SIG_PICK_COUNT,
  normalizeManualSigDraftPersist,
  parseManualSigDraftRows,
  resizeManualDrafts,
  resizeManualSoldFlags,
} from "@/lib/manual-sig-workbench";

const SIG_INVENTORY_IMPORTED_EVENT = "youtube-sig-inventory-imported";
const MAX_SIG_UPLOAD_BYTES = 30 * 1024 * 1024;

export default function ManualSigSalesSimple() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [state, setState] = useState<AppState | null>(null);
  const [memberFilterId, setMemberFilterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [defaultPrice, setDefaultPrice] = useState("10000");
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const userId = user?.id || "finalent";

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
    if (!authReady) return;
    void loadRemote();
  }, [authReady, loadRemote]);

  useEffect(() => {
    if (!authReady) return;
    const onFocus = () => void loadRemote();
    const onImported = () => void loadRemote();
    window.addEventListener("focus", onFocus);
    window.addEventListener(SIG_INVENTORY_IMPORTED_EVENT, onImported);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(SIG_INVENTORY_IMPORTED_EVENT, onImported);
    };
  }, [authReady, loadRemote]);

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
      }),
    [state?.sigInventory, state?.sigSalesExcludedIds, memberFilterId]
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
  const pickCount = useMemo(() => readManualSigPickCount(state), [state]);
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

  const saleRows = useMemo(() => {
    const parsed = parseManualSigDraftRows(draft?.drafts || []);
    const rows: Array<{ draftIdx: number; name: string; price: number }> = [];
    for (let i = 0; i < pickCount; i++) {
      const row = parsed[i];
      if (row?.name && row.price > 0) {
        rows.push({ draftIdx: i, name: row.name, price: row.price });
        continue;
      }
      const sig = displaySigs[i];
      if (sig?.name) {
        rows.push({
          draftIdx: i,
          name: sig.name,
          price: Number(sig.price || 0),
        });
      }
    }
    return rows;
  }, [draft?.drafts, displaySigs, pickCount]);
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
          setState({ ...remote, sigInventory: inventory });
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
      });
      if (!bundle) {
        setToast("리롤 실패 — 판매 가능 시그를 확인하세요.");
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
  }, [state, canReroll, pool.length, userId, memberFilterId, persistState, pickCount]);

  const onPickCountChange = useCallback(
    async (raw: number) => {
      if (!state) return;
      const n = clampManualSigPickCount(raw);
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
      const next: AppState = {
        ...state,
        updatedAt: Date.now(),
        overlaySettings: {
          ...prevOs,
          [MANUAL_SIG_PICK_COUNT_KEY]: n,
          ...(nextDraft ? { [MANUAL_SIG_DRAFT_STATE_KEY]: nextDraft } : {}),
        } as AppState["overlaySettings"],
      };
      await persistState(
        next,
        `당첨 시그 개수 ${n}개로 변경 · 「리롤」하면 OBS에 ${n}개 반영`,
        "개수 설정 저장이 지연됩니다."
      );
    },
    [state, persistState]
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

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <h1 className="text-2xl font-black text-sky-200">수동 시그 판매</h1>
          <p className="mt-1 text-sm text-neutral-400">
            판매 중 시그 랜덤(최대 {MAX_MANUAL_SIG_PICK_COUNT}개·한방 제외) → OBS 반영 · 체크 후 판매 확정
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            <Link href={`/admin?sigSales=inventory&u=${encodeURIComponent(userId)}`} className="text-yellow-300/90 underline">
              시그 판매 관리(목록·가격·업로드)
            </Link>
            <Link href="/admin/sig-sales" className="text-yellow-300/90 underline">
              회전판
            </Link>
          </div>
        </header>

        {inventoryCount === 0 ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
            시그 인벤토리가 비어 있습니다. 허브에서 가져오거나 PC에서 올린 뒤, 가격이 있는 시그만 판매에 나옵니다.
          </p>
        ) : null}

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
            당첨 시그 개수 ({MIN_MANUAL_SIG_PICK_COUNT}~{MAX_MANUAL_SIG_PICK_COUNT}, 기본 {DEFAULT_MANUAL_SIG_PICK_COUNT})
            <input
              type="number"
              min={MIN_MANUAL_SIG_PICK_COUNT}
              max={MAX_MANUAL_SIG_PICK_COUNT}
              value={pickCount}
              disabled={busy}
              onChange={(e) => void onPickCountChange(Number(e.target.value))}
              className="mt-1 w-full rounded bg-neutral-800 px-2 py-2 text-sm"
            />
          </label>
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
                  당첨 개수가 {pickCount}개입니다. 「리롤 → OBS」를 눌러 {pickCount}개를 새로 뽑아 주세요.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-2 text-sm text-neutral-500">아직 없음 — 리롤을 누르세요.</p>
          )}
        </section>

        {saleRows.length > 0 ? (
          <section className="rounded-xl border border-emerald-400/25 bg-emerald-950/20 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-emerald-100">판매 처리</p>
              {phase === "CONFIRMED" ? (
                <span className="rounded bg-emerald-800/80 px-2 py-0.5 text-[10px] font-bold text-emerald-100">
                  전체 확정됨
                </span>
              ) : soldFlags.some(Boolean) ? (
                <span className="text-[10px] text-emerald-300/90">일부 확정됨 · 나머지 개별 확정 가능</span>
              ) : (
                <span className="text-[10px] text-neutral-500">체크 → OBS 스탬프 · 확정 시 회차 종료</span>
              )}
            </div>
            {saleRows.map((row) => {
              const rowConfirmed = Boolean(soldFlags[row.draftIdx]);
              return (
              <div
                key={`sale_${row.draftIdx}_${row.name}`}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5"
              >
                <label className="flex min-w-0 flex-1 items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={rowConfirmed}
                    disabled={busy || rowConfirmed || phase === "CONFIRMED"}
                    onChange={(e) => void onToggleSigSold(row.draftIdx, e.target.checked)}
                  />
                  <span className="min-w-0 text-neutral-100">
                    <span className="font-bold">{row.name}</span>{" "}
                    <span className="font-semibold tabular-nums text-yellow-200">
                      {row.price.toLocaleString("ko-KR")}원
                    </span>
                    {rowConfirmed ? (
                      <span className="ml-2 text-xs font-semibold text-emerald-300">확정됨</span>
                    ) : null}
                  </span>
                </label>
                <button
                  type="button"
                  disabled={busy || rowConfirmed || phase === "CONFIRMED"}
                  onClick={() => void onConfirmSales({ onlyDraftIdx: row.draftIdx })}
                  className="shrink-0 rounded-md bg-emerald-800 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {rowConfirmed ? "확정 완료" : "이 시그만 확정"}
                </button>
              </div>
            );
            })}
            {oneShotLabel ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-yellow-400/30 bg-yellow-950/20 px-3 py-2.5">
                <label className="flex min-w-0 flex-1 items-center gap-3 text-base">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0"
                    checked={oneShotMarkSold}
                    disabled={busy || phase === "CONFIRMED"}
                    onChange={(e) => void onToggleOneShotSold(e.target.checked)}
                  />
                  <span className="font-semibold text-yellow-100">
                    한방 시그 판매완료 ({oneShotLabel})
                  </span>
                </label>
              </div>
            ) : null}
            <button
              type="button"
              disabled={!authReady || busy || phase === "CONFIRMED" || !hasAnySoldMark}
              onClick={() => void onConfirmSales()}
              className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-base font-bold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? "처리 중…" : "체크한 시그 일괄 확정"}
            </button>
          </section>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!authReady || !state || busy || !canReroll}
            onClick={() => void onReroll()}
            className="rounded-lg bg-fuchsia-700 px-5 py-3 text-sm font-bold hover:bg-fuchsia-600 disabled:opacity-50"
          >
            {busy ? "처리 중…" : canReroll ? `리롤 → OBS (${rerollPickCount}개)` : "리롤 불가"}
          </button>
          <button
            type="button"
            disabled={!overlayUrl}
            className="rounded-lg border border-sky-400/50 bg-sky-900/50 px-3 py-3 text-xs font-semibold text-sky-100 hover:bg-sky-800/60"
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
            className="rounded-lg bg-sky-700 px-3 py-3 text-xs font-bold hover:bg-sky-600"
            onClick={() => window.open(overlayUrl, "_blank", "noopener,noreferrer")}
          >
            OBS 미리보기
          </button>
        </div>

        {overlayUrl ? (
          <code className="block break-all rounded border border-white/10 bg-black/50 p-2 text-[10px] text-neutral-400">
            {overlayUrl}
          </code>
        ) : null}

        {toast ? (
          <p className="rounded-lg border border-amber-400/40 bg-amber-950/50 px-3 py-2 text-sm text-amber-100">
            {toast}
          </p>
        ) : null}
      </div>
    </main>
  );
}
