"use client";

import React, { useState, useEffect } from "react";
import type { AppState, Member, ZubZubQueueItem, ZubZubSettings } from "@/types";
import type { ZubzubClaimedEvent } from "@/components/overlay/ZubzubOverlayBanner";

type ZubzubBonusHistoryItem = {
  id: string;
  name: string;
  amount: number;
  memberId: string;
  zubzubQueueId?: string;
  at: number;
};

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

  /** 독립 줍줍 오버레이 배너 크기 배율 (URL `scale` 파라미터용, 저장하지 않는 로컬 값) */
  const [overlayScale, setOverlayScale] = useState("1");
  const zubzubScaleQuery = (() => {
    const n = Number(overlayScale);
    if (!Number.isFinite(n) || n <= 0) return "";
    const clamped = Math.min(4, Math.max(0.5, n));
    if (Math.abs(clamped - 1) < 0.001) return "";
    return `&scale=${clamped}`;
  })();

  // 수동 줍줍 추가 폼 상태
  const [manualSigName, setManualSigName] = useState("");
  const [manualBonusAmount, setManualBonusAmount] = useState("50000");
  const [manualTargetMemberId, setManualTargetMemberId] = useState("");
  const [submittingManual, setSubmittingManual] = useState(false);

  // 대표 멤버 자동 탐색
  const autoRep = (state.members || []).find((m) => {
    const pos = String(state.memberPositions?.[m.id] || "").trim();
    if (pos === "대표") return true;
    if (pos.includes("부대표")) return false;
    return pos.includes("대표");
  });

  const repId = settings.representativeMemberId || autoRep?.id || state.members?.[0]?.id || "";
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

  // 줍줍 대기열에 수동 추가
  const handleManualEnqueue = async () => {
    const sigName = manualSigName.trim() || "대표 줍줍 시그";
    const bonusAmount = Math.max(1000, parseInt(manualBonusAmount, 10) || 50000);

    setSubmittingManual(true);
    try {
      const res = await fetch("/api/zubzub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action: "enqueue_manual",
          sigName,
          bonusAmount,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setManualSigName("");
        await fetchWaitingItems();
        alert(`[${sigName}] +${bonusAmount.toLocaleString()}점이 줍줍 대기열에 등록되었습니다!\n동일한 금액(시그 단가)의 시그를 쏘는 일반 멤버가 획득합니다.`);
      }
    } catch (err) {
      console.error("[ZubzubAdminPanel] manual enqueue error:", err);
    } finally {
      setSubmittingManual(false);
    }
  };

  // 특정 멤버에게 줍줍 직접 수동 지급
  const handleManualDirectClaim = async () => {
    if (!manualTargetMemberId) {
      alert("줍줍을 지급받을 멤버를 선택해주세요.");
      return;
    }
    const targetMember = (state.members || []).find((m) => m.id === manualTargetMemberId);
    const memberName = targetMember?.name || "멤버";
    const sigName = manualSigName.trim() || "대표 줍줍 시그";
    const bonusAmount = Math.max(1000, parseInt(manualBonusAmount, 10) || 50000);

    if (!confirm(`[${memberName}] 멤버에게 [${sigName}] (+${bonusAmount.toLocaleString()}점) 줍줍 보너스를 즉시 지급하시겠습니까?`)) {
      return;
    }

    setSubmittingManual(true);
    try {
      const res = await fetch("/api/zubzub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action: "claim_manual",
          memberId: manualTargetMemberId,
          sigName,
          bonusAmount,
        }),
      });
      const data = await res.json();
      if (data.ok && data.newState) {
        onUpdateState(data.newState);
        setManualSigName("");
        await fetchWaitingItems();
        alert(`[${memberName}] 멤버에게 +${bonusAmount.toLocaleString()}점 줍줍 보너스가 즉시 지급되었습니다.`);
      }
    } catch (err) {
      console.error("[ZubzubAdminPanel] manual claim error:", err);
    } finally {
      setSubmittingManual(false);
    }
  };

  // 이미 획득한 줍줍 보너스 회수/취소
  const handleRevertBonus = async (bonus: ZubzubBonusHistoryItem) => {
    const targetName = bonus.name || "줍줍 보너스";
    const targetAmount = Number(bonus.amount || 0).toLocaleString();
    if (!confirm(`[${targetName}] (+${targetAmount}점) 줍줍 보너스를 회수하고 해당 멤버의 기여도를 차감하시겠습니까?`)) {
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/zubzub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action: "revert_bonus",
          donorId: bonus.id,
          queueId: bonus.zubzubQueueId,
        }),
      });
      const data = await res.json();
      if (data.ok && data.newState) {
        onUpdateState(data.newState);
        await fetchWaitingItems();
        alert(`줍줍 보너스가 정상적으로 회수되었습니다.`);
      }
    } catch (err) {
      console.error("[ZubzubAdminPanel] revert error:", err);
    } finally {
      setLoading(false);
    }
  };

  // 줍줍 보너스는 기여도 로그에서만 조회하고, 구버전 후원 행도 회수 가능하도록 함께 표시한다.
  const zubzubBonusHistory: ZubzubBonusHistoryItem[] = [
    ...(state.contributionLogs || [])
      .filter((log) => log.isZubzubBonus)
      .map((log) => ({
        id: log.id,
        name: log.note || "대표 시그 줍줍",
        amount: Number(log.amount) || 0,
        memberId: log.memberId,
        zubzubQueueId: log.zubzubQueueId,
        at: Number(log.at) || 0,
      })),
    ...(state.donors || [])
      .filter((donor) => donor.isZubzubBonus || donor.id?.startsWith("zubzub_bonus_"))
      .map((donor) => ({
        id: donor.id,
        name: donor.message || donor.name || "대표 시그 줍줍",
        amount: Number(donor.amount) || 0,
        memberId: donor.memberId || "",
        zubzubQueueId: donor.zubzubQueueId,
        at: Number(donor.at) || 0,
      })),
  ];
  const recentZubzubDonors = Array.from(
    new Map(
      zubzubBonusHistory.map((item) => [item.zubzubQueueId || item.id, item] as const)
    ).values()
  )
    .sort((a, b) => a.at - b.at)
    .slice(-10)
    .reverse();

  const [testClaimActive, setTestClaimActive] = useState(false);

  // 테스트 줍줍 성공 알림 발동 (시뮬레이션)
  const triggerTestClaim = async () => {
    const dummyClaim: ZubzubClaimedEvent = {
      type: "zubzub_claimed",
      queueItem: {
        id: `test_${Date.now()}`,
        userId,
        triggerDonationId: "test_trigger",
        sigName: "NO BATIDÃO",
        bonusAmount: 130000,
        status: "CLAIMED",
        createdAt: Date.now(),
      },
      memberId: (state.members && state.members[1]?.id) || "m_test",
      memberName: (state.members && state.members[1]?.name) || "진아",
      bonusAmount: 130000,
      timestamp: Date.now(),
    };

    setTestClaimActive(true);
    setTimeout(() => setTestClaimActive(false), 4000);

    // 1. 브라우저 이벤트 전파
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("zubzub_claimed", { detail: dummyClaim }));
    }

    // 2. 서버 SSE 전파 (OBS 오버레이 연동)
    try {
      await fetch("/api/zubzub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          action: "test_claim",
          event: dummyClaim,
        }),
      });
    } catch {}
  };

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
            대표에게 시그니처가 터지면 대기열에 적재되고, 다음 일반 멤버가 <b>동일한 시그(같은 후원금액)</b>를 쏘면 그 대기 건을 획득해 점수를 복제 지급합니다. (실정산 현금 0원, 랭킹 기여도만 반영)
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

      {/* OBS 오버레이 연동 옵션 & 단독 URL 복사 */}
      <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/20 p-3 space-y-2.5 text-[11px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-neutral-200">
            <span className="text-base">📺</span>
            <div>
              <div className="font-bold text-indigo-300">독립 분리형 줍줍 오버레이 (`/overlay/zubzub`)</div>
              <div className="text-[11px] text-neutral-400">
                OBS 브라우저 소스로 등록하여 원하는 위치에 줍줍 배너를 단독으로 띄울 수 있습니다.
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5" title="독립 줍줍 배너의 크기 배율입니다. URL의 scale 파라미터로 전달되며 0.5~4.0 범위입니다.">
              <span className="text-[11px] text-neutral-400">배너 크기</span>
              <input
                type="number"
                step="0.1"
                min="0.5"
                max="4"
                value={overlayScale}
                onChange={(e) => setOverlayScale(e.target.value)}
                className="w-16 rounded bg-neutral-900 border border-white/10 px-2 py-1 text-[11px] text-white"
              />
              <span className="text-[10px] text-neutral-500">배</span>
            </label>
            <button
              type="button"
              onClick={() => {
                const origin = typeof window !== "undefined" ? window.location.origin : "";
                const url = `${origin}/overlay/zubzub?u=${encodeURIComponent(userId)}&host=obs${zubzubScaleQuery}`;
                navigator.clipboard.writeText(url);
                alert(`독립 줍줍 오버레이 실방송용 URL이 복사되었습니다:\n${url}\n\n* 평소에는 방송 화면을 가리지 않게 투명 대기하며, 대표 시그가 터졌을 때와 멤버가 줍줍 성공 시에만 표출됩니다.`);
              }}
              className="rounded bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-white font-bold text-[11px] shadow-sm flex items-center gap-1 cursor-pointer"
            >
              📋 실방송용 URL 복사
            </button>
            <button
              type="button"
              onClick={() => {
                const origin = typeof window !== "undefined" ? window.location.origin : "";
                const url = `${origin}/overlay/zubzub?u=${encodeURIComponent(userId)}&host=obs&demo=1${zubzubScaleQuery}`;
                navigator.clipboard.writeText(url);
                alert(`OBS 위치/크기 조절용 미리보기 URL이 복사되었습니다:\n${url}\n\n* OBS 브라우저 소스에 넣으면 상시 배너가 표출되어 크기와 위치를 쉽게 맞출 수 있습니다.`);
              }}
              className="rounded bg-amber-600 hover:bg-amber-500 px-3 py-1.5 text-white font-bold text-[11px] shadow-sm flex items-center gap-1 cursor-pointer"
            >
              👁️ OBS 위치 조절용 미리보기 URL 복사
            </button>
            <a
              href={`/overlay/zubzub?u=${encodeURIComponent(userId)}&host=obs&demo=1${zubzubScaleQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded bg-neutral-800 hover:bg-neutral-700 px-2.5 py-1.5 text-neutral-300 border border-white/10 text-[11px] font-medium"
            >
              ↗️ 미리보기 열기
            </a>
          </div>
        </div>

        {/* 항상 줍줍 대기 뱃지 표시 토글 */}
        <label className="flex items-center gap-2 text-neutral-300 cursor-pointer pt-2 border-t border-white/5">
          <input
            type="checkbox"
            className="rounded bg-neutral-900 border-white/20 text-amber-500 focus:ring-0"
            checked={settings.alwaysShowWaiting !== false}
            onChange={(e) => updateSettings({ alwaysShowWaiting: e.target.checked })}
          />
          <span className="font-semibold text-white">🎁 줍줍 대기 뱃지 항상 표시</span>
          <span className="text-neutral-500 text-[10px]">(대기 중인 시그가 없을 때도 방송에 '🎁 대표 줍줍 : 대기 없음' 뱃지를 항상 유지합니다)</span>
        </label>

        {/* 퐁당퐁당 기여도 반영 여부 토글 */}
        <label className="flex items-center gap-2 text-neutral-300 cursor-pointer pt-2 border-t border-white/5">
          <input
            type="checkbox"
            className="rounded bg-neutral-900 border-white/20 text-amber-500 focus:ring-0"
            checked={settings.applyContributionToPongdang !== false}
            onChange={(e) => updateSettings({ applyContributionToPongdang: e.target.checked })}
          />
          <span className="font-semibold text-white">🎪 퐁당퐁당 기여도에도 줍줍 반영</span>
          <span className="text-neutral-500 text-[10px]">(끄면 퐁당퐁당 엑셀표 기여도에서 줍줍 보너스 점수가 제외됩니다)</span>
        </label>
      </div>

      {/* 💡 초간결 1줄 디자인 미리보기 & 테스트 */}
      <div className="rounded-lg border border-amber-500/25 bg-neutral-900/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-bold text-xs text-amber-300 flex items-center gap-1.5">
            <span>✨</span> 간결한 줍줍 오버레이 표시 미리보기 (초간결 1줄 디자인)
          </span>
          <button
            type="button"
            onClick={triggerTestClaim}
            className="rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 px-2.5 py-1 text-[11px] font-bold text-amber-200 transition flex items-center gap-1 cursor-pointer"
            title="방송 화면 및 오버레이에 4초간 줍줍 성공 알림을 시뮬레이션합니다"
          >
            <span>🎉</span> 테스트 성공 알림 발동
          </button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-white/5 bg-black/60 p-2 space-y-1">
            <div className="text-[10px] font-bold text-neutral-400">시그 대기 중 화면</div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/60 bg-neutral-950/85 px-3 py-1 shadow-sm">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/20 text-[10px]">🎁</span>
              <span className="text-[10px] font-bold text-amber-300">대표 줍줍 :</span>
              <span className="text-[11px] font-bold text-white">[NO BATIDÃO]</span>
              <span className="font-mono text-[11px] font-black text-emerald-400">+130,000</span>
            </div>
          </div>
          <div className="rounded border border-white/5 bg-black/60 p-2 space-y-1">
            <div className="text-[10px] font-bold text-neutral-400">대기 없을 때 (항상 표시)</div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/40 bg-neutral-950/80 px-3 py-1 shadow-sm">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-500/15 text-[10px]">🎁</span>
              <span className="text-[10px] font-bold text-amber-300/90">대표 줍줍 :</span>
              <span className="text-[11px] font-semibold text-neutral-400">대기 없음</span>
            </div>
          </div>
          <div className="rounded border border-white/5 bg-black/60 p-2 space-y-1">
            <div className="text-[10px] font-bold text-neutral-400">성공 알림 화면 (4초)</div>
            <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/80 bg-neutral-950/90 px-3 py-1 shadow-sm">
              <span className="text-xs">🎉</span>
              <span className="text-[11px] font-black text-amber-300">진아</span>
              <span className="text-[11px] font-bold text-white">줍줍 성공!</span>
              <span className="text-[10px] font-bold text-neutral-300">[NO BATIDÃO]</span>
              <span className="font-mono text-[11px] font-black text-emerald-400">+130,000</span>
            </div>
          </div>
        </div>
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

      {/* 3. 줍줍 수동 추가 및 멤버 직접 지급 카드 */}
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-3 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-300">
            <span>✨</span>
            <span>줍줍 수동 추가 및 멤버 직접 지급</span>
          </div>
          <span className="text-[10px] text-neutral-400">
            대표 후원 없이도 대기열을 바로 생성하거나, 특정 멤버에게 보너스를 즉시 줄 수 있습니다.
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 text-xs">
          {/* 시그니처 이름 (직접 입력 또는 인벤토리 선택) */}
          <div className="md:col-span-4 space-y-1">
            <label className="text-[10px] font-semibold text-neutral-300 flex justify-between">
              <span>시그니처명</span>
              {(state.sigInventory || []).length > 0 && (
                <span className="text-[10px] text-emerald-400 font-normal">인벤토리 연동 가능</span>
              )}
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                list="zubzub-sig-inventory-list"
                value={manualSigName}
                onChange={(e) => {
                  const val = e.target.value;
                  setManualSigName(val);
                  const matched = (state.sigInventory || []).find((s) => s.name === val);
                  if (matched && matched.price) {
                    setManualBonusAmount(String(matched.price));
                  }
                }}
                placeholder="예: NO BATIDÃO / 시그A"
                className="w-full rounded bg-neutral-900 border border-white/10 px-2 py-1.5 text-xs text-white placeholder-neutral-500"
              />
              <datalist id="zubzub-sig-inventory-list">
                {(state.sigInventory || []).map((s, idx) => (
                  <option key={`${s.name}_${idx}`} value={s.name}>
                    {Number(s.price || 0).toLocaleString()}원
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          {/* 보너스 점수 (금액) */}
          <div className="md:col-span-3 space-y-1">
            <label className="text-[10px] font-semibold text-neutral-300">
              보너스 점수 (금액)
            </label>
            <input
              type="number"
              step="10000"
              value={manualBonusAmount}
              onChange={(e) => setManualBonusAmount(e.target.value)}
              placeholder="50000"
              className="w-full rounded bg-neutral-900 border border-white/10 px-2 py-1.5 text-xs text-white"
            />
          </div>

          {/* 직접 지급 대상 멤버 (선택 사항) */}
          <div className="md:col-span-5 space-y-1">
            <label className="text-[10px] font-semibold text-neutral-300">
              실행 방식 선택
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={submittingManual}
                onClick={handleManualEnqueue}
                className="flex-1 rounded bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition disabled:opacity-50 cursor-pointer"
                title="동일한 금액(시그 단가)의 시그를 쏘는 일반 멤버가 가져갈 수 있도록 줍줍 대기열에 추가합니다"
              >
                ➕ 대기열에 추가
              </button>

              <div className="flex items-center gap-1">
                <select
                  value={manualTargetMemberId}
                  onChange={(e) => setManualTargetMemberId(e.target.value)}
                  className="rounded bg-neutral-900 border border-white/10 px-2 py-1.5 text-[11px] text-white"
                >
                  <option value="">멤버 선택(직접 지급)</option>
                  {(state.members || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={submittingManual || !manualTargetMemberId}
                  onClick={handleManualDirectClaim}
                  className="rounded bg-emerald-600 hover:bg-emerald-500 px-2.5 py-1.5 text-[11px] font-bold text-white shadow-sm transition disabled:opacity-50 cursor-pointer"
                  title="선택한 멤버에게 줍줍 보너스를 즉시 지급합니다"
                >
                  🎁 즉시 지급
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4. 실시간 대기 큐 모니터링 카드 */}
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
                    <span className="text-neutral-200">{d.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-amber-300 font-semibold">
                      +{d.amount.toLocaleString()}점
                    </div>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleRevertBonus(d)}
                      className="rounded bg-rose-950/40 hover:bg-rose-900/60 border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-300 transition-colors cursor-pointer"
                      title="이 줍줍 보너스를 회수하고 해당 멤버의 기여도를 차감합니다"
                    >
                      회수/삭제
                    </button>
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
