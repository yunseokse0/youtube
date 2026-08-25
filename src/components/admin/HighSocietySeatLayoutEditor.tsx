"use client";

import { useCallback, useMemo, useState } from "react";
import { showAppToast } from "@/lib/app-toast";
import {
  HIGH_SOCIETY_MAX_SEATS,
  buildHighSocietyFieldFromAppState,
  fieldCmFromStartPerMember,
  formatCm,
  formatSeatWidthCm,
  insertHighSocietySeatMemberIdAt,
  isHighSocietySeatSelectionManual,
  normalizeHighSocietySettings,
  normalizeZeroCmGaugeDisplay,
  resolveHighSocietySeatCountForField,
  resolveHighSocietySeatMemberIdsForEdit,
  resolveHighSocietySeatMembers,
  resolveHighSocietyStartCmPerMember,
  resolveSystemMiddlePushDir,
  type HighSocietySettingsAdminPatch,
} from "@/lib/high-society";
import type { AppState, Donor, HighSocietySettings, Member, TerritoryLog } from "@/types";

type Props = {
  members: Member[];
  donors?: Donor[];
  territoryLogs?: TerritoryLog[];
  settings: HighSocietySettings;
  onPatch: (patch: HighSocietySettingsAdminPatch) => void | Promise<void>;
  /** 가운데 시스템 방향 셀렉트 표시 (기본 true) */
  showMiddlePushSelect?: boolean;
};

