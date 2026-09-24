"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import AdminPopupShell from "@/components/admin/popup/AdminPopupShell";
import DonorBulkToolbar from "@/components/admin/DonorBulkToolbar";
import DonorCheckboxCell from "@/components/admin/DonorCheckboxCell";
import { useAdminPopupBroadcastState } from "@/hooks/useAdminPopupBroadcastState";
import { showAppToast } from "@/lib/app-toast";
import { notifyBroadcastStateLocalUpdated } from "@/lib/broadcast-state-local-sync";
import {
  isDonorExcludedFromDonationTotals,
  reassignDonorMemberInAppState,
  revertDonationFromAppState,
  syncMemberTotalsFromDonors,
  updateDonorMessageInAppState,
  updateDonorNameInAppState,
} from "@/lib/donation/apply-donation-state";
import { persistDonationStateViaApi } from "@/lib/donation/persist-donation-client";
import { repairDonorTimestamps } from "@/lib/donation/repair-donor-timestamps";
import {
  isGroupSplitPartDonor,
  isGroupSplitSourceDonor,
  previewGroupSplitDonation,
  splitExistingDonorInAppState,
} from "@/lib/donation/group-split-donation";
import { writeSessionBroadcastState } from "@/lib/server-authoritative-broadcast-state";
import { normalizeDonorsArray, resolveEffectiveDonorTarget } from "@/lib/state";
import type { AppState, Donor } from "@/types";

const DONOR_PAGE_SIZES = [20, 50, 100, 300] as const;
type DonorPageSize = (typeof DONOR_PAGE_SIZES)[number];
type TimeFilterKey = "all" | "today" | "1h" | "30m" | "10m" | "5m";

