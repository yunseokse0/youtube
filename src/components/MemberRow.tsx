"use client";
import { Member, parseTenThousandThousand, confirmHighAmount, maskTenThousandThousandInput, formatManThousand } from "@/lib/state";
import { useEffect, useRef, useState } from "react";

type Props = {
  member: Member;
  onChange: (next: Member) => void;
  onRename?: (id: string, name: string) => void;
  onReset?: (id: string) => void;
  onDelete?: (id: string) => void;
  donationLinkActive?: boolean | null;
  onToggleDonationLink?: () => void;
};

export default function MemberRow({
  member,
  onChange,
  onRename,
  onReset,
  onDelete,
  donationLinkActive = null,
  onToggleDonationLink,
}: Props) {
  const [localAccount, setLocalAccount] = useState(formatManThousand(member.account));
  const [localToon, setLocalToon] = useState(formatManThousand(member.toon));
  const [localGoal, setLocalGoal] = useState(member.goal ? String(member.goal) : "");
  const [localName, setLocalName] = useState(member.name);
  const prevAccount = useRef(member.account);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    setLocalAccount(formatManThousand(member.account));
    setLocalToon(formatManThousand(member.toon));
    setLocalGoal(member.goal ? String(member.goal) : "");
    setLocalName(member.name);
  }, [member.account, member.toon, member.goal, member.name]);

  useEffect(() => {
    if (member.account > prevAccount.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 800);
      return () => clearTimeout(t);
    }
    prevAccount.current = member.account;
  }, [member.account]);

  const commitAccount = (val: string) => {
    const amt = parseTenThousandThousand(val);
    if (!confirmHighAmount(amt)) return;
    onChange({ ...member, account: amt, contribution: amt + (member.toon || 0) });
  };
  const commitToon = (val: string) => {
    const amt = parseTenThousandThousand(val);
    onChange({ ...member, toon: amt, contribution: (member.account || 0) + amt });
  };
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
  const adjust = (field: "account" | "toon", delta: number) => {
    const nextVal = Math.max(0, (member as any)[field] + delta);
    if (field === "account" && !confirmHighAmount(nextVal)) return;
    const nextAccount = field === "account" ? nextVal : (member.account || 0);
    const nextToon = field === "toon" ? nextVal : (member.toon || 0);
    onChange({ ...member, [field]: nextVal, contribution: nextAccount + nextToon } as Member);
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
          <label className="px-3 py-2 rounded bg-neutral-800/70 border border-white/10 flex items-center gap-2 text-xs text-neutral-300" title="체크 시 랭크에서 제외되고 표 하단에 고정 표시됩니다.">
            <input
              type="checkbox"
              checked={!!member.operating}
              onChange={(e) => onChange({ ...member, operating: e.target.checked })}
            />
            운영비
          </label>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-neutral-400">계좌</label>
          <input
            className={`w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right focus:outline-none ${flash ? "animate-flashGold" : ""}`}
            inputMode="decimal"
            value={localAccount}
            onChange={(e) => setLocalAccount(maskTenThousandThousandInput(e.target.value))}
            onBlur={() => commitAccount(localAccount)}
            placeholder="3.5"
          />
        </div>
        <div className="grid grid-cols-4 gap-1">
          <button onClick={() => adjust("account", 1000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">+1천</button>
          <button onClick={() => adjust("account", -1000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">-1천</button>
          <button onClick={() => adjust("account", 10000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">+1만</button>
          <button onClick={() => adjust("account", -10000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">-1만</button>
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-neutral-400">기여도(자동)</label>
          <div className="w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right text-sm text-neutral-200">
            {formatManThousand((member.account || 0) + (member.toon || 0))}
          </div>
        </div>
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
                donationLinkActive ? "bg-amber-700 hover:bg-amber-600 text-white" : "bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
              }`}
            >
              후원 연동 {donationLinkActive ? "ON" : "OFF"}
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2">
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs text-neutral-400">투네</label>
          <input
            className="w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right focus:outline-none"
            inputMode="decimal"
            value={localToon}
            onChange={(e) => setLocalToon(maskTenThousandThousandInput(e.target.value))}
            onBlur={() => commitToon(localToon)}
            placeholder="1.2"
          />
        </div>
        <div className="grid grid-cols-4 gap-1">
          <button onClick={() => adjust("toon", 1000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">+1천</button>
          <button onClick={() => adjust("toon", -1000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">-1천</button>
          <button onClick={() => adjust("toon", 10000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">+1만</button>
          <button onClick={() => adjust("toon", -10000)} className="px-2 py-1 rounded-full bg-neutral-800 hover:bg-neutral-700 text-xs">-1만</button>
        </div>
      </div>

      <div className="mt-auto pt-1 flex items-center justify-between">
        <div className="text-xs text-neutral-400">
          표시:
          <span className="ml-1 font-mono text-neutral-200">
            {formatManThousand(member.account)}(<span className="text-neutral-300">{formatManThousand(member.toon)}</span>) / 기여도 {formatManThousand((member.account || 0) + (member.toon || 0))}
          </span>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onReset?.(member.id)} className="px-3 py-1.5 bg-neutral-800 rounded-lg hover:bg-neutral-700 text-xs" title="계좌/투네/기여도 0으로 리셋">
            리셋
          </button>
          <button onClick={() => onDelete?.(member.id)} className="px-3 py-1.5 bg-red-700 rounded-lg hover:bg-red-600 text-xs" title="멤버 삭제">
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}
