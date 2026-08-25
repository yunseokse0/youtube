"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  memberId: string;
  memberName: string;
  /** 서버/상태에 저장된 직급 */
  savedValue: string;
  disabled?: boolean;
  placeholder?: string;
  /** blur 시 trim 된 값으로 커밋 */
  onCommit: (memberId: string, position: string) => void;
};

/**
 * 직급 입력 — 포커스 중에는 로컬 draft만 갱신.
 * onChange마다 전역 setState+trim+persist 하면 한글 IME·원격 동기화에 입력이 먹통처럼 보인다.
 */
export default function MemberPositionInput({
  memberId,
  memberName,
  savedValue,
  disabled = false,
  placeholder,
  onCommit,
}: Props) {
  const [draft, setDraft] = useState(savedValue);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(savedValue);
  }, [savedValue]);

  return (
    <label className="grid grid-cols-[120px_1fr] items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
      <span className="truncate text-sm text-neutral-300">{memberName}</span>
      <input
        className="w-full rounded bg-neutral-900/80 border border-white/10 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        placeholder={placeholder}
        value={draft}
        disabled={disabled}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focusedRef.current = false;
          const cleaned = draft.trim();
          setDraft(cleaned);
          if (cleaned !== savedValue) onCommit(memberId, cleaned);
        }}
      />
    </label>
  );
}
