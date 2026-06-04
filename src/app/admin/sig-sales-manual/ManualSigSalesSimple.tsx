"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AppState } from "@/lib/state";
import { loadStateFromApi, saveStateAsync } from "@/lib/state";
import { STATE_PICK_SIG_SALES } from "@/lib/state-api-pick";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import { buildSigSalesManualOverlayUrl } from "@/lib/sig-sales-overlay-urls";
import { listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import {
  buildManualSigBroadcastState,
  pickRandomManualSigBundle,
} from "@/lib/manual-sig-broadcast";
import { normalizeManualSigDraftPersist } from "@/lib/manual-sig-workbench";

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
    const remote = await loadStateFromApi(userId, { pick: STATE_PICK_SIG_SALES, forceFull: true });
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
      sigResultScalePct: 78,
    });
  }, [userId, memberFilterId]);

  const current = state?.rouletteState;
  const currentNames = (current?.selectedSigs || []).map((s) => s.name).join(", ");
  const oneShotLabel = current?.oneShotResult
    ? `${current.oneShotResult.name} ${Number(current.oneShotResult.price || 0).toLocaleString("ko-KR")}원`
    : null;

  const onReroll = useCallback(async () => {
    if (!state) return;
    if (pool.length < 5) {
      setToast(`판매 중 시그가 ${pool.length}개뿐입니다. (5개 필요, 한방 시그 제외)`);
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
        oneShotImageUrl: "",
        sigSoldFlags: [false, false, false, false, false],
        oneShotMarkSold: false,
      });
      const next = buildManualSigBroadcastState(
        state,
        bundle.selected,
        bundle.oneShot,
        persistDrafts ? { persistDrafts } : undefined
      );
      setState(next);
      const saved = await saveStateAsync(next, userId);
      setToast(
        saved.ok
          ? `리롤 · OBS 반영: ${bundle.selected.map((s) => s.name).join(", ")}`
          : "리롤은 적용됐지만 서버 저장이 지연됩니다. OBS 새로고침 후 확인하세요."
      );
    } catch (e) {
      setToast(`리롤 실패: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [state, pool.length, userId, memberFilterId]);

  const members = state?.members || [];

  return (
    <main className="min-h-screen bg-neutral-950 p-6 text-white">
      <div className="mx-auto max-w-lg space-y-5">
        <header>
          <h1 className="text-2xl font-black text-sky-200">수동 시그 판매</h1>
          <p className="mt-1 text-sm text-neutral-400">
            판매 중 시그 5개 랜덤(한방 제외) → OBS만 반영 · 회전판·재고·회차 저장 없음
          </p>
          <Link href="/admin/sig-sales" className="mt-2 inline-block text-xs text-yellow-300/90 underline">
            회전판 추첨은 여기
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

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!authReady || busy || pool.length < 5}
            onClick={() => void onReroll()}
            className="rounded-lg bg-fuchsia-700 px-5 py-3 text-sm font-bold hover:bg-fuchsia-600 disabled:opacity-50"
          >
            {busy ? "리롤 중…" : "리롤 → OBS"}
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
