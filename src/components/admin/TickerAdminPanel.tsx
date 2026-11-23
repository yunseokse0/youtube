"use client";

import React, { useState } from "react";
import type { AppState, TickerSettings } from "@/types";
import { MarqueeTickerOverlay } from "@/components/overlay/MarqueeTickerOverlay";

type Props = {
  state: AppState;
  onUpdateState: (next: AppState) => void;
  userId: string;
};

export function TickerAdminPanel({ state, onUpdateState, userId }: Props) {
  const settings: TickerSettings = state.tickerSettings || {
    enabled: true,
    badgeText: "NOTICE",
    badgeBgColor: "#dc2626",
    badgeTextColor: "#ffffff",
    text: "✦ 첫만남은 어려워 30500원 ✦ 매드레이디 40200 ✦ 매드쉐이크 40300 ✦ 팬서비스 40700 ✦ 나의N이되어줘 50700 ✦ 다시여기바닷가 70700 ✦ 캐치캐치 95900 ✦ 하나뿐인매드 150400 ✦ 슈퍼매드신호탄 1001300",
    speedSec: 35,
    fontSizePx: 14,
    textColor: "#ffffff",
    bgColor: "rgba(10, 10, 10, 0.85)",
  };

  const [badgeText, setBadgeText] = useState(settings.badgeText);
  const [badgeBgColor, setBadgeBgColor] = useState(settings.badgeBgColor || "#dc2626");
  const [text, setText] = useState(settings.text);
  const [speedSec, setSpeedSec] = useState(settings.speedSec || 35);
  const [fontSizePx, setFontSizePx] = useState(settings.fontSizePx || 14);

  const updateSettings = (patch: Partial<TickerSettings>) => {
    const nextSettings: TickerSettings = {
      ...settings,
      ...patch,
    };
    const nextState: AppState = {
      ...state,
      tickerSettings: nextSettings,
    };
    onUpdateState(nextState);
  };

  // 현재 등록된 시그니처 목록에서 텍스트 자동 채우기
  const handleAutoFillFromSigs = () => {
    const inv = state.sigInventory || [];
    if (inv.length === 0) {
      alert("현재 등록된 시그니처가 없습니다. 시그 판매 관리에서 시그니처를 먼저 등록해주세요.");
      return;
    }
    const formatted = inv
      .map((s) => `✦ ${s.name} ${Number(s.price || 0).toLocaleString()}원`)
      .join(" ");
    setText(formatted);
    updateSettings({ text: formatted });
  };

  return (
    <div className="space-y-4 text-xs text-neutral-300">
      {/* 1. 상단 마스터 스위치 및 OBS 링크 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-900/80 p-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-white">📢 하단 횡스크롤 전광판 (Marquee Ticker)</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                settings.enabled
                  ? "bg-red-500/20 text-red-300 border border-red-500/30"
                  : "bg-neutral-800 text-neutral-400 border border-neutral-700"
              }`}
            >
              {settings.enabled ? "● 전광판 활성화" : "○ 비활성화"}
            </span>
          </div>
          <p className="text-[11px] text-neutral-400">
            방송 화면 최하단에 좌측 고정 배지([NOTICE])와 함께 우측에서 좌측으로 끊김 없이 흐르는 티커를 송출합니다.
          </p>
        </div>

        <button
          type="button"
          onClick={() => updateSettings({ enabled: !settings.enabled })}
          className={`rounded-lg px-4 py-2 font-bold text-xs transition-colors shadow-sm ${
            settings.enabled
              ? "bg-red-600 hover:bg-red-500 text-white"
              : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/10"
          }`}
        >
          {settings.enabled ? "전광판 끄기 (OFF)" : "전광판 켜기 (ON)"}
        </button>
      </div>

      {/* OBS 오버레이 링크 */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-950/20 px-3 py-2.5 text-[11px]">
        <div className="flex items-center gap-2 text-neutral-200">
          <span className="text-base">📺</span>
          <div>
            <div className="font-bold text-red-300">전광판 오버레이 (`/overlay/ticker`)</div>
            <div className="text-[11px] text-neutral-400">
              OBS 브라우저 소스(권장 너비 1920, 높이 60~80)로 추가하여 화면 최하단에 배치하세요.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const origin = typeof window !== "undefined" ? window.location.origin : "";
              const url = `${origin}/overlay/ticker?u=${encodeURIComponent(userId)}&host=obs`;
              navigator.clipboard.writeText(url);
              alert(`전광판 오버레이 URL이 복사되었습니다:\n${url}`);
            }}
            className="rounded bg-red-600 hover:bg-red-500 px-3 py-1.5 text-white font-bold text-[11px] shadow-sm flex items-center gap-1"
          >
            📋 오버레이 URL 복사
          </button>
          <a
            href={`/overlay/ticker?u=${encodeURIComponent(userId)}&host=obs`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1.5 text-neutral-300 border border-white/10 text-[11px] font-medium"
          >
            ↗️ 오버레이 열기
          </a>
        </div>
      </div>

      {/* 2. 세부 설정 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border border-white/10 bg-neutral-950/40 p-3">
        {/* 배지 설정 */}
        <div className="space-y-2">
          <label className="text-[11px] font-medium text-neutral-400">
            🏷️ 좌측 고정 배지 문구 & 색상
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              className="w-full rounded bg-neutral-900 border border-white/10 px-2.5 py-1.5 text-xs text-white"
              value={badgeText}
              onChange={(e) => setBadgeText(e.target.value)}
              onBlur={() => updateSettings({ badgeText })}
              placeholder="NOTICE"
            />
            <input
              type="color"
              className="h-8 w-10 rounded border border-white/10 bg-neutral-900 p-0.5 cursor-pointer"
              value={badgeBgColor}
              onChange={(e) => {
                setBadgeBgColor(e.target.value);
                updateSettings({ badgeBgColor: e.target.value });
              }}
              title="배지 배경색 선택"
            />
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {["NOTICE", "공지사항", "시그안내", "출근전쟁", "방송규칙"].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => {
                  setBadgeText(preset);
                  updateSettings({ badgeText: preset });
                }}
                className="rounded bg-neutral-900 hover:bg-neutral-800 px-2 py-0.5 text-[10px] text-neutral-300 border border-white/10"
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* 스크롤 속도 및 글자 크기 */}
        <div className="space-y-2">
          <div className="flex justify-between text-[11px] text-neutral-400">
            <span>⚡ 롤링 속도 (한 바퀴 도는 시간)</span>
            <span className="font-mono text-amber-400 font-bold">{speedSec}초 ({speedSec <= 20 ? "빠름" : speedSec <= 40 ? "보통" : "느림"})</span>
          </div>
          <input
            type="range"
            min="10"
            max="90"
            step="5"
            className="w-full cursor-pointer accent-red-500"
            value={speedSec}
            onChange={(e) => {
              const val = Number(e.target.value);
              setSpeedSec(val);
              updateSettings({ speedSec: val });
            }}
          />

          <div className="flex justify-between text-[11px] text-neutral-400 pt-1">
            <span>🔤 글자 크기</span>
            <span className="font-mono text-amber-400 font-bold">{fontSizePx}px</span>
          </div>
          <input
            type="range"
            min="11"
            max="24"
            step="1"
            className="w-full cursor-pointer accent-red-500"
            value={fontSizePx}
            onChange={(e) => {
              const val = Number(e.target.value);
              setFontSizePx(val);
              updateSettings({ fontSizePx: val });
            }}
          />
        </div>
      </div>

      {/* 3. 티커 본문 텍스트 편집 & 자동 생성 버튼 */}
      <div className="rounded-lg border border-white/10 bg-neutral-950/40 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium text-neutral-400">
            📝 전광판 본문 문구 (우측에서 좌측으로 흐를 내용)
          </label>
          <button
            type="button"
            onClick={handleAutoFillFromSigs}
            className="rounded bg-indigo-600 hover:bg-indigo-500 px-2.5 py-1 text-[11px] text-white font-bold flex items-center gap-1 shadow-sm"
          >
            🪄 시그 목록에서 자동 채우기
          </button>
        </div>

        <textarea
          rows={3}
          className="w-full rounded bg-neutral-900 border border-white/10 p-2.5 text-xs text-white placeholder-neutral-500 focus:outline-none focus:border-red-500"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => updateSettings({ text })}
          placeholder="✦ 시그니처 1 30000원 ✦ 시그니처 2 50000원 ✦ 후원 감사드립니다 ✦ ..."
        />
      </div>

      {/* 4. 실시간 미리보기 (Admin Live Preview) */}
      <div className="rounded-lg border border-white/10 bg-neutral-900/60 p-3 space-y-2">
        <div className="text-[11px] font-semibold text-neutral-400 flex items-center justify-between">
          <span>👀 전광판 실시간 미리보기</span>
          <span className="text-[10px] text-neutral-500">실제 오버레이 송출 화면과 동일</span>
        </div>
        <div className="relative h-12 w-full rounded-md border border-white/10 bg-neutral-950 overflow-hidden">
          <MarqueeTickerOverlay
            settings={{
              enabled: true,
              badgeText,
              badgeBgColor,
              badgeTextColor: "#ffffff",
              text,
              speedSec,
              fontSizePx,
              textColor: "#ffffff",
              bgColor: "rgba(10, 10, 10, 0.95)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
