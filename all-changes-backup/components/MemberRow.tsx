"use client";
import { Member, parseTenThousandThousand, confirmHighAmount, maskTenThousandThousandInput } from "@/lib/state";
import { useEffect, useRef, useState } from "react";

type Props = {
  member: Member;
  onChange: (id: string, updates: Partial<Member>) => void;
  onRename: (id: string, newName: string) => void;
  onReset: (id: string) => void;
  onDelete: (id: string) => void;
};

export default function MemberRow({ member, onChange, onRename, onReset, onDelete }: Props) {
  const [localAccount, setLocalAccount] = useState(member.account.toString());
  const [localToon, setLocalToon] = useState(member.toon.toString());
  const [localName, setLocalName] = useState(member.name);
  const prevAccount = useRef(member.account);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    setLocalAccount(member.account.toString());
    setLocalToon(member.toon.toString());
    setLocalName(member.name);
  }, [member.account, member.toon, member.name]);

  useEffect(() => {
    if (prevAccount.current !== member.account) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 500);
      return () => clearTimeout(t);
    }
    prevAccount.current = member.account;
  }, [member.account]);

  const handleAccountBlur = () => {
    const val = parseTenThousandThousand(localAccount);
    if (!isNaN(val) && confirmHighAmount(val)) {
      onChange(member.id, { account: val });
    } else {
      setLocalAccount(member.account.toString());
    }
  };

  const handleToonBlur = () => {
    const val = parseTenThousandThousand(localToon);
    if (!isNaN(val) && confirmHighAmount(val)) {
      onChange(member.id, { toon: val });
    } else {
      setLocalToon(member.toon.toString());
    }
  };

  const handleNameBlur = () => {
    if (localName.trim() && localName !== member.name) {
      onRename(member.id, localName.trim());
    } else {
      setLocalName(member.name);
    }
  };

  return (
    <div className={`grid grid-cols-[1fr_auto_auto_auto] gap-3 items-center p-3 bg-neutral-900/60 rounded border border-white/10 ${flash ? "animate-pulse bg-green-900/30" : ""}`}>
      <div className="flex items-center gap-2">
        <input
          className="w-40 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 font-semibold"
          value={localName}
          onChange={(e) => setLocalName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={(e) => e.key === "Enter" && handleNameBlur()}
        />
        <span className="text-xs text-neutral-400">오늘: {member.today.toLocaleString()}</span>
      </div>

      <input
        className="w-28 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right"
        value={localAccount}
        onChange={(e) => setLocalAccount(maskTenThousandThousandInput(e.target.value))}
        onBlur={handleAccountBlur}
        onKeyDown={(e) => e.key === "Enter" && handleAccountBlur()}
      />

      <input
        className="w-28 px-2 py-1 rounded bg-neutral-800/80 border border-white/10 text-right"
        value={localToon}
        onChange={(e) => setLocalToon(maskTenThousandThousandInput(e.target.value))}
        onBlur={handleToonBlur}
        onKeyDown={(e) => e.key === "Enter" && handleToonBlur()}
      />

      <div className="flex gap-2">
        <button
          className="px-2 py-1 rounded bg-yellow-600/80 hover:bg-yellow-500 text-xs"
          onClick={() => onReset(member.id)}
        >
          리셋
        </button>
        <button
          className="px-2 py-1 rounded bg-red-600/80 hover:bg-red-500 text-xs"
          onClick={() => onDelete(member.id)}
        >
          삭제
        </button>
      </div>
    </div>
  );
}