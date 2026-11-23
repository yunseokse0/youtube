"use client";

import React, { useState, useEffect } from "react";
import type { AppState, Member, ZubZubQueueItem, ZubZubSettings } from "@/types";

type Props = {
  state: AppState;
  onUpdateState: (next: AppState) => void;
  userId: string;
};

export function ZubzubAdminPanel({ state, onUpdateState, userId }: Props) {
  const settings: ZubZubSettings = state.zubzubSettings || {
    enabled: false,
    minSigPrice: 50000,
    priorityMode: "fifo",
  };

  const [loading, setLoading] = useState(false);
  const [waitingItems, setWaitingItems] = useState<ZubZubQueueItem[]>(
    state.zubzubWaitingItems || []
  );
  const [minPriceDraft, setMinPriceDraft] = useState(String(settings.minSigPrice || 50000));

  // 대표 멤버 자동 탐색
  const autoRep = (state.members || []).find((m) => {
    const pos = String(state.memberPositions?.[m.id] || "").trim();
    if (pos === "대표") return true;
    if (pos.includes("부대표")) return false;
    return pos.includes("대표");
  });

  const repId = settings.representativeMemberId || autoRep?.id || "";
  const repName = (state.members || []).find((m) => m.id === repId)?.name || "대표 미지정";

  // 대기열 목록 불러오기
  const fetchWaitingItems = async () => {
    if (!userId) return;
    try {
      const res = await fetch(`/api/zubzub?u=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.ok && Array.isArray(data.waitingItems)) {
        setWaitingItems(data.waitingItems);
      }
    } catch (err) {
      console.error("[ZubzubAdminPanel] fetch error:", err);
    }
  };

  useEffect(() => {
    fetchWaitingItems();
    // 10초 주기 폴링 (SSE 미수신 시 보조)
    const interval = setInterval(fetchWaitingItems, 10000);
    return () => clearInterval(interval);
  }, [userId]);

  // 설정 저장
  const updateSettings = async (patch: Partial<ZubZubSettings>) => {
    const nextSettings: ZubZubSettings = {
      ...settings,
      ...patch,
    };
    const nextState: AppState = {
      ...state,
      zubzubSettings: nextSettings,
    };
    onUpdateState(nextState);

    try {
      await fetch("/api/zubzub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action: "update_settings",
          ...nextSettings,
        }),
      });
    } catch (err) {
      console.error("[ZubzubAdminPanel] update error:", err);
    }
  };

  // 단건 취소
  const handleCancelItem = async (queueId: string) => {
    if (!confirm("이 줍줍 대기열을 취소하시겠습니까?")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/zubzub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action: "cancel",
          queueId,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        await fetchWaitingItems();
      }
    } catch (err) {
      console.error("[ZubzubAdminPanel] cancel error:", err);
    } finally {
      setLoading(false);
    }
  };

  // 전체 취소
  const handleCancelAll = async () => {
    if (!confirm("현재 대기 중인 모든 줍줍 대기열을 취소하시겠습니까?")) return;
    setLoading(true);
    try {
      const res = await fetch("/api/zubzub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action: "cancel_all",
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setWaitingItems([]);
      }
    } catch (err) {
      console.error("[ZubzubAdminPanel] cancel all error:", err);
    } finally {
      setLoading(false);
    }
  };

  // 최근 줍줍 보너스를 획득한 후원 목록 (donors 에서 isZubzubBonus=true 인 최근 10건)
  const recentZubzubDonors = (state.donors || [])
    .filter((d) => d.isZubzubBonus || d.id?.startsWith("zubzub_bonus_"))
    .slice(-10)
    .reverse();

  return (
    <div className="space-y-4 text-xs text-neutral-300">
      {/* 1. 상단 마스터 스위치 및 상태 배지 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-neutral-900/80 p-3">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-white">🎁 대표 시그 줍줍 엔진</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                settings.enabled
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                  : "bg-neutral-800 text-neutral-400 border border-neutral-700"
              }`}
            >
              {settings.enabled ? "● 줍줍 활성화 (무제한 대기)" : "○ 비활성화"}
            </span>
          </div>
          <p className="text-[11px] text-neutral-400">
            대표에게 시그니처가 터지면 대기열에 적재되고, 다음 일반 멤버에게 시그가 터지면 점수를 그대로 복제 지급합니다. (실정산 현금 0원, 랭킹 기여도만 반영)
          </p>
        </div>

        <button
          type="button"
          onClick={() => updateSettings({ enabled: !settings.enabled })}
          className={`rounded-lg px-4 py-2 font-bold text-xs transition-colors shadow-sm ${
            settings.enabled
              ? "bg-emerald-600 hover:bg-emerald-500 text-white"
              : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-white/10"
          }`}
        >
          {settings.enabled ? "기능 끄기 (OFF)" : "기능 켜기 (ON)"}
        </button>
      </div>

      {/* 2. 세부 설정 그리드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-lg border border-white/10 bg-neutral-950/40 p-3">
        {/* 대표 멤버 선택 */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-neutral-400">
            👑 발동 기준 대표 멤버
          </label>
          <select
            className="w-full rounded bg-neutral-900 border border-white/10 px-2.5 py-1.5 text-xs text-white"
            value={settings.representativeMemberId || ""}
            onChange={(e) =>
              updateSettings({
                representativeMemberId: e.target.value || undefined,
              })
            }
          >
            <option value="">자동 판정 ({autoRep ? `${autoRep.name} 대표` : "대표 없음"})</option>
            {(state.members || []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.id === autoRep?.id ? "(직급 대표)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* 최소 발동 시그 금액 */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-neutral-400">
            💰 최소 발동 시그 금액 (원)
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              step="10000"
              className="w-full rounded bg-neutral-900 border border-white/10 px-2.5 py-1.5 text-xs text-white"
              value={minPriceDraft}
              onChange={(e) => setMinPriceDraft(e.target.value)}
              onBlur={() => {
                const val = Math.max(0, parseInt(minPriceDraft, 10) || 0);
                updateSettings({ minSigPrice: val });
              }}
              placeholder="50000"
            />
            <button
              type="button"
              onClick={() => {
                const val = Math.max(0, parseInt(minPriceDraft, 10) || 0);
                updateSettings({ minSigPrice: val });
              }}
              className="rounded bg-neutral-800 hover:bg-neutral-700 px-3 text-neutral-200 border border-white/10"
            >
              적용
            </button>
          </div>
        </div>

        {/* 우선순위 모드 */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-neutral-400">
            ⚡ 줍줍 배정 우선순위
          </label>
          <select
            className="w-full rounded bg-neutral-900 border border-white/10 px-2.5 py-1.5 text-xs text-white"
            value={settings.priorityMode || "fifo"}
            onChange={(e) =>
              updateSettings({
                priorityMode: e.target.value === "highest" ? "highest" : "fifo",
              })
            }
          >
            <option value="fifo">선착순 (먼저 터진 멤버 시그 우선)</option>
            <option value="highest">금액 우선 (동시 유입 시 고액 시그 우선)</option>
          </select>
        </div>
      </div>

      {/* 3. 실시간 대기 큐 모니터링 카드 */}
      <div className="rounded-lg border border-indigo-500/20 bg-indigo-950/10 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-indigo-300">
              🚨 현재 대기 중인 대표 시그 ({waitingItems.length}건)
            </span>
            {waitingItems.length > 0 && (
              <span className="animate-pulse rounded-full bg-rose-500/20 border border-rose-500/40 px-2 py-0.5 text-[10px] text-rose-300 font-bold">
                선착순 줍줍 진행 중!
              </span>
            )}
          </div>
          {waitingItems.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={handleCancelAll}
              className="rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 px-2.5 py-1 text-[11px] text-rose-300 transition-colors"
            >
              대기열 전체 비우기
            </button>
          )}
        </div>

        {waitingItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-neutral-900/40 p-4 text-center text-xs text-neutral-500">
            현재 대기 중인 대표 시그가 없습니다.
            <br />
            대표({repName})에게 최소 {Number(settings.minSigPrice || 50000).toLocaleString()}원 이상의 시그니처가 터지면 자동으로 여기에 적재됩니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {waitingItems.map((item, idx) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-indigo-500/30 bg-neutral-900/90 p-2.5 shadow-sm"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600/30 text-indigo-300 font-black text-xs">
                    #{idx + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-bold text-xs text-white">
                      {item.sigName}
                    </div>
                    <div className="text-[11px] font-semibold text-amber-400">
                      +{item.bonusAmount.toLocaleString()}점 복제 대기
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleCancelItem(item.id)}
                  className="rounded bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1 text-[11px] text-neutral-300 border border-white/10 flex-shrink-0"
                >
                  취소
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. 최근 줍줍 성공 이력 */}
      {recentZubzubDonors.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-2">
          <div className="font-semibold text-xs text-neutral-300 flex items-center justify-between">
            <span>🎉 최근 줍줍 성공 내역</span>
            <span className="text-[10px] text-neutral-500">최근 {recentZubzubDonors.length}건</span>
          </div>

          <div className="divide-y divide-white/5">
            {recentZubzubDonors.map((d) => {
              const m = (state.members || []).find((mem) => mem.id === d.memberId);
              return (
                <div key={d.id} className="py-1.5 flex items-center justify-between text-[11px]">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-emerald-400">[{m?.name || "멤버"}]</span>
                    <span className="text-neutral-200">{d.message || d.name}</span>
                  </div>
                  <div className="font-mono text-amber-300 font-semibold">
                    +{d.amount.toLocaleString()}점
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
