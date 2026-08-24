"use client";

import { useEffect, useMemo, useState } from "react";
import { FlipCountdownTimer } from "@/components/FlipCountdownTimer";
import { CircularImageTimer } from "@/components/CircularImageTimer";
import { LedMatrixTimer } from "@/components/LedMatrixTimer";
import AdminPopupShell from "@/components/admin/popup/AdminPopupShell";
import { useAdminPopupBroadcastState } from "@/hooks/useAdminPopupBroadcastState";
import { copyTextToClipboard } from "@/lib/copy-to-clipboard";
import {
  getEffectiveRemainingTime,
  pauseTimer,
  resumeTimer,
} from "@/lib/timer-utils";
import type { TimerState } from "@/types";
import {
  ensureTimerGoogleFontsLoaded,
  normalizeTimerFontFamily,
  resolveTimerFontFamilyCss,
  TIMER_FONT_FAMILY_OPTIONS,
} from "@/lib/timer-font-style";
import {
  isImageFrameTimerDesign,
  normalizeTimerDesign,
  resolveCircularImageTimerFontSize,
  TIMER_DESIGN_OPTIONS,
} from "@/lib/timer-design";
import {
  saveGeneralTimerPatchAsync,
  saveMatchTimerPatchAsync,
  type AppState,
} from "@/lib/state";
import { notifyBroadcastStateLocalUpdated } from "@/lib/broadcast-state-local-sync";

type AppTimerKey = "generalTimer" | "matchTimer";

