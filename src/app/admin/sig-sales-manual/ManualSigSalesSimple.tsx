"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AppState } from "@/lib/state";
import { loadStateFromApi, saveSigSalesManualStateAsync } from "@/lib/state";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { buildSigSalesManualOverlayUrl } from "@/lib/sig-sales-overlay-urls";
import { DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE } from "@/lib/constants";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import {
  buildManualSigBroadcastState,
  buildManualSigSalesConfirmState,
  buildManualSigSoldPersistState,
  MANUAL_REROLL_MIN_POOL,
  MANUAL_REROLL_MAX_PICK,
  pickRandomManualSigBundle,
  readManualSigDraftFromState,
  resolveManualOneShotDisplayFromState,
  resolveManualOverlaySelectedSigs,
} from "@/lib/manual-sig-broadcast";
import {
  normalizeManualSigDraftPersist,
  parseManualSigDraftRows,
} from "@/lib/manual-sig-workbench";

const EMPTY_SOLD_FLAGS = [false, false, false, false, false] as const;

export default function ManualSigSalesSimple() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [state, setState] = useState<AppState | null>(null);
  const [memberFilterId, setMemberFilterId] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
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
    if (remote) setState(remote);
  }, [userId]);

  useEffect(() => {
    if (!authReady) return;
    void loadRemote();
  }, [authReady, loadRemote]);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(id);
  }, [toast]);

  const pool = useMemo(
    () =>
      listActiveManualSigPool(state?.sigInventory, {
        memberFilterId: memberFilterId || undefined,
        sigSalesExcludedIds: state?.sigSalesExcludedIds,
      }),
    [state?.sigInventory, state?.sigSalesExcludedIds, memberFilterId]
  );

  const overlayUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildSigSalesManualOverlayUrl(window.location.origin, userId, {
      memberId: memberFilterId || undefined,
      sigResultScalePct: 92,
    });
  }, [userId, memberFilterId]);

  const current = state?.rouletteState;
  const draft = useMemo(() => readManualSigDraftFromState(state), [state]);
  const displaySigs = useMemo(
    () => resolveManualOverlaySelectedSigs(state, userId),
    [state, userId]
  );
  const soldFlags = useMemo(() => {
    const raw = draft?.sigSoldFlags;
    if (!Array.isArray(raw)) return [...EMPTY_SOLD_FLAGS];
    return Array.from({ length: 5 }, (_, i) => Boolean(raw[i]));
  }, [draft?.sigSoldFlags]);
  const oneShotMarkSold = Boolean(draft?.oneShotMarkSold);

  const saleRows = useMemo(() => {
    const parsed = parseManualSigDraftRows(draft?.drafts || []);
    const rows: Array<{ draftIdx: number; name: string; price: number }> = [];
    for (let i = 0; i < 5; i++) {
      const row = parsed[i];
      if (row?.name && row.price > 0) {
        rows.push({ draftIdx: i, name: row.name, price: row.price });
      }
    }
    if (rows.length > 0) return rows;
    return displaySigs.map((sig, idx) => ({
      draftIdx: idx,
      name: sig.name,
      price: Number(sig.price || 0),
    }));
  }, [draft?.drafts, displaySigs]);

  const currentNames = displaySigs.map((s) => s.name).join(", ");
  const oneShotLabel = useMemo(() => {
    const resolved = resolveManualOneShotDisplayFromState(state, displaySigs, userId);
    if (resolved) {
      return `${resolved.name} ${resolved.price.toLocaleString("ko-KR")}원`;
    }
    const os = current?.oneShotResult;
    if (!os) return null;
    return `${os.name} ${Number(os.price || 0).toLocaleString("ko-KR")}원`;
  }, [state, displaySigs, userId, current?.oneShotResult]);
  const rerollPickCount = Math.min(MANUAL_REROLL_MAX_PICK, pool.length);
  const canReroll = pool.length >= MANUAL_REROLL_MIN_POOL;
  const hasAnySoldMark =
    soldFlags.some(Boolean) || oneShotMarkSold;
  const phase = String(current?.phase || "");

  const persistState = useCallback(
    async (next: AppState, okMsg: string, failMsg: string) => {
      setState(next);
      const saved = await saveSigSalesManualStateAsync(next, userId);
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
      const persistDrafts = normalizeManualSigDraftPersist({
        inputMode: "inventory",
        drafts,
        oneShotName: bundle.oneShot.name,
        oneShotPriceInput: String(bundle.oneShot.price),
        oneShotImageUrl: DEFAULT_ONE_SHOT_SIG_BUNDLED_IMAGE,
        sigSoldFlags: [false, false, false, false, false],
        oneShotMarkSold: false,
      });
      const next = buildManualSigBroadcastState(
        state,
        bundle.selected,
        bundle.oneShot,
        persistDrafts ? { persistDrafts } : undefined
      );
      await persistState(
        next,
        `리롤 · OBS 반영: ${bundle.selected.map((s) => s.name).join(", ")}`,
        "리롤은 적용됐지만 서버 저장이 지연됩니다. OBS 새로고침 후 확인하세요."
      );
    } catch (e) {
      setToast(`리롤 실패: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [state, canReroll, pool.length, userId, memberFilterId, persistState]);

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
        onlyIdx != null && onlyIdx >= 0 && onlyIdx < 5
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
            ? `${row.name} 판매 확정 · 재고 반영`
            : closeRound
              ? "판매 확정 완료 · 재고 반영 · OBS 반영"
              : "선택 시그 판매 확정 · 나머지 계속 가능",
          "판매 확정은 적용됐지만 서버 저장이 지연됩니다. OBS 새로고침 후 확인하세요."
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
      if (!state || idx < 0 || idx >= 5) return;
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
    [state, soldFlags, oneShotMarkSold, saleRows, persistState]
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

  const members = state?.members || [];

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-2xl space-y-5">
        <header>
          <h1 className="text-2xl font-black text-sky-200">수동 시그 판매</h1>
          <p className="mt-1 text-sm text-neutral-400">
            판매 중 시그 랜덤(최대 5개·한방 제외) → OBS 반영 · 체크 후 판매 확정 시 재고 반영
          </p>
          <Link href="/admin/sig-sales" className="mt-2 inline-block text-xs text-yellow-300/90 underline">
            회전판·상세 수동 입력은 여기
          </Link>
        </header>

        <section className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
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
            랜덤 풀: <span className="text-sky-200">{pool.length}개</span> (활성·재고 있음·한방 제외)
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
              <p className="mt-2 text-sm text-white">{currentNames}</p>
              {oneShotLabel ? <p className="mt-1 text-sm text-yellow-200">+ {oneShotLabel}</p> : null}
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
                <span className="text-[10px] text-neutral-500">체크 → OBS 스탬프 · 확정 시 재고 차감</span>
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
              {busy ? "처리 중…" : "체크한 시그 일괄 확정 (재고 반영)"}
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