function formatWon(n: number): string {
  return `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
}

function formatTime(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  return new Date(ts).toLocaleTimeString("ko-KR");
}

export default function AdminDonorListPopupPanel() {
  const {
    user,
    scopedUserId,
    urlUserId,
    authReady,
    state,
    setState,
    stateRef,
    accountMismatch,
    runExclusivePersist,
  } = useAdminPopupBroadcastState();

  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilterKey>("all");
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<DonorPageSize>(50);
  const [dense, setDense] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [draftMessages, setDraftMessages] = useState<Record<string, string>>({});
  const persistChainRef = useRef(Promise.resolve(true));

  const persistReplace = useCallback(
    async (next: AppState): Promise<boolean> => {
      const stamped = syncMemberTotalsFromDonors({
        ...next,
        updatedAt: Date.now(),
        donorRankingsUpdatedAt: Date.now(),
      });
      setState(stamped);
      stateRef.current = stamped;
      writeSessionBroadcastState(stamped, scopedUserId);
      notifyBroadcastStateLocalUpdated(scopedUserId, stamped.updatedAt);
      const run = async (): Promise<boolean> => {
        const result = await runExclusivePersist(() =>
          persistDonationStateViaApi(scopedUserId, stamped, "replace", { returnState: false })
        );
        if (!result.ok) {
          showAppToast("후원 저장 실패", { variant: "error" });
          return false;
        }
        return true;
      };
      const queued = persistChainRef.current.then(run, run);
      persistChainRef.current = queued.then(
        () => true,
        () => true
      );
      return queued;
    },
    [runExclusivePersist, scopedUserId, setState, stateRef]
  );

  const rowsSorted = useMemo(() => {
    const rows = repairDonorTimestamps(normalizeDonorsArray(state?.donors));
    return rows.slice().sort((a, b) => Number(b.at || 0) - Number(a.at || 0));
  }, [state?.donors]);

  const rowsFiltered = useMemo(() => {
    let out = rowsSorted;
    if (timeFilter !== "all") {
      const now = Date.now();
      let fromTs = 0;
      if (timeFilter === "today") {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        fromTs = d.getTime();
      } else if (timeFilter === "1h") fromTs = now - 60 * 60 * 1000;
      else if (timeFilter === "30m") fromTs = now - 30 * 60 * 1000;
      else if (timeFilter === "10m") fromTs = now - 10 * 60 * 1000;
      else if (timeFilter === "5m") fromTs = now - 5 * 60 * 1000;
      out = out.filter((d) => Number(d.at || 0) >= fromTs);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      const members = state?.members || [];
      out = out.filter((d) => {
        const name = String(d.name || "").toLowerCase();
        const msg = String(d.message || "").toLowerCase();
        const memName = members.find((m) => m.id === d.memberId)?.name || "";
        return name.includes(q) || msg.includes(q) || memName.toLowerCase().includes(q);
      });
    }
    return out;
  }, [rowsSorted, timeFilter, query, state?.members]);

  const totalPages = Math.max(1, Math.ceil(rowsFiltered.length / pageSize));
  const pageIdx = Math.min(page, totalPages);
  const pageStart = (pageIdx - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const rowsVisible = showAll ? rowsFiltered : rowsFiltered.slice(pageStart, pageEnd);

  const filteredAgg = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const d of rowsFiltered) {
      if (isDonorExcludedFromDonationTotals(d)) continue;
      sum += Number(d.amount || 0);
      count += 1;
    }
    return { sum, count };
  }, [rowsFiltered]);

  const pageAgg = useMemo(() => {
    let sum = 0;
    let count = 0;
    for (const d of rowsVisible) {
      if (isDonorExcludedFromDonationTotals(d)) continue;
      sum += Number(d.amount || 0);
      count += 1;
    }
    return { sum, count };
  }, [rowsVisible]);

  const toggleSelect = useCallback((donorId?: string, isAll?: boolean) => {
    if (isAll) {
      setSelectedIds((prev) => {
        const ids = rowsVisible.map((d) => String(d.id)).filter(Boolean);
        const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
        const next = new Set(prev);
        if (allOn) ids.forEach((id) => next.delete(id));
        else ids.forEach((id) => next.add(id));
        return next;
      });
      return;
    }
    if (!donorId) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(donorId)) next.delete(donorId);
      else next.add(donorId);
      return next;
    });
  }, [rowsVisible]);

  const bulkDelete = useCallback(async () => {
    const live = stateRef.current;
    if (!live) return;
    let next: AppState = live;
    for (const id of selectedIds) {
      const row = (next.donors || []).find((d) => String(d.id) === id);
      if (!row || isGroupSplitSourceDonor(next, row)) continue;
      const updated = revertDonationFromAppState(next, row.id, { hardDeleteRow: true });
      if (updated) next = updated;
    }
    setSelectedIds(new Set());
    await persistReplace(next);
  }, [persistReplace, selectedIds, stateRef]);

  const saveName = async (d: Donor, nextName: string) => {
    const live = stateRef.current;
    if (!live) return;
    const next = updateDonorNameInAppState(live, d.id, nextName);
    if (!next) return;
    await persistReplace(next);
  };

  const saveMessage = async (d: Donor, nextMessage: string) => {
    const live = stateRef.current;
    if (!live) return;
    const next = updateDonorMessageInAppState(live, d.id, nextMessage);
    if (!next) return;
    await persistReplace(next);
  };

  const saveMember = async (d: Donor, memberId: string) => {
    const live = stateRef.current;
    if (!live) return;
    const next = reassignDonorMemberInAppState(live, d.id, memberId);
    if (!next) return;
    await persistReplace(next);
  };

  const deleteRow = async (d: Donor) => {
    const live = stateRef.current;
    if (!live) return;
    if (isGroupSplitSourceDonor(live, d)) return;
    if (!window.confirm(`${d.name || "후원"} ${formatWon(d.amount)}을 삭제할까요?`)) return;
    const next = revertDonationFromAppState(live, d.id, { hardDeleteRow: true });
    if (!next) return;
    await persistReplace(next);
  };

  const splitRow = async (d: Donor) => {
    const live = stateRef.current;
    if (!live) return;
    const applied = splitExistingDonorInAppState(live, d.id, live.groupSplitDonationSettings);
    if (!applied.ok) {
      showAppToast(`나누기 실패: ${applied.reason}`, { variant: "error" });
      return;
    }
    await persistReplace(applied.state);
  };

  const members = state?.members || [];
  const loading = !authReady || !state;

  return (
    <AdminPopupShell
      title="후원자 리스트"
      subtitle="별도 창 · 기본 50건 페이지네이션 · 전체 표시는 필요할 때만"
      userId={scopedUserId}
      accountMismatch={accountMismatch}
      sessionUserId={user?.id}
      urlUserId={urlUserId}
      loading={loading}
    >
      {!state ? null : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 rounded border border-slate-700/50 bg-slate-900/60 px-2.5 py-1">
              <span className="text-slate-400">전체 합계</span>
              <span className="font-semibold text-slate-100">{filteredAgg.count}건</span>
              <span className="text-slate-500">·</span>
              <span className="font-bold text-emerald-300">{formatWon(filteredAgg.sum)}</span>
            </div>
            {!showAll && (
              <div className="flex items-center gap-1.5 rounded border border-slate-700/40 bg-slate-900/40 px-2.5 py-1">
                <span className="text-slate-400">이 페이지</span>
                <span className="font-semibold text-slate-100">{pageAgg.count}건</span>
                <span className="text-slate-500">·</span>
                <span className="font-bold text-emerald-200">{formatWon(pageAgg.sum)}</span>
              </div>
            )}
            <span className="text-slate-500">최신순</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
              placeholder="검색: 후원자명 / 메시지 / 멤버"
              className="min-w-[180px] flex-1 rounded-lg border border-slate-700/60 bg-[#0D111D] px-3 py-1.5 text-xs text-slate-200"
            />
            {(["all", "today", "1h", "30m", "10m", "5m"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setTimeFilter(k);
                  setPage(1);
                }}
                className={`rounded border px-2 py-1 text-[11px] ${
                  timeFilter === k
                    ? "border-blue-500/60 bg-blue-600/30 text-blue-100 font-semibold"
                    : "border-slate-700/60 bg-slate-800/70 text-slate-300"
                }`}
              >
                {k === "all" ? "전체" : k === "today" ? "오늘" : k === "1h" ? "1시간" : k === "30m" ? "30분" : k === "10m" ? "10분" : "5분"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setDense((v) => !v)}
              className={`rounded border px-2.5 py-1 text-[11px] font-semibold ${
                dense
                  ? "border-emerald-500/60 bg-emerald-700/40 text-emerald-100"
                  : "border-slate-700/60 bg-slate-800/70 text-slate-300"
              }`}
            >
              {dense ? "압축 ON" : "압축 OFF"}
            </button>
          </div>

          <DonorBulkToolbar
            visibleCount={rowsVisible.length}
            selectedCount={selectedIds.size}
            hasAnySelection={selectedIds.size > 0}
            onSelectAllVisible={() => toggleSelect(undefined, true)}
            onClearAll={() => setSelectedIds(new Set())}
            onBulkDelete={bulkDelete}
          />

          <div className="overflow-auto rounded border border-white/10" style={{ maxHeight: "calc(100dvh - 260px)" }}>
            <table className={`w-full ${dense ? "text-[12px]" : "text-sm"}`} style={{ tableLayout: "fixed" }}>
              <thead className="sticky top-0 z-10 bg-neutral-950/95">
                <tr className="text-neutral-400">
                  <th className="w-10 p-1 text-left">
                    <DonorCheckboxCell
                      isAll
                      selected={rowsVisible.length > 0 && rowsVisible.every((d) => selectedIds.has(String(d.id)))}
                      onToggle={toggleSelect}
                      label="전체 선택"
                    />
                  </th>
                  <th className="w-24 p-1 text-left">시간</th>
                  <th className="w-36 p-1 text-left">후원자</th>
                  {!dense && <th className="w-36 p-1 text-left">멤버</th>}
                  <th className="w-14 p-1 text-left">대상</th>
                  <th className="p-1 text-left">메시지</th>
                  <th className="w-24 p-1 text-right">금액</th>
                  {!dense && <th className="w-24 p-1 text-right">나누기</th>}
                  <th className="w-16 p-1 text-right">삭제</th>
                </tr>
              </thead>
              <tbody>
                {rowsVisible.map((d, idx) => {
                  const idStr = String(d.id);
                  const isSplitPart = isGroupSplitPartDonor(d);
                  const isSplitSource = isGroupSplitSourceDonor(state, d);
                  const isExcluded = isDonorExcludedFromDonationTotals(d);
                  const splitPreview =
                    !dense && !isSplitPart && !isSplitSource && !isExcluded
                      ? previewGroupSplitDonation(state, d.amount, state.groupSplitDonationSettings)
                      : null;
                  return (
                    <tr key={idStr || `row-${idx}`} className="border-t border-white/10">
                      <td className="p-1">
                        <DonorCheckboxCell
                          donorId={idStr}
                          selected={selectedIds.has(idStr)}
                          onToggle={toggleSelect}
                        />
                      </td>
                      <td className="p-1 whitespace-nowrap text-neutral-400">{formatTime(Number(d.at || 0))}</td>
                      <td className="p-1">
                        <input
                          className="w-full rounded border border-white/10 bg-neutral-950/80 px-1.5 py-0.5 text-neutral-100"
                          value={typeof draftNames[idStr] === "string" ? draftNames[idStr] : d.name || ""}
                          onFocus={() => {
                            setDraftNames((prev) => (idStr in prev ? prev : { ...prev, [idStr]: d.name || "" }));
                          }}
                          onChange={(e) => setDraftNames((prev) => ({ ...prev, [idStr]: e.target.value }))}
                          onBlur={(e) => {
                            const nextName = String(e.target.value || "").trim() || "무명";
                            setDraftNames((prev) => {
                              const next = { ...prev };
                              delete next[idStr];
                              return next;
                            });
                            if (nextName !== (String(d.name || "").trim() || "무명")) void saveName(d, nextName);
                          }}
                        />
                      </td>
                      {!dense && (
                        <td className="p-1">
                          <select
                            className="w-full rounded border border-white/10 bg-neutral-900/80 text-neutral-100"
                            value={d.memberId || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v && v !== d.memberId) void saveMember(d, v);
                            }}
                          >
                            <option value="">— 미지정 —</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="p-1 whitespace-nowrap">
                        {resolveEffectiveDonorTarget(d) === "toon" ? (
                          <span className="text-amber-300">투네</span>
                        ) : (
                          <span className="text-emerald-300">계좌</span>
                        )}
                      </td>
                      <td className="p-1">
                        <input
                          className="w-full rounded border border-white/10 bg-neutral-950/80 px-1.5 py-0.5 text-neutral-200"
                          value={typeof draftMessages[idStr] === "string" ? draftMessages[idStr] : d.message || ""}
                          onFocus={() => {
                            setDraftMessages((prev) => (idStr in prev ? prev : { ...prev, [idStr]: d.message || "" }));
                          }}
                          onChange={(e) => setDraftMessages((prev) => ({ ...prev, [idStr]: e.target.value }))}
                          onBlur={(e) => {
                            const nextMessage = e.target.value;
                            setDraftMessages((prev) => {
                              const next = { ...prev };
                              delete next[idStr];
                              return next;
                            });
                            if (String(nextMessage || "").trim() !== String(d.message || "").trim()) {
                              void saveMessage(d, nextMessage);
                            }
                          }}
                        />
                      </td>
                      <td className="p-1 text-right whitespace-nowrap">{formatWon(d.amount)}</td>
                      {!dense && (
                        <td className="p-1 text-right">
                          {isSplitPart ? (
                            <span className="text-[10px] text-violet-300">↳ 스플릿</span>
                          ) : isSplitSource ? (
                            <span className="text-[10px] text-violet-300">스플릿됨</span>
                          ) : splitPreview && splitPreview.eligibleMembers.length > 0 && splitPreview.sharePerMember > 0 ? (
                            <button
                              type="button"
                              className="rounded bg-violet-800 px-2 py-0.5 text-[10px] hover:bg-violet-700"
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `${d.name} ${formatWon(d.amount)}을 ${splitPreview.eligibleMembers.length}명에게 나눌까요?`
                                  )
                                ) {
                                  void splitRow(d);
                                }
                              }}
                            >
                              나누기
                            </button>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </td>
                      )}
                      <td className="p-1 text-right">
                        {isSplitSource ? (
                          <span className="text-[10px] text-neutral-500">불가</span>
                        ) : (
                          <button
                            type="button"
                            className="rounded bg-rose-900 px-2 py-0.5 text-[10px] text-rose-100 hover:bg-rose-800"
                            onClick={() => void deleteRow(d)}
                          >
                            삭제
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {rowsVisible.length === 0 && (
                  <tr>
                    <td colSpan={dense ? 7 : 9} className="p-6 text-center text-neutral-500">
                      표시할 후원이 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {rowsFiltered.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
              <div className="flex items-center gap-2 flex-wrap">
                {showAll ? (
                  <span>전체 표시 · {rowsFiltered.length}건 (DOM 전체 렌더)</span>
                ) : (
                  <span>
                    페이지 <span className="font-bold text-amber-400">{pageIdx}</span> / {totalPages}
                    <span className="mx-2 text-neutral-600">·</span>
                    표시 {pageStart + 1}-{Math.min(pageEnd, rowsFiltered.length)} / {rowsFiltered.length}건
                  </span>
                )}
                {!showAll && (
                  <div className="flex items-center gap-1">
                    <span className="text-neutral-500">페이지당</span>
                    {DONOR_PAGE_SIZES.map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => {
                          setPageSize(sz);
                          setPage(1);
                        }}
                        className={`rounded border px-1.5 py-0.5 ${
                          pageSize === sz
                            ? "border-amber-500/60 bg-amber-700/40 text-amber-200"
                            : "border-neutral-700 bg-neutral-800 text-neutral-300"
                        }`}
                      >
                        {sz}건
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                {!showAll && totalPages > 1 && (
                  <>
                    <button type="button" disabled={pageIdx <= 1} onClick={() => setPage(1)} className="rounded bg-neutral-800 px-2 py-1 disabled:opacity-40">
                      « 처음
                    </button>
                    <button type="button" disabled={pageIdx <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="rounded bg-neutral-800 px-2 py-1 disabled:opacity-40">
                      ‹ 이전
                    </button>
                    <button type="button" disabled={pageIdx >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="rounded bg-neutral-800 px-2 py-1 disabled:opacity-40">
                      다음 ›
                    </button>
                    <button type="button" disabled={pageIdx >= totalPages} onClick={() => setPage(totalPages)} className="rounded bg-neutral-800 px-2 py-1 disabled:opacity-40">
                      마지막 »
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={`rounded px-2 py-1 ${
                    showAll
                      ? "border border-violet-500/50 bg-violet-700/40 text-violet-200"
                      : "bg-neutral-800 text-neutral-200"
                  }`}
                  onClick={() => {
                    setShowAll((v) => !v);
                    setPage(1);
                  }}
                >
                  {showAll ? "✓ 페이지네이션 모드로" : "📄 전체 표시 (성능 ↓)"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </AdminPopupShell>
  );
}
