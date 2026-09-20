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
  HIGH_SOCIETY_SEAT_COLORS,
  normalizeHighSocietySettings,
  resolveHighSocietySeatMembers,
  resolveHighSocietyStartCmPerMember,
  resolveSystemMiddlePushDir,
  seatRoleForMemberId,
  appendTerritoryLogToAppState,
  removeTerritoryLogFromAppState,
  resolveTeamColor,
  type HighSocietySettingsAdminPatch,
} from "@/lib/high-society";
import type { HighSocietyTeam } from "@/types";
import HighSocietySeatLayoutEditor from "@/components/admin/HighSocietySeatLayoutEditor";
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

  const matchMode = highSocietySettings.matchMode;
  const teams = highSocietySettings.teams || [];
  const memberTeamAssignments = highSocietySettings.memberTeamAssignments || {};

  const teamMemberMap = useMemo(() => {
    const map: Record<string, typeof hsSeatPlayers> = {};
    for (const t of teams) map[t.id] = [];
    for (const m of hsSeatPlayers) {
      const tid = memberTeamAssignments[m.id];
      if (tid && map[tid]) map[tid]!.push(m);
    }
    return map;
  }, [teams, hsSeatPlayers, memberTeamAssignments]);

  const unassignedMembers = useMemo(
    () => hsSeatPlayers.filter((m) => !memberTeamAssignments[m.id]),
    [hsSeatPlayers, memberTeamAssignments]
  );

  const addTeam = () => {
    const idx = teams.length + 1;
    const id = `team_${Date.now()}_${idx}`;
    const name = `${idx}팀`;
    void patchHighSociety({ teams: [...teams, { id, name }] });
  };

  const updateTeam = (teamId: string, patch: Partial<HighSocietyTeam>) => {
    void patchHighSociety({
      teams: teams.map((t) => (t.id === teamId ? { ...t, ...patch } : t)),
    });
  };

  const removeTeam = (teamId: string) => {
    if (!window.confirm("이 팀을 삭제할까요? 소속 멤버는 미배정으로 변경됩니다.")) return;
    const newTeams = teams.filter((t) => t.id !== teamId);
    const newAssignments = Object.fromEntries(
      Object.entries(memberTeamAssignments).filter(([, tid]) => tid !== teamId)
    );
    void patchHighSociety({ teams: newTeams, memberTeamAssignments: newAssignments });
  };

  const assignMemberToTeam = (memberId: string, teamId: string) => {
    void patchHighSociety({
      memberTeamAssignments: { ...memberTeamAssignments, [memberId]: teamId },
    });
  };

  const unassignMember = (memberId: string) => {
    const next = { ...memberTeamAssignments };
    delete next[memberId];
    void patchHighSociety({ memberTeamAssignments: next });
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
                  · 좌석·전장·배치도는 이 창에서 편집
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
                <div className="flex rounded border border-white/15 overflow-hidden">
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-semibold ${
                      matchMode === "individual"
                        ? "bg-neutral-600 text-white"
                        : "bg-neutral-800 text-neutral-400 hover:text-white"
                    }`}
                    onClick={() => void patchHighSociety({ matchMode: "individual" })}
                  >
                    개인전
                  </button>
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-semibold border-l border-white/15 ${
                      matchMode === "team"
                        ? "bg-neutral-600 text-white"
                        : "bg-neutral-800 text-neutral-400 hover:text-white"
                    }`}
                    onClick={() => void patchHighSociety({ matchMode: "team" })}
                  >
                    팀전
                  </button>
                </div>
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

          {matchMode === "team" ? (
            <section className="rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">팀 관리</h2>
                  <p className="mt-1 text-[11px] text-neutral-400 leading-snug">
                    팀 이름·색상 편집 / 멤버 배정 — 팀에 속한 멤버끼리 영토를 합산합니다.
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded border border-white/15 bg-neutral-800 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-700"
                  onClick={() => addTeam()}
                >
                  + 팀 추가
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {teams.map((team, idx) => {
                  const color = resolveTeamColor(team, idx);
                  const members = teamMemberMap[team.id] || [];
                  return (
                    <div
                      key={team.id}
                      className="rounded-lg border border-white/10 bg-neutral-950/40 p-3 space-y-2"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-4 h-4 rounded-sm shrink-0 border border-white/20 shadow-inner"
                            style={{ backgroundColor: color }}
                          />
                          <input
                            className="flex-1 rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-xs font-semibold"
                            value={team.name}
                            placeholder="팀 이름 (예: 금수저팀)"
                            onChange={(e) => updateTeam(team.id, { name: e.target.value })}
                          />
                          <label
                            className="cursor-pointer rounded border border-white/15 bg-neutral-800 px-2 py-1.5 text-[11px] hover:bg-neutral-700 flex items-center gap-1.5"
                            title="커스텀 색상 선택"
                          >
                            <span
                              className="inline-block w-3 h-3 rounded-sm border border-white/20"
                              style={{ backgroundColor: color }}
                            />
                            색
                            <input
                              type="color"
                              className="sr-only"
                              value={/^#[0-9a-f]{6}$/i.test(color) ? color : "#000000"}
                              onChange={(e) => {
                                const val = e.target.value.trim();
                                if (/^#[0-9a-f]{6}$/i.test(val)) {
                                  updateTeam(team.id, { color: val });
                                }
                              }}
                            />
                          </label>
                          <button
                            type="button"
                            className="rounded border border-white/15 bg-neutral-800 px-2 py-1.5 text-[11px] hover:bg-rose-800 hover:border-rose-600/50"
                            onClick={() => removeTeam(team.id)}
                          >
                            삭제
                          </button>
                        </div>

                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {Array.from(HIGH_SOCIETY_SEAT_COLORS).map((preset) => {
                            const selected = color.toLowerCase() === preset.toLowerCase();
                            return (
                              <button
                                key={preset}
                                type="button"
                                title={`프리셋 ${preset}`}
                                className={`w-6 h-6 rounded border transition-all ${
                                  selected
                                    ? "border-white/90 scale-110 ring-2 ring-white/50"
                                    : "border-white/20 hover:scale-105 hover:border-white/50"
                                }`}
                                style={{ backgroundColor: preset }}
                                onClick={() => updateTeam(team.id, { color: preset })}
                              />
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[11px] text-neutral-400">
                          소속 멤버 ({members.length})
                        </div>
                        <div className="flex flex-wrap gap-1 min-h-[24px]">
                          {members.length === 0 ? (
                            <span className="text-[11px] text-neutral-600">— 배정 없음</span>
                          ) : (
                            members.map((m) => (
                              <span
                                key={m.id}
                                className="inline-flex items-center gap-1 rounded border border-white/10 bg-neutral-800 px-1.5 py-0.5 text-[11px]"
                              >
                                {m.name}
                                <button
                                  type="button"
                                  className="text-neutral-500 hover:text-rose-400 leading-none"
                                  onClick={() => unassignMember(m.id)}
                                >
                                  ✕
                                </button>
                              </span>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="flex gap-1.5">
                        <select
                          className="flex-1 rounded border border-white/10 bg-neutral-950 px-2 py-1 text-[11px]"
                          defaultValue=""
                          onChange={(e) => {
                            const mid = e.target.value;
                            if (mid) assignMemberToTeam(mid, team.id);
                            e.currentTarget.value = "";
                          }}
                        >
                          <option value="" disabled>
                            + 멤버 배정
                          </option>
                          {(unassignedMembers.length === 0
                            ? hsSeatPlayers.filter((m) => memberTeamAssignments[m.id] !== team.id)
                            : unassignedMembers
                          ).map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                              {memberTeamAssignments[m.id]
                                ? ` (${
                                    teams.find((t) => t.id === memberTeamAssignments[m.id])?.name || "타팀"
                                  })`
                                : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>

              {teams.length === 0 ? (
                <div className="rounded border border-dashed border-white/15 p-4 text-center text-xs text-neutral-500">
                  아직 팀이 없습니다. 위 「+ 팀 추가」 버튼으로 1팀부터 만들어 보세요.
                </div>
              ) : null}

              {unassignedMembers.length > 0 ? (
                <div className="rounded-lg border border-white/10 bg-neutral-950/40 p-3 space-y-1.5">
                  <div className="text-[11px] text-neutral-400">
                    미배정 멤버 ({unassignedMembers.length})
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {unassignedMembers.map((m) => (
                      <span
                        key={m.id}
                        className="inline-flex items-center gap-1 rounded border border-white/10 bg-neutral-800 px-1.5 py-0.5 text-[11px] text-neutral-300"
                      >
                        ◦ {m.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-lg border border-amber-400/35 bg-amber-950/20 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-amber-100">영토 배치도</h2>
            <p className="text-[11px] text-neutral-400 leading-snug">
              좌석 추가·순서·삭제·1인 시작 cm는 이 팝업에서만 변경합니다.
            </p>
            <HighSocietySeatLayoutEditor
              members={state.members || []}
              donors={state.donors || []}
              territoryLogs={state.territoryLogs || []}
              settings={highSocietySettings}
              onPatch={(patch) => void patchHighSociety(patch)}
              showMiddlePushSelect={false}
            />
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
                    {hsSeatPlayers.map((m) => {
                      const tid = memberTeamAssignments[m.id];
                      const team = teams.find((t) => t.id === tid);
                      const label =
                        matchMode === "team" && team
                          ? `[${team.name}] ${m.name}`
                          : m.name;
                      return (
                        <option key={m.id} value={m.id}>
                          {label}
                        </option>
                      );
                    })}
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