function formatClock(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function toColorPickerValue(raw?: string, fallback = "#ffffff"): string {
  const v = (raw || "").trim();
  const lower = v.toLowerCase();
  if (!v || lower === "transparent" || lower === "none") return fallback;
  const m = v.match(/^#([0-9a-fA-F]{6})$/);
  return m ? `#${m[1].toLowerCase()}` : fallback;
}

export default function AdminTimerPopupPanel() {
  const { user, scopedUserId, urlUserId, authReady, state, setState, accountMismatch, persistAppState } =
    useAdminPopupBroadcastState();
  const [timerUiNow, setTimerUiNow] = useState(Date.now());
  const [minuteInput, setMinuteInput] = useState({ generalTimer: "0", matchTimer: "0" });
  const [matchDurationSec, setMatchDurationSec] = useState("180");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setInterval(() => setTimerUiNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!state) return;
    setMatchDurationSec(String(state.sigMatchSettings?.overlayTimerDurationSec ?? 180));
  }, [state?.sigMatchSettings?.overlayTimerDurationSec, state]);

  const updateTimer = (key: AppTimerKey, updater: (timer: TimerState) => TimerState) => {
    if (!state) return;
    const current = key === "generalTimer" ? state.generalTimer : state.matchTimer ?? state.generalTimer;
    const nextTimer = updater(current);
    const next: AppState = { ...state, [key]: nextTimer, updatedAt: Date.now() };
    setState(next);
    if (key === "generalTimer") void saveGeneralTimerPatchAsync(nextTimer, scopedUserId);
    else void saveMatchTimerPatchAsync(nextTimer, scopedUserId);
    notifyBroadcastStateLocalUpdated(scopedUserId, next.updatedAt);
  };

  const adjustSeconds = (key: AppTimerKey, delta: number) => {
    updateTimer(key, (timer) => {
      const effective = getEffectiveRemainingTime(timer);
      return {
        remainingTime: Math.max(0, effective + delta),
        isActive: timer.isActive,
        lastUpdated: Date.now(),
      };
    });
  };

  const setMinutes = (key: AppTimerKey, minutes: number) => {
    const sec = Math.max(0, Math.floor(minutes)) * 60;
    updateTimer(key, (timer) => ({
      remainingTime: sec,
      isActive: sec > 0 ? timer.isActive : false,
      lastUpdated: Date.now(),
    }));
  };

  const toggleOverlay = (enabled: boolean) => {
    if (!state) return;
    const matchTimerEnabled = { ...(state.matchTimerEnabled || { general: true }), general: enabled };
    const next = { ...state, matchTimerEnabled, updatedAt: Date.now() };
    setState(next);
    void saveGeneralTimerPatchAsync(state.generalTimer, scopedUserId, { matchTimerEnabled });
  };

  const updateDisplayStyle = (patch: Partial<AppState["timerDisplayStyles"]["general"]>) => {
    if (!state) return;
    const base = state.timerDisplayStyles || {
      general: {
        showHours: false,
        design: "pill",
        fontFamily: "mono",
        fontColor: "",
        bgColor: "",
        borderColor: "",
        outlineColor: "",
        outlineWidth: 0.8,
        bgOpacity: 40,
        scalePercent: 100,
      },
    };
    const timerDisplayStyles = {
      ...base,
      general: { ...base.general, ...patch },
    };
    const next = { ...state, timerDisplayStyles, updatedAt: Date.now() };
    setState(next);
    void saveGeneralTimerPatchAsync(state.generalTimer, scopedUserId, { timerDisplayStyles });
  };

  const matchTimer = state?.matchTimer ?? state?.generalTimer;
  const matchRem = matchTimer ? getEffectiveRemainingTime(matchTimer, timerUiNow) : 0;
  const matchRunning = Boolean(matchTimer?.isActive && matchRem > 0);

  const startMatchTimer = () => {
    if (!state) return;
    const rem = getEffectiveRemainingTime(state.matchTimer ?? state.generalTimer);
    const sec = Math.max(0, Number.parseInt(matchDurationSec || "0", 10) || 0);
    if (rem <= 0 && sec <= 0) {
      window.alert("먼저 타이머 시간을 1초 이상 입력해 주세요.");
      return;
    }
    const base = state.matchTimer ?? state.generalTimer;
    const started =
      rem > 0
        ? resumeTimer(base)
        : { remainingTime: sec, isActive: true, lastUpdated: Date.now() };
    const next: AppState = {
      ...state,
      matchTimer: started,
      sigMatchSettings: {
        ...state.sigMatchSettings,
        overlayTimerDurationSec: sec,
        overlayTimerEndAt: null,
      },
      updatedAt: Date.now(),
    };
    setState(next);
    void saveMatchTimerPatchAsync(started, scopedUserId);
  };

  const pauseMatchTimer = () => {
    if (!state) return;
    const paused = pauseTimer(state.matchTimer ?? state.generalTimer);
    const next = { ...state, matchTimer: paused, updatedAt: Date.now() };
    setState(next);
    void saveMatchTimerPatchAsync(paused, scopedUserId);
  };

  const resetMatchTimer = () => {
    if (!state) return;
    const sec = Math.max(0, Number.parseInt(matchDurationSec || "0", 10) || 0);
    const reset = { remainingTime: sec, isActive: false, lastUpdated: Date.now() };
    const next: AppState = { ...state, matchTimer: reset, updatedAt: Date.now() };
    setState(next);
    void saveMatchTimerPatchAsync(reset, scopedUserId);
  };

  const saveMatchDuration = async () => {
    if (!state) return;
    const sec = Math.max(0, Math.min(86400, Number.parseInt(matchDurationSec || "0", 10) || 0));
    setMatchDurationSec(String(sec));
    const next: AppState = {
      ...state,
      sigMatchSettings: { ...state.sigMatchSettings, overlayTimerDurationSec: sec },
      updatedAt: Date.now(),
    };
    await persistAppState(next, { omitDonationFields: true });
  };

  const timerOnlyUrl = `/overlay?u=${scopedUserId}&timerType=general&host=obs`;

  const copyUrl = async (url: string, id: string) => {
    const abs = `${window.location.origin}${url}`;
    const ok = await copyTextToClipboard(abs);
    if (ok) {
      setCopied(id);
      window.setTimeout(() => setCopied(null), 1500);
    }
  };

  const generalStyle = state?.timerDisplayStyles?.general;
  const generalDesign = normalizeTimerDesign(generalStyle?.design);
  const generalFontId = normalizeTimerFontFamily(generalStyle?.fontFamily);
  const generalEffective = state
    ? getEffectiveRemainingTime(state.generalTimer, timerUiNow)
    : 0;

  return (
    <AdminPopupShell
      title="타이머 제어"
      subtitle="일반 타이머 · 대전(matchTimer) — 메인 관리자와 실시간 동기화"
      userId={scopedUserId}
      accountMismatch={accountMismatch}
      sessionUserId={user?.id}
      urlUserId={urlUserId}
      loading={!authReady || !state}
    >
      {state ? (
        <div className="space-y-4 max-w-xl">
          <section className="rounded-lg border border-white/10 bg-neutral-900/50 p-3 space-y-3">
            <h2 className="text-sm font-semibold">일반 타이머</h2>
            <div className="text-2xl font-bold tabular-nums">{formatClock(generalEffective)}</div>
            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                className={`rounded px-2 py-1 text-xs font-semibold ${
                  state.generalTimer.isActive ? "bg-amber-700 hover:bg-amber-600" : "bg-emerald-700 hover:bg-emerald-600"
                }`}
                onClick={() =>
                  updateTimer("generalTimer", (t) => {
                    if (t.isActive) return pauseTimer(t);
                    const effective = getEffectiveRemainingTime(t);
                    if (effective <= 0) {
                      const mins = Number.parseInt(minuteInput.generalTimer || "0", 10);
                      if (Number.isFinite(mins) && mins > 0) {
                        return resumeTimer({
                          remainingTime: mins * 60,
                          isActive: false,
                          lastUpdated: Date.now(),
                        });
                      }
                    }
                    return resumeTimer(t);
                  })
                }
              >
                {state.generalTimer.isActive ? "⏸ 일시정지" : "▶ 시작"}
              </button>
              <button type="button" className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600" onClick={() => adjustSeconds("generalTimer", -60)}>
                -1분
              </button>
              <button type="button" className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600" onClick={() => adjustSeconds("generalTimer", 60)}>
                +1분
              </button>
              <button type="button" className="rounded bg-indigo-700 px-2 py-1 text-xs hover:bg-indigo-600" onClick={() => adjustSeconds("generalTimer", 10)}>
                +10초
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <input
                className="w-20 rounded border border-white/10 bg-neutral-950 px-2 py-1"
                inputMode="numeric"
                value={minuteInput.generalTimer}
                onChange={(e) =>
                  setMinuteInput((p) => ({ ...p, generalTimer: e.target.value.replace(/[^\d]/g, "") }))
                }
              />
              <button
                type="button"
                className="rounded bg-indigo-700 px-2 py-1 text-xs"
                onClick={() =>
                  setMinutes(
                    "generalTimer",
                    Number.parseInt(minuteInput.generalTimer || "0", 10) || 0
                  )
                }
              >
                분으로 설정
              </button>
              <label className="flex items-center gap-1 text-neutral-300">
                <input
                  type="checkbox"
                  checked={state.matchTimerEnabled?.general !== false}
                  onChange={(e) => toggleOverlay(e.target.checked)}
                />
                오버레이 사용
              </label>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded bg-neutral-700 px-2 py-1 hover:bg-neutral-600"
                onClick={() => void copyUrl(timerOnlyUrl, "timer-url")}
              >
                {copied === "timer-url" ? "복사됨!" : "OBS URL 복사"}
              </button>
              <button
                type="button"
                className="rounded bg-violet-700 px-2 py-1 hover:bg-violet-600"
                onClick={() => window.open(timerOnlyUrl, "_blank", "noopener,noreferrer")}
              >
                오버레이 열기
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 border-t border-white/10 pt-2">
              <label className="text-xs text-neutral-400">디자인</label>
              <select
                className="rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                value={generalDesign}
                onChange={(e) => updateDisplayStyle({ design: normalizeTimerDesign(e.target.value) })}
              >
                {TIMER_DESIGN_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="flex min-h-[7rem] items-center justify-center rounded border border-white/10 bg-neutral-950/80 p-3">
                {generalDesign === "flip-countdown" ? (
                  <FlipCountdownTimer
                    remainingSeconds={generalEffective}
                    showHours={generalStyle?.showHours}
                    fontSize={24}
                    fontFamily={generalFontId}
                    fontColor={String(generalStyle?.fontColor || "")}
                    bgColor={String(generalStyle?.bgColor || "")}
                    bgOpacity={generalStyle?.bgOpacity}
                  />
                ) : generalDesign === "led-matrix" ? (
                  <LedMatrixTimer
                    remainingSeconds={generalEffective}
                    showHours={generalStyle?.showHours}
                    fontSize={32}
                    fontColor={String(generalStyle?.fontColor || "")}
                    bgColor={String(generalStyle?.bgColor || "")}
                    borderColor={String(generalStyle?.borderColor || "")}
                    bgOpacity={generalStyle?.bgOpacity}
                  />
                ) : isImageFrameTimerDesign(generalDesign) ? (
                  <CircularImageTimer
                    remainingSeconds={generalEffective}
                    showHours={generalStyle?.showHours}
                    design={generalDesign}
                    fontSize={resolveCircularImageTimerFontSize({
                      timerOnlyMode: true,
                      scalePercent: generalStyle?.scalePercent ?? 100,
                    })}
                    fontFamily={generalFontId}
                    fontColor={String(generalStyle?.fontColor || "")}
                  />
                ) : (
                  <span className="text-xl font-bold tabular-nums" style={{ fontFamily: resolveTimerFontFamilyCss(generalFontId) }}>
                    {formatClock(generalEffective)}
                  </span>
                )}
              </div>
              <select
                className="rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                value={generalFontId}
                onFocus={() => ensureTimerGoogleFontsLoaded()}
                onChange={(e) => {
                  ensureTimerGoogleFontsLoaded();
                  updateDisplayStyle({ fontFamily: normalizeTimerFontFamily(e.target.value) });
                }}
              >
                {TIMER_FONT_FAMILY_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <label className="text-[11px] text-neutral-400">
                  글자 색
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="color"
                      className="h-8 w-12 rounded border border-white/10 bg-neutral-900"
                      value={toColorPickerValue(
                        String(generalStyle?.fontColor ?? ""),
                        "#ffffff"
                      )}
                      onChange={(e) => updateDisplayStyle({ fontColor: e.target.value })}
                    />
                    <button
                      type="button"
                      className="rounded bg-neutral-800 px-1.5 py-1 text-[10px] hover:bg-neutral-700"
                      onClick={() => updateDisplayStyle({ fontColor: "" })}
                    >
                      기본
                    </button>
                  </div>
                </label>
                <label className="text-[11px] text-neutral-400">
                  패널 배경
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="color"
                      className="h-8 w-12 rounded border border-white/10 bg-neutral-900"
                      value={toColorPickerValue(String(generalStyle?.bgColor ?? ""), "#000000")}
                      onChange={(e) => updateDisplayStyle({ bgColor: e.target.value })}
                    />
                    <button
                      type="button"
                      className="rounded bg-neutral-800 px-1.5 py-1 text-[10px] hover:bg-neutral-700"
                      onClick={() => updateDisplayStyle({ bgColor: "" })}
                    >
                      기본
                    </button>
                  </div>
                </label>
                <label className="text-[11px] text-neutral-400">
                  테두리 색
                  <div className="mt-1 flex items-center gap-1">
                    <input
                      type="color"
                      className="h-8 w-12 rounded border border-white/10 bg-neutral-900"
                      value={toColorPickerValue(
                        String(generalStyle?.borderColor ?? ""),
                        generalDesign === "led-matrix" ? "#ef4444" : "#c0c0c0"
                      )}
                      onChange={(e) => updateDisplayStyle({ borderColor: e.target.value })}
                    />
                    <button
                      type="button"
                      className="rounded bg-neutral-800 px-1.5 py-1 text-[10px] hover:bg-neutral-700"
                      onClick={() => updateDisplayStyle({ borderColor: "" })}
                    >
                      기본
                    </button>
                  </div>
                </label>
                <label className="text-[11px] text-neutral-400">
                  배경 투명도 {generalStyle?.bgOpacity ?? 40}%
                  <input
                    type="range"
                    min={0}
                    max={100}
                    className="mt-1 w-full"
                    value={generalStyle?.bgOpacity ?? 40}
                    onChange={(e) => updateDisplayStyle({ bgOpacity: Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className="text-[10px] leading-snug text-neutral-500">
                OBS는 <code className="text-neutral-400">host=obs</code> URL을 쓰세요. 예전 주소면 브라우저 소스를 다시 복사해 넣어야 LED·색이 반영됩니다.
              </p>
            </div>
          </section>

          <section className="rounded-lg border border-cyan-500/35 bg-cyan-950/20 p-3 space-y-2">
            <h2 className="text-sm font-semibold text-cyan-100">대전 오버레이 타이머 (matchTimer)</h2>
            <p className="text-[11px] text-neutral-400">
              시그·식사·상류사회 OBS가 사용합니다. 일반 타이머와 별개입니다.
            </p>
            <div className="text-sm tabular-nums">
              남은 {formatClock(matchRem)} ·{" "}
              <span className={matchRunning ? "text-emerald-300" : "text-neutral-400"}>
                {matchRunning ? "진행중" : "대기"}
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-xs text-neutral-400">
                기준 시간(초)
                <input
                  className="mt-1 block w-28 rounded border border-white/10 bg-neutral-950 px-2 py-1.5 text-sm"
                  inputMode="numeric"
                  value={matchDurationSec}
                  onChange={(e) => setMatchDurationSec(e.target.value.replace(/[^\d]/g, ""))}
                  onBlur={() => void saveMatchDuration()}
                />
              </label>
              <button
                type="button"
                className={`rounded px-3 py-1.5 text-xs font-semibold ${
                  matchRunning ? "bg-amber-700 hover:bg-amber-600" : "bg-emerald-700 hover:bg-emerald-600"
                }`}
                onClick={() => (matchRunning ? pauseMatchTimer() : startMatchTimer())}
              >
                {matchRunning ? "일시정지" : "시작"}
              </button>
              <button type="button" className="rounded bg-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-600" onClick={resetMatchTimer}>
                리셋
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AdminPopupShell>
  );
}
