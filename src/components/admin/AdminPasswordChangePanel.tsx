"use client";

import { useState } from "react";

function PasswordInput({
  value,
  onChange,
  placeholder,
  autoComplete,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  autoComplete: "current-password" | "new-password";
  id: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? "text" : "password"}
        className="w-full rounded-lg border border-white/10 bg-[#1e1e1e] px-3 py-2 pr-16 text-sm text-white"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-neutral-300 hover:bg-white/10 hover:text-white"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
      >
        {visible ? "숨기기" : "보기"}
      </button>
    </div>
  );
}

type AdminPasswordChangePanelProps = {
  userId?: string | null;
  disabled?: boolean;
  disabledReason?: string;
};

export function AdminPasswordChangePanel({
  userId,
  disabled = false,
  disabledReason,
}: AdminPasswordChangePanelProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  const resetForm = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    if (!userId || disabled) return;
    if (newPassword.trim() !== confirmPassword.trim()) {
      setMessage({ tone: "err", text: "새 비밀번호 확인이 일치하지 않습니다." });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
        error?: string;
      } | null;
      if (!res.ok || data?.ok === false) {
        setMessage({
          tone: "err",
          text: data?.message || "비밀번호 변경에 실패했습니다.",
        });
        return;
      }
      resetForm();
      setMessage({ tone: "ok", text: data?.message || "비밀번호가 변경되었습니다." });
    } catch {
      setMessage({ tone: "err", text: "비밀번호 변경 중 오류가 발생했습니다." });
    } finally {
      setBusy(false);
    }
  };

  if (!userId) return null;

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="max-w-md space-y-3">
      <p className="text-sm text-neutral-400">
        현재 비밀번호를 확인한 뒤 새 비밀번호로 변경합니다. 변경 후에도 로그인 상태는 유지됩니다.
      </p>
      {disabled ? (
        <p className="rounded-lg border border-amber-400/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100">
          {disabledReason || "이 계정은 비밀번호 변경을 지원하지 않습니다."}
        </p>
      ) : (
        <>
          <label className="block space-y-1">
            <span className="text-xs text-neutral-400">현재 비밀번호</span>
            <PasswordInput
              id="admin-current-password"
              value={currentPassword}
              onChange={setCurrentPassword}
              placeholder="현재 비밀번호"
              autoComplete="current-password"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-neutral-400">새 비밀번호</span>
            <PasswordInput
              id="admin-new-password"
              value={newPassword}
              onChange={setNewPassword}
              placeholder="새 비밀번호"
              autoComplete="new-password"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-neutral-400">새 비밀번호 확인</span>
            <PasswordInput
              id="admin-confirm-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="새 비밀번호 다시 입력"
              autoComplete="new-password"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {busy ? "변경 중…" : "비밀번호 변경"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded-lg bg-neutral-700 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-600 disabled:opacity-60"
              onClick={() => {
                resetForm();
                setMessage(null);
              }}
            >
              입력 초기화
            </button>
          </div>
        </>
      )}
      {message ? (
        <p
          className={`text-sm ${message.tone === "ok" ? "text-emerald-300" : "text-rose-300"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
