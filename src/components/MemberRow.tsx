"use client";
import { Member, formatManThousand } from "@/lib/state";
import { useEffect, useRef, useState } from "react";

type Props = {
  member: Member;
  onChange: (next: Member) => void;
  onRename?: (id: string, name: string) => void;
  onReset?: (id: string) => void;
  onDelete?: (id: string) => void;
  onRestroomAdjust?: (id: string, delta: 1 | -1, amount?: number) => void;
  onRestroomSet?: (id: string, value: number) => void;
  donationLinkActive?: boolean | null;
  onToggleDonationLink?: () => void;
};

export default function MemberRow({
  member,
  onChange,
  onRename,
  onReset,
  onDelete,
  onRestroomAdjust,
  onRestroomSet,
  donationLinkActive = null,
  onToggleDonationLink,
}: Props) {
  const [localRestroom, setLocalRestroom] = useState(String(Math.max(0, member.restroom || 0)));
  const [localGoal, setLocalGoal] = useState(member.goal ? String(member.goal) : "");
  const [localName, setLocalName] = useState(member.name);
  const prevAccount = useRef(member.account);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    setLocalRestroom(String(Math.max(0, member.restroom || 0)));
    setLocalGoal(member.goal ? String(member.goal) : "");
    setLocalName(member.name);
  }, [member.restroom, member.goal, member.name]);

  useEffect(() => {
    if (member.account > prevAccount.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 800);
      return () => clearTimeout(t);
    }
    prevAccount.current = member.account;
  }, [member.account]);

  const commitGoal = (val: string) => {
    const cleaned = (val || "").replace(/[^\d]/g, "");
    const parsed = parseInt(cleaned || "0", 10);
    const nextGoal = isNaN(parsed) ? 0 : Math.max(0, parsed);
    if (nextGoal >= 100_000_000) {
      const ok = typeof window !== "undefined" ? window.confirm("목표 금액이 1억 이상입니다. 계속할까요?") : false;
      if (!ok) {
        setLocalGoal(member.goal ? String(member.goal) : "");
        return;
      }
    }
    onChange({ ...member, goal: nextGoal > 0 ? nextGoal : undefined });
  };

  const adjustRestroom = (delta: 1 | -1, amount = 1) => {
    if (onRestroomAdjust) {
      onRestroomAdjust(member.id, delta, amount);
      return;
    }
    const curr = Math.max(0, member.restroom || 0);
    const nextRestroom = delta > 0 ? curr + amount : Math.max(0, curr - amount);
    onChange({ ...member, restroom: nextRestroom });
  };

  const commitRestroom = (val: string) => {
    const cleaned = (val || "").replace(/[^\d]/g, "");
    const parsed = parseInt(cleaned === "" ? "0" : cleaned, 10);
    const nextRestroom = isNaN(parsed) ? 0 : Math.max(0, parsed);
    const curr = Math.max(0, member.restroom || 0);
    setLocalRestroom(String(nextRestroom));
    if (nextRestroom === curr) return;
    if (onRestroomSet) {
      onRestroomSet(member.id, nextRestroom);
      return;
    }
    if (onRestroomAdjust) {
      if (nextRestroom > curr) onRestroomAdjust(member.id, 1, nextRestroom - curr);
      else onRestroomAdjust(member.id, -1, curr - nextRestroom);
      return;
    }
    onChange({ ...member, restroom: nextRestroom });
  };

  return (
    <div className="h-full rounded-xl border border-white/10 bg-neutral-900/60 p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2">
        <div className="grid grid-cols-1 gap-2">
          <input
            className="w-full px-3 py-2 rounded bg-neutral-800/80 border border-white/10 font-semibold"
            value={localName}
            onChange={(e) => setLocalName(e.target.value)}
            onBlur={() => onRename?.(member.id, (localName || "무명").trim())}
            placeholder="멤버 이름"
          />
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <input
            className="w-full px-3 py-2 rounded bg-neutral-800/80 border border-white/10"
            inputMode="numeric"
            value={localGoal}
            onChange={(e) => setLocalGoal(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => commitGoal(localGoal)}
            placeholder="목표(원)"
            title="개인 목표 금액(원)"
          />
          <label
            className="px-3 py-2 rounded bg-neutral-800/70 border border-white/10 flex items-center gap-2 text-xs text-neutral-300"
            title="체크 시 랭크에서 제외되고 표 하단에 고정 표시됩니다."
          >
            <input
              type="checkbox"
              checked={!!member.operating}
              onChange={(e) => onChange({ ...member, operating: e.target.checked })}
            />
            운영비
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2 space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-neutral-400">계좌</label>
          <div
            className={`w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right text-sm text-neutral-200 ${
              flash ? "animate-flashGold" : ""
            }`}
            title="후원 동기화 금액(수동 차감/증액 없음)"
          >
            {formatManThousand(member.account)}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs text-neutral-400">투네</label>
          <div
            className="w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right text-sm text-neutral-200"
            title="후원 동기화 금액(수동 차감/증액 없음)"
          >
            {formatManThousand(member.toon)}
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="text-xs text-neutral-400">기여도</label>
          <div className="w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right text-sm text-neutral-200">
            {formatManThousand(Math.max(0, Number(member.contribution) || 0))}
          </div>
        </div>
        <p className="text-[10px] text-neutral-500">계좌·투네·기여도는 후원 동기화로만 반영됩니다.</p>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-neutral-400">후원 연동(식대전)</label>
          {donationLinkActive === null ? (
            <span className="text-[11px] text-neutral-500">식대전 미참가</span>
          ) : (
            <button
              type="button"
              onClick={onToggleDonationLink}
              className={`px-2 py-1 rounded text-xs font-semibold ${
                donationLinkActive
                  ? "bg-amber-700 hover:bg-amber-600 text-white"
                  : "bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
              }`}
            >
              후원 연동 {donationLinkActive ? "ON" : "OFF"}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-neutral-400">화장실</label>
          <input
            className="w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right focus:outline-none"
            inputMode="numeric"
            value={localRestroom}
            onChange={(e) => setLocalRestroom(e.target.value.replace(/[^\d]/g, ""))}
            onBlur={() => commitRestroom(localRestroom)}
            placeholder="0"
            title="엑셀표 화장실 열 횟수 (수동 기록)"
          />
        </div>
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => adjustRestroom(1, 1)}
            className="px-2 py-1 rounded-full bg-cyan-900/80 hover:bg-cyan-800 text-xs"
          >
            +1
          </button>
          <button
            type="button"
            onClick={() => adjustRestroom(-1, 1)}
            className="px-2 py-1 rounded-full bg-rose-900/80 hover:bg-rose-800 text-xs"
          >
            -1
          </button>
          <button
            type="button"
            onClick={() => adjustRestroom(1, 5)}
            className="px-2 py-1 rounded-full bg-cyan-900/80 hover:bg-cyan-800 text-xs"
          >
            +5
          </button>
          <button
            type="button"
            onClick={() => adjustRestroom(-1, 5)}
            className="px-2 py-1 rounded-full bg-rose-900/80 hover:bg-rose-800 text-xs"
          >
            -5
          </button>
        </div>
      </div>

      <div className="mt-auto pt-1 flex items-center justify-between">
        <div className="text-xs text-neutral-400">
          표시:
          <span className="ml-1 font-mono text-neutral-200">
            {formatManThousand(member.account)}(
            <span className="text-neutral-300">{formatManThousand(member.toon)}</span>) / 기여도{" "}
            {formatManThousand((member.account || 0) + (member.toon || 0))}
            <span className="text-neutral-500 mx-1">·</span>
            화장실 {Math.max(0, member.restroom || 0)}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onReset?.(member.id)}
            className="px-3 py-1.5 bg-neutral-800 rounded-lg hover:bg-neutral-700 text-xs"
            title="계좌/투네/기여도/화장실 0으로 리셋"
          >
            리셋
          </button>
          <button
            type="button"
            onClick={() => onDelete?.(member.id)}
            className="px-3 py-1.5 bg-red-700 rounded-lg hover:bg-red-600 text-xs"
            title="멤버 삭제"
          >
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