/** 상류사회 영토 배치도 — 팝업 전용 편집 UI */
export default function HighSocietySeatLayoutEditor({
  members,
  donors = [],
  territoryLogs = [],
  settings: settingsRaw,
  onPatch,
  showMiddlePushSelect = true,
}: Props) {
  const settings = useMemo(() => normalizeHighSocietySettings(settingsRaw), [settingsRaw]);
  const hsSeatPlayers = useMemo(
    () => resolveHighSocietySeatMembers(members, settings),
    [members, settings]
  );
  const hsSeatExplicit = isHighSocietySeatSelectionManual(settings);
  const hsSeatedIdSet = useMemo(
    () => new Set(hsSeatPlayers.map((p) => String(p.id))),
    [hsSeatPlayers]
  );
  const hsUnseatedMembers = useMemo(
    () => (members || []).filter((m) => !m.operating && !hsSeatedIdSet.has(String(m.id))),
    [members, hsSeatedIdSet]
  );
  const hsSeatCountForStart = resolveHighSocietySeatCountForField(settings, hsSeatPlayers.length);
  const hsStartCm = resolveHighSocietyStartCmPerMember(settings, hsSeatCountForStart);
  const hsEffectiveFieldCm = fieldCmFromStartPerMember(hsStartCm, hsSeatCountForStart);

  const hsSeatFieldByMemberId = useMemo(() => {
    const map = new Map<string, { widthCm: number; eliminated: boolean }>();
    if (!settings.enabled) return map;
    const field = buildHighSocietyFieldFromAppState({
      members,
      donors,
      highSocietySettings: settings,
      territoryLogs,
    } as Pick<AppState, "members" | "donors" | "highSocietySettings" | "territoryLogs">);
    for (const seat of field.seats) {
      map.set(seat.id, { widthCm: seat.widthCm, eliminated: seat.eliminated });
    }
    return map;
  }, [settings, donors, members, territoryLogs]);

  const [startCmDraft, setStartCmDraft] = useState<string | null>(null);
  const startCmInputValue =
    startCmDraft !== null ? startCmDraft : String(Math.max(1, Math.round(hsStartCm)));

  const patchStartCm = useCallback(
    (startCm: number) => {
      const seats = resolveHighSocietySeatCountForField(
        settings,
        hsSeatPlayers.length || hsSeatCountForStart
      );
      const clamped = Math.max(1, Math.min(5000, Math.floor(Number(startCm) || 0)));
      setStartCmDraft(null);
      void onPatch({
        startCmPerMember: clamped,
        fieldCm: fieldCmFromStartPerMember(clamped, seats),
        memberWidthCm: undefined,
        memberWidthDonationSnapshot: undefined,
        memberTerritoryExpand: undefined,
      });
    },
    [settings, hsSeatCountForStart, hsSeatPlayers.length, onPatch]
  );

  const commitStartCmDraft = useCallback(() => {
    const raw = startCmDraft;
    if (raw === null) return;
    const n = parseInt(raw || "0", 10);
    if (!Number.isFinite(n) || n <= 0) {
      setStartCmDraft(null);
      return;
    }
    patchStartCm(n);
  }, [startCmDraft, patchStartCm]);

  const moveSeat = useCallback(
    (memberId: string, dir: -1 | 1) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      const idx = cur.findIndex((sid) => String(sid) === id);
      if (idx < 0) return;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= cur.length) return;
      const swapped = cur.slice();
      const tmp = swapped[idx]!;
      swapped[idx] = swapped[nextIdx]!;
      swapped[nextIdx] = tmp;
      void onPatch({ seatMemberIds: swapped, seatMemberIdsManual: true });
    },
    [settings, members, onPatch]
  );

  const moveSeatToIndex = useCallback(
    (memberId: string, targetIndex: number) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      const idx = cur.findIndex((sid) => String(sid) === id);
      if (idx < 0) return;
      const without = cur.filter((sid) => String(sid) !== id);
      const at = Math.max(0, Math.min(Math.floor(targetIndex), without.length));
      void onPatch({
        seatMemberIds: [...without.slice(0, at), id, ...without.slice(at)],
        seatMemberIdsManual: true,
      });
    },
    [settings, members, onPatch]
  );

  const addSeat = useCallback(
    (memberId: string, atIndex?: number) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const seated = resolveHighSocietySeatMembers(members, settings);
      if (seated.some((p) => p.id === id)) return;
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      if (cur.length >= HIGH_SOCIETY_MAX_SEATS) {
        showAppToast(`상류사회 좌석은 최대 ${HIGH_SOCIETY_MAX_SEATS}명입니다`, { variant: "info" });
        return;
      }
      const insertAt =
        typeof atIndex === "number" && Number.isFinite(atIndex)
          ? Math.max(0, Math.min(Math.floor(atIndex), cur.length))
          : cur.length;
      void onPatch({
        seatMemberIds: insertHighSocietySeatMemberIdAt(cur, id, insertAt),
        seatMemberIdsManual: true,
      });
    },
    [settings, members, onPatch]
  );

  const removeSeat = useCallback(
    (memberId: string) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      void onPatch({
        seatMemberIds: cur.filter((sid) => String(sid) !== id),
        seatMemberIdsManual: true,
      });
    },
    [settings, members, onPatch]
  );

  return (
    <div className="space-y-3" data-hs-seat-layout="editor">
      <label className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
        1인 시작 (cm)
        <input
          type="text"
          inputMode="numeric"
          className="w-28 rounded border border-white/10 bg-neutral-950 px-2 py-1 text-sm text-amber-50"
          value={startCmInputValue}
          onChange={(e) => setStartCmDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 5))}
          onBlur={() => commitStartCmDraft()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <span className="text-neutral-500">
          → 전장{" "}
          <strong className="text-neutral-200">
            {hsEffectiveFieldCm.toLocaleString("ko-KR")}cm
          </strong>
          ({hsSeatCountForStart}명 기준 · OFF여도 저장값 유지)
        </span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {[100, 200, 300, 400, 500, 600].map((cm) => (
          <button
            key={`hs-start-${cm}`}
            type="button"
            className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${
              Math.round(hsStartCm) === cm
                ? "border-amber-400 bg-amber-700/80 text-white"
                : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
            }`}
            onClick={() => patchStartCm(cm)}
          >
            1인 {cm}cm
          </button>
        ))}
      </div>

      <div className="space-y-2 rounded border border-white/10 bg-black/20 p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-neutral-400 leading-snug">
            좌석 배치(좌→右). ←→로 순서 변경 · 최대 {HIGH_SOCIETY_MAX_SEATS}명.
            {hsSeatExplicit ? (
              <>
                {" "}
                <strong className="text-amber-200/90">수동 고정</strong>
              </>
            ) : (
              <>
                {" "}
                지금은 <strong className="text-neutral-300">자동(전원 N등분)</strong>
                — 삭제/이동 시 그 배치로 고정됩니다.
              </>
            )}
            <span className="block mt-0.5 text-[10px] text-neutral-500">
              0cm 탈락 멤버는 기본적으로 게이지에서 빠집니다. 영토 cm 조절은 「영토 기록부」에서만
              수동 반영합니다.
            </span>
          </div>
          {hsSeatExplicit ? (
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[10px] font-semibold border border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
              onClick={() => void onPatch({ seatMemberIds: [], seatMemberIdsManual: false })}
            >
              자동(전원)으로
            </button>
          ) : null}
        </div>

        <label className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
          <span className="text-neutral-400">0cm 게이지 표시</span>
          <select
            className="rounded border border-white/10 bg-neutral-950 px-2 py-1 text-[11px]"
            value={normalizeZeroCmGaugeDisplay(settings.zeroCmGaugeDisplay)}
            onChange={(e) =>
              void onPatch({
                zeroCmGaugeDisplay: normalizeZeroCmGaugeDisplay(e.target.value),
              })
            }
          >
            <option value="hidden">숨김 (기본)</option>
            <option value="0cm">게이지에 0cm 표시</option>
            <option value="00cm">게이지에 00cm 표시</option>
          </select>
        </label>

        {hsSeatPlayers.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {hsSeatPlayers.map((p, i) => {
              const expandHint = i === 0 ? "→만" : i === hsSeatPlayers.length - 1 ? "←만" : "↔";
              const fieldSeat = hsSeatFieldByMemberId.get(p.id);
              const eliminated = fieldSeat?.eliminated === true;
              const zeroCmDisplay = normalizeZeroCmGaugeDisplay(settings.zeroCmGaugeDisplay);
              return (
                <div
                  key={`hs-seat-${p.id}`}
                  className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                    eliminated
                      ? "border-neutral-500/50 bg-neutral-900/80 opacity-75"
                      : "border-amber-400/50 bg-amber-900/50"
                  }`}
                >
                  <span className="min-w-[1.25rem] text-center text-[10px] font-bold text-amber-200">
                    {i + 1}
                  </span>
                  <div className="leading-tight">
                    <div className="text-[11px] font-semibold text-white">{p.name}</div>
                    <div className="text-[9px] text-amber-200/70">
                      {eliminated
                        ? `${formatSeatWidthCm(0, zeroCmDisplay)} 탈락 · ${expandHint}`
                        : fieldSeat
                          ? `${formatCm(fieldSeat.widthCm)} · ${expandHint}`
                          : expandHint}
                    </div>
                  </div>
                  <div className="ml-1 flex flex-col gap-0.5">
                    {eliminated ? (
                      <select
                        className="max-w-[5.5rem] rounded bg-neutral-950/70 px-1 py-0.5 text-[9px] text-neutral-200"
                        value={String(i)}
                        title="0cm 탈락 — 재진입 위치(좌→右)"
                        aria-label={`${p.name} 재진입 위치`}
                        onChange={(e) => {
                          const at = Number(e.target.value);
                          if (Number.isFinite(at) && at !== i) moveSeatToIndex(p.id, at);
                        }}
                      >
                        {Array.from({ length: hsSeatPlayers.length }, (_, at) => (
                          <option key={`hs-seat-at-${p.id}-${at}`} value={String(at)}>
                            {at + 1}번 위치
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="rounded bg-neutral-950/70 px-1.5 py-0.5 text-[10px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-30"
                      disabled={i === 0}
                      title="왼쪽으로"
                      onClick={() => moveSeat(p.id, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="rounded bg-neutral-950/70 px-1.5 py-0.5 text-[10px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-30"
                      disabled={i >= hsSeatPlayers.length - 1}
                      title="오른쪽으로"
                      onClick={() => moveSeat(p.id, 1)}
                    >
                      →
                    </button>
                  </div>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-950/50"
                    title="좌석에서 제거"
                    onClick={() => removeSeat(p.id)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed border-white/15 bg-black/20 px-2 py-2 text-[11px] text-neutral-500">
            좌석에 멤버가 없습니다. 아래에서 추가하거나 「자동(전원)으로」를 누르세요.
          </div>
        )}

        {hsUnseatedMembers.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[10px] text-neutral-500">좌석에 추가 — 위치(좌→右)를 고른 뒤 추가</div>
            <div className="flex flex-col gap-1.5">
              {hsUnseatedMembers.map((m) => (
                <div key={`hs-add-${m.id}`} className="flex flex-wrap items-center gap-1.5">
                  <select
                    className="rounded border border-white/15 bg-neutral-950 px-1.5 py-1 text-[10px] text-neutral-200"
                    defaultValue={String(hsSeatPlayers.length)}
                    aria-label={`${m.name} 좌석 삽입 위치`}
                    id={`hs-popup-add-seat-at-${m.id}`}
                  >
                    {Array.from({ length: hsSeatPlayers.length + 1 }, (_, at) => (
                      <option key={`hs-add-at-${m.id}-${at}`} value={String(at)}>
                        {at === 0
                          ? "← 맨 왼쪽"
                          : at >= hsSeatPlayers.length
                            ? "맨 오른쪽 →"
                            : `${at + 1}번과 ${at + 2}번 사이`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded border border-white/15 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-neutral-300 hover:border-amber-400/50 hover:text-amber-100"
                    onClick={() => {
                      const sel = document.getElementById(
                        `hs-popup-add-seat-at-${m.id}`
                      ) as HTMLSelectElement | null;
                      const at = Number(sel?.value ?? hsSeatPlayers.length);
                      addSeat(m.id, Number.isFinite(at) ? at : hsSeatPlayers.length);
                    }}
                  >
                    + {m.name}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {showMiddlePushSelect ? (
        <label className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
          가운데 시스템 기본 방향
          <select
            className="rounded border border-white/10 bg-neutral-950 px-2 py-1"
            value={resolveSystemMiddlePushDir(settings)}
            onChange={(e) =>
              void onPatch({
                defaultMiddlePush: e.target.value === "left" ? "left" : "right",
              })
            }
          >
            <option value="right">오른쪽 → (기본)</option>
            <option value="left">← 왼쪽</option>
          </select>
        </label>
      ) : null}

      <p className="text-[10px] text-neutral-500 leading-snug">
        ON 시 좌석 멤버 후원 연동이 켜집니다. OFF·설정 저장·영토 초기화는 후원 기록·멤버 금액을
        건드리지 않습니다.
      </p>
    </div>
  );
}

/** 메인 관리자용 — 배치 요약 + 팝업 유도 (편집 불가) */
export function HighSocietySeatLayoutSummary({
  members,
  settings,
  onOpenPopup,
}: {
  members: Member[];
  settings: HighSocietySettings;
  onOpenPopup: () => void;
}) {
  const hs = useMemo(() => normalizeHighSocietySettings(settings), [settings]);
  const seats = useMemo(() => resolveHighSocietySeatMembers(members, hs), [members, hs]);
  const seatCount = resolveHighSocietySeatCountForField(hs, seats.length);
  const startCm = resolveHighSocietyStartCmPerMember(hs, seatCount);
  const fieldCm = fieldCmFromStartPerMember(startCm, seatCount);
  const names = seats.map((s) => s.name).join(" → ") || "좌석 없음";

  return (
    <div className="space-y-2 rounded border border-dashed border-amber-400/40 bg-black/25 p-2.5">
      <div className="text-[11px] font-semibold text-amber-100/95">영토 배치도</div>
      <p className="text-[11px] text-neutral-300 leading-snug">
        좌석 추가·순서·삭제·1인 시작 cm는{" "}
        <strong className="text-amber-100">상류사회 팝업</strong>에서만 편집합니다.
      </p>
      <p className="text-[11px] text-neutral-400 break-keep">
        현재: {seats.length}명 · 1인 {Math.round(startCm)}cm · 전장 {fieldCm.toLocaleString("ko-KR")}
        cm
        <span className="mt-0.5 block text-neutral-500">{names}</span>
      </p>
      <button
        type="button"
        className="rounded border border-violet-500/40 bg-violet-950/50 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-900/60"
        onClick={onOpenPopup}
      >
        별도 창에서 영토 배치도 열기
      </button>
    </div>
  );
}
