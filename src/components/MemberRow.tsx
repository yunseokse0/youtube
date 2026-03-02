"use client";
import { Member, parseTenThousandThousand, confirmHighAmount, maskTenThousandThousandInput, formatManThousand } from "@/lib/state";
import { useEffect, useRef, useState } from "react";

type Props = {
  member: Member;
  onChange: (next: Member) => void;
  onRename?: (id: string, name: string) => void;
  onReset?: (id: string) => void;
  onDelete?: (id: string) => void;
};

export default function MemberRow({ member, onChange, onRename, onReset, onDelete }: Props) {
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
    onChange({ ...member, account: amt });
  };
  const commitToon = (val: string) => {
    const amt = parseTenThousandThousand(val);
    onChange({ ...member, toon: amt });
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
    onChange({ ...member, [field]: nextVal } as Member);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-start md:items-center p-3 bg-neutral-900/60 rounded border border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="w-full sm:w-40 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 font-semibold"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={() => onRename?.(member.id, (localName || "무명").trim())}
          placeholder="멤버 이름"
        />
        <input
          className="w-full sm:w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10"
          value={member.role || ""}
          onChange={(e) => onChange({ ...member, role: e.target.value })}
          placeholder="직급 (예: 대리)"
          title="멤버 직급"
        />
        <input
          className="w-full sm:w-32 px-2 py-1 rounded bg-neutral-800/80 border border-white/10"
          inputMode="numeric"
          value={localGoal}
          onChange={(e) => setLocalGoal(e.target.value.replace(/[^\d]/g, ""))}
          onBlur={() => commitGoal(localGoal)}
          placeholder="목표(원)"
          title="개인 목표 금액(원)"
        />
        <label className="flex items-center gap-1 text-xs text-neutral-300" title="체크 시 랭크에서 제외되고 표 하단에 고정 표시됩니다.">
          <input
            type="checkbox"
            checked={!!member.operating}
            onChange={(e) => onChange({ ...member, operating: e.target.checked })}
          />
          운영비
        </label>
        <button
          onClick={() => onReset?.(member.id)}
          className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700 text-xs"
          title="계좌/투네 0으로 리셋"
        >
          리셋
        </button>
        <button
          onClick={() => onDelete?.(member.id)}
          className="px-2 py-1 bg-red-700 rounded hover:bg-red-600 text-xs"
          title="멤버 삭제"
        >
          삭제
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-400 mr-1">계좌</label>
        <input
          className={`w-28 sm:w-28 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 focus:outline-none ${flash ? "animate-flashGold" : ""}`}
          inputMode="decimal"
          value={localAccount}
          onChange={(e) => setLocalAccount(maskTenThousandThousandInput(e.target.value))}
          onBlur={() => commitAccount(localAccount)}
          placeholder="예: 3.5 = 35,000"
        />
        <div className="grid grid-cols-2 sm:flex gap-1 w-full sm:w-auto">
          <button onClick={() => adjust("account", 1000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">+1천</button>
          <button onClick={() => adjust("account", -1000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">-1천</button>
          <button onClick={() => adjust("account", 10000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">+1만</button>
          <button onClick={() => adjust("account", -10000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">-1만</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-400 mr-1">투네</label>
        <input
          className="w-28 sm:w-28 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 focus:outline-none"
          inputMode="decimal"
          value={localToon}
          onChange={(e) => setLocalToon(maskTenThousandThousandInput(e.target.value))}
          onBlur={() => commitToon(localToon)}
          placeholder="예: 1.2 = 12,000"
        />
        <div className="grid grid-cols-2 sm:flex gap-1 w-full sm:w-auto">
          <button onClick={() => adjust("toon", 1000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">+1천</button>
          <button onClick={() => adjust("toon", -1000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">-1천</button>
          <button onClick={() => adjust("toon", 10000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">+1만</button>
          <button onClick={() => adjust("toon", -10000)} className="px-2 py-1 bg-neutral-800 rounded hover:bg-neutral-700">-1만</button>
        </div>
      </div>
      <div className="text-left md:text-right pr-0 md:pr-2">
        <span className="text-neutral-400 text-xs">표시: </span>
        <span className="font-mono">{formatManThousand(member.account)}(<span className="text-neutral-300">{formatManThousand(member.toon)}</span>)</span>
      </div>
    </div>
  );
}
