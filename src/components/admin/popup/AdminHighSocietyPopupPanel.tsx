"use client";

import { useEffect, useMemo, useState } from "react";
import AdminPopupShell from "@/components/admin/popup/AdminPopupShell";
import { useAdminPopupBroadcastState } from "@/hooks/useAdminPopupBroadcastState";
import { applyHighSocietyAdminPatchToState } from "@/lib/admin-high-society-settings-patch";
import { showAppToast } from "@/lib/app-toast";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  buildHighSocietySettingsPersistToast,
  fieldCmFromStartPerMember,
  formatCm,
  normalizeHighSocietySettings,
  resolveHighSocietySeatMembers,
  resolveHighSocietyStartCmPerMember,
  resolveSystemMiddlePushDir,
  seatRoleForMemberId,
  appendTerritoryLogToAppState,
  removeTerritoryLogFromAppState,
  type HighSocietySettingsAdminPatch,
} from "@/lib/high-society";
import {
  createTerritoryLog,
  formatTerritoryLogPushDirLabel,
  resolveTerritoryLogPushDirForWrite,
} from "@/lib/territory-utils";
import { loadState, type AppState } from "@/lib/state";

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("ko-KR");
}

function parseCmInput(raw: string): number {
  const n = Number.parseInt(String(raw || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

export default function AdminHighSocietyPopupPanel() {
  const { user, scopedUserId, urlUserId, authReady, state, setState, stateRef, accountMismatch, persistAppState } =
    useAdminPopupBroadcastState();
  const [territoryMode, setTerritoryMode] = useState<"plus" | "minus">("plus");
  const [territoryCm, setTerritoryCm] = useState("");
  const [territoryMemberId, setTerritoryMemberId] = useState("");
  const [territoryPushDir, setTerritoryPushDir] = useState<"left" | "right" | "split" | "system">("system");
  const [territoryNote, setTerritoryNote] = useState("");
  const [copied, setCopied] = useState(false);

  const highSocietySettings = useMemo(
    () => normalizeHighSocietySettings(state?.highSocietySettings),
    [state?.highSocietySettings]
  );
  const hsSeatPlayers = useMemo(
    () => resolveHighSocietySeatMembers(state?.members || [], highSocietySettings),
    [state?.members, highSocietySettings]
  );
  const hsSeatCount = hsSeatPlayers.length;
  const hsStartCm = resolveHighSocietyStartCmPerMember(highSocietySettings, hsSeatCount);
  const hsEffectiveFieldCm = fieldCmFromStartPerMember(hsStartCm, hsSeatCount);

  useEffect(() => {
    if (!hsSeatPlayers.length) return;
    if (!territoryMemberId || !hsSeatPlayers.some((m) => m.id === territoryMemberId)) {
      setTerritoryMemberId(hsSeatPlayers[0]!.id);
    }
  }, [hsSeatPlayers, territoryMemberId]);

  const patchHighSociety = async (patch: HighSocietySettingsAdminPatch) => {
    if (!state) return;
    const prevSettings = normalizeHighSocietySettings(state.highSocietySettings);
    const wasOn = prevSettings.enabled;
    const lsDonors = loadState(scopedUserId)?.donors;
    const next = applyHighSocietyAdminPatchToState(state, patch, { lsDonors });
    const after = normalizeHighSocietySettings(next.highSocietySettings);
    const toast =
      buildHighSocietySettingsPersistToast({
        patch,
        before: prevSettings,
        wasOn,
        after,
        resetTerritory: Boolean(patch.resetTerritory),
        members: state.members || [],
      }) ?? undefined;
    const ok = await persistAppState(next, {
      omitDonationFields: true,
      highSocietySettingsOnly: true,
    });
    if (ok && toast) showAppToast(toast);
  };

  const addTerritoryRecord = async () => {
    const cur = stateRef.current;
    if (!cur) return;
    const hsNow = normalizeHighSocietySettings(cur.highSocietySettings);
    if (!hsNow.enabled) {
      showAppToast("상류사회가 OFF입니다. 먼저 모드를 켜 주세요.", { variant: "info" });
      return;
    }
    if (!territoryMemberId) return;
    const seated = resolveHighSocietySeatMembers(cur.members || [], hsNow);
    if (seated.length === 0) {
      showAppToast("좌석 멤버가 없습니다. 메인 관리자 오버레이 탭에서 좌석을 지정해 주세요.", {
        variant: "info",
      });
      return;
    }
    const cm = parseCmInput(territoryCm);
    if (cm <= 0) return;
    const seatRole = seatRoleForMemberId(hsNow, cur.members || [], territoryMemberId);
    const pushForLog = resolveTerritoryLogPushDirForWrite({
      seatRole,
      chosen: territoryPushDir,
      settings: hsNow,
    });
    const log = createTerritoryLog(
      territoryMemberId,
      territoryMode === "plus" ? 1 : -1,
      cm,
      { pushDir: pushForLog, note: territoryNote }
    );
    const next = appendTerritoryLogToAppState(cur, log);
    const ok = await persistAppState(next, {
      omitDonationFields: true,
      highSocietySettingsOnly: true,
    });
    if (ok) {
      setTerritoryCm("");
      setTerritoryNote("");
      showAppToast(`영토 ${territoryMode === "plus" ? "추가" : "차감"}: ${cm}cm`);
    }
  };

  const deleteTerritoryLog = async (logId: string) => {
    if (!state) return;
    if (!window.confirm("이 영토 기록을 삭제할까요?")) return;
    const next = removeTerritoryLogFromAppState(state, logId);
    await persistAppState(next, {
      omitDonationFields: true,
      highSocietySettingsOnly: true,
    });
  };

  const previewUrl = `/overlay/high-society?u=${scopedUserId}`;
  const testUrl = `${previewUrl}&test=true`;

  return (
    <AdminPopupShell
      title="상류사회 · 영토"
      subtitle="모드·영토 기록부 — 후원 리스트와 연동 없음(cm 수동만)"
      userId={scopedUserId}
      accountMismatch={accountMismatch}
      sessionUserId={user?.id}
      urlUserId={urlUserId}
      loading={!authReady || !state}
    >
      {state ? (
        <div className="space-y-4 max-w-3xl">
          <section className="rounded-lg border border-amber-400/35 bg-amber-950/25 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-amber-100">상류사회 모드</h2>
                <p className="mt-1 text-[11px] text-neutral-400">
                  1인 시작 {formatCm(hsStartCm)} · 전장 {hsEffectiveFieldCm.toLocaleString("ko-KR")}cm ({hsSeatCount}명)
                  · 좌석·전장 상세는{" "}
                  <a href="/admin#high-society-overlay" target="_blank" rel="noreferrer" className="text-sky-400 underline">
                    메인 관리자
                  </a>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`rounded px-3 py-1.5 text-xs font-semibold ${
                    highSocietySettings.enabled ? "bg-amber-600 text-white" : "bg-neutral-700 hover:bg-neutral-600"
                  }`}
                  onClick={() => void patchHighSociety({ enabled: !highSocietySettings.enabled })}
                >
                  {highSocietySettings.enabled ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  disabled={!highSocietySettings.enabled}
                  className={`rounded px-3 py-1.5 text-xs font-semibold border disabled:opacity-40 ${
                    highSocietySettings.territoryPaused
                      ? "border-sky-400 bg-sky-700/90 text-white"
                      : "border-white/15 bg-neutral-800"
                  }`}
                  onClick={() =>
                    void patchHighSociety({ territoryPaused: !highSocietySettings.territoryPaused })
                  }
                >
                  {highSocietySettings.territoryPaused ? "영토 재개" : "영토 일시정지"}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className={`rounded px-2.5 py-1 border ${
                  (highSocietySettings.territoryUpdateMode || "realtime") === "realtime"
                    ? "border-amber-400 bg-amber-700/90 text-white"
                    : "border-white/15 bg-neutral-900"
                }`}
                onClick={() => void patchHighSociety({ territoryUpdateMode: "realtime" })}
              >
                실시간 갱신
              </button>
              <button
                type="button"
                className={`rounded px-2.5 py-1 border ${
                  highSocietySettings.territoryUpdateMode === "onRoundEnd"
                    ? "border-amber-400 bg-amber-700/90 text-white"
                    : "border-white/15 bg-neutral-900"
                }`}
                onClick={() => void patchHighSociety({ territoryUpdateMode: "onRoundEnd" })}
              >
                라운드 종료 후
              </button>
              <button
                type="button"
                disabled={!highSocietySettings.enabled}
                className="rounded px-2.5 py-1 border border-white/15 bg-neutral-900 disabled:opacity-40"
                onClick={() => {
                  if (
                    !window.confirm(
                      "영토 게이지만 초기화합니다.\n후원·멤버 금액은 유지됩니다.\n계속할까요?"
                    )
                  ) {
                    return;
                  }
                  void patchHighSociety({ resetTerritory: true });
                }}
              >
                영토만 초기화
              </button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs items-center">
              <span className="text-neutral-400">가운데 기본</span>
              <button
                type="button"
                disabled={!highSocietySettings.enabled}
                className={`rounded px-2.5 py-1 border disabled:opacity-40 ${
                  resolveSystemMiddlePushDir(highSocietySettings) === "left"
                    ? "border-amber-400 bg-amber-700/90 text-white"
                    : "border-white/15 bg-neutral-900"
                }`}
                onClick={() => void patchHighSociety({ defaultMiddlePush: "left" })}
              >
                ← 왼쪽
              </button>
              <button
                type="button"
                disabled={!highSocietySettings.enabled}
                className={`rounded px-2.5 py-1 border disabled:opacity-40 ${
                  resolveSystemMiddlePushDir(highSocietySettings) === "right"
                    ? "border-amber-400 bg-amber-700/90 text-white"
                    : "border-white/15 bg-neutral-900"
                }`}
                onClick={() => void patchHighSociety({ defaultMiddlePush: "right" })}
              >
                오른쪽 →
              </button>
            </div>
          </section>

          <section className="rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
            <h2 className="text-sm font-semibold">영토 기록부</h2>
            {!highSocietySettings.enabled ? (
              <p className="text-sm text-amber-200/90">상류사회 모드를 ON 한 뒤 사용하세요.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto_auto_auto_auto] gap-2">
                  <select
                    className="rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                    value={territoryMode}
                    onChange={(e) => setTerritoryMode(e.target.value === "minus" ? "minus" : "plus")}
                  >
                    <option value="plus">확장(+)</option>
                    <option value="minus">축소(-)</option>
                  </select>
                  <input
                    className="rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                    placeholder="cm (예: 5, 105)"
                    inputMode="numeric"
                    value={territoryCm}
                    onChange={(e) => setTerritoryCm(e.target.value)}
                  />
                  <select
                    className="rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                    value={territoryMemberId}
                    onChange={(e) => setTerritoryMemberId(e.target.value)}
                    disabled={hsSeatPlayers.length === 0}
                  >
                    {hsSeatPlayers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                    value={territoryPushDir}
                    onChange={(e) => {
                      const v = e.target.value;
                      setTerritoryPushDir(
                        v === "left" || v === "right" || v === "split" ? v : "system"
                      );
                    }}
                  >
                    <option value="system">시스템</option>
                    <option value="left">← 왼쪽</option>
                    <option value="right">→ 오른쪽</option>
                    <option value="split">↔ 양분</option>
                  </select>
                  <input
                    className="rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                    placeholder="메모"
                    value={territoryNote}
                    onChange={(e) => setTerritoryNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className={`rounded px-3 py-1.5 text-sm font-semibold ${
                      territoryMode === "plus" ? "bg-amber-600 hover:bg-amber-500" : "bg-rose-600 hover:bg-rose-500"
                    }`}
                    onClick={() => void addTerritoryRecord()}
                  >
                    반영
                  </button>
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-neutral-400">
                        <th className="p-1 text-left">시각</th>
                        <th className="p-1 text-left">멤버</th>
                        <th className="p-1 text-left">구분</th>
                        <th className="p-1 text-right">cm</th>
                        <th className="p-1 text-left">방향</th>
                        <th className="p-1 text-left">메모</th>
                        <th className="p-1 text-right">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(state.territoryLogs || [])
                        .slice()
                        .sort((a, b) => b.at - a.at)
                        .map((log) => {
                          const member = state.members.find((m) => m.id === log.memberId);
                          return (
                            <tr key={log.id} className="border-t border-white/10">
                              <td className="p-1 text-neutral-400">{formatTime(log.at)}</td>
                              <td className="p-1">{member?.name || log.memberId}</td>
                              <td className="p-1">{log.delta > 0 ? "확장" : "축소"}</td>
                              <td className="p-1 text-right tabular-nums">{log.amount}</td>
                              <td className="p-1 text-neutral-400">
                                {formatTerritoryLogPushDirLabel(log, highSocietySettings, state.members || [])}
                              </td>
                              <td className="p-1 text-neutral-400">{log.note || "-"}</td>
                              <td className="p-1 text-right">
                                <button
                                  type="button"
                                  className="rounded bg-neutral-700 px-2 py-0.5 hover:bg-neutral-600"
                                  onClick={() => void deleteTerritoryLog(log.id)}
                                >
                                  삭제
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      {(state.territoryLogs || []).length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-3 text-center text-neutral-500">
                            기록 없음
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-2">
            <h2 className="text-sm font-semibold">OBS 미리보기</h2>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded bg-neutral-700 px-2 py-1 hover:bg-neutral-600"
                onClick={() => {
                  void copyTextToClipboard(`${window.location.origin}${previewUrl}`).then((ok) => {
                    if (ok) {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1500);
                    }
                  });
                }}
              >
                {copied ? "복사됨!" : "OBS URL 복사"}
              </button>
              <button
                type="button"
                className="rounded bg-violet-700 px-2 py-1 hover:bg-violet-600"
                onClick={() => window.open(testUrl, "_blank", "noopener,noreferrer")}
              >
                테스트 열기
              </button>
            </div>
            <code className="block text-[11px] text-neutral-400 break-all">{previewUrl}</code>
          </section>
        </div>
      ) : null}
    </AdminPopupShell>
  );
}
