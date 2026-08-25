"use client";

import { useState } from "react";

type Account = {
  id: string;
  name: string;
  companyName: string;
  toonaEmail?: string;
  startDate: number | null;
  endDate: number | null;
  createdAt: number;
};

function apiUrl(path: string, key: string) {
  return `${path}?key=${encodeURIComponent(key)}`;
}

function PasswordField({
  value,
  onChange,
  placeholder,
  required,
  autoFocus,
  className = "w-full px-3 py-2 rounded bg-neutral-800 border border-white/10 pr-16",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        autoComplete="new-password"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-xs text-neutral-300 hover:text-white hover:bg-white/10"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
      >
        {visible ? "숨기기" : "보기"}
      </button>
    </div>
  );
}

export default function CreateAccountsPage() {
  const [key, setKey] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [keyVerified, setKeyVerified] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    companyName: "",
    password: "",
    toonaEmail: "",
    startDate: "",
    endDate: "",
    unlimited: true,
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({
    startDate: "",
    endDate: "",
    unlimited: true,
    password: "",
    toonaEmail: "",
  });

  const fetchAccounts = async () => {
    if (!key) return;
    setLoading(true);
    try {
      const r = await fetch(apiUrl("/api/accounts", key), { cache: "no-store" });
      if (r.status === 401) {
        setError("접근 키가 올바르지 않습니다.");
        setAccounts([]);
        return false;
      }
      if (r.status === 503) {
        const data = await r.json().catch(() => ({}));
        setError((data as { error?: string }).error || "서버(Redis) 설정이 필요합니다.");
        setAccounts([]);
        return false;
      }
      const data = await r.json();
      setAccounts(Array.isArray(data) ? data : []);
      setError("");
      return true;
    } catch {
      setError("계정 목록을 불러올 수 없습니다.");
      setAccounts([]);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const k = (keyInput || "").trim();
    if (!k) {
      setError("접근 키를 입력하세요.");
      return;
    }
    setError("");
    setKey(k);
    setLoading(true);
    try {
      const r = await fetch(apiUrl("/api/accounts", k), { cache: "no-store" });
      if (r.status === 401) {
        setError("접근 키가 올바르지 않습니다.");
        setKey("");
        return;
      }
      if (r.status === 503) {
        const errBody = await r.json().catch(() => ({}));
        setError((errBody as { error?: string }).error || "서버(Redis) 설정이 필요합니다.");
        setKey("");
        return;
      }
      const data = await r.json();
      setAccounts(Array.isArray(data) ? data : []);
      setKeyVerified(true);
    } catch {
      setError("계정 목록을 불러올 수 없습니다.");
      setKey("");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    setKey("");
    setKeyInput("");
    setKeyVerified(false);
    setAccounts([]);
    setError("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key) return;
    setError("");
    try {
      const r = await fetch(apiUrl("/api/accounts", key), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          companyName: form.companyName.trim(),
          password: form.password,
          toonaEmail: form.toonaEmail.trim() || null,
          startDate: form.unlimited ? null : form.startDate || null,
          endDate: form.unlimited ? null : form.endDate || null,
          unlimited: form.unlimited,
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        const detail = typeof data.detail === "string" ? ` (${data.detail})` : "";
        setError((data.error || "생성 실패") + detail);
        return;
      }
      setForm({ name: "", companyName: "", password: "", toonaEmail: "", startDate: "", endDate: "", unlimited: true });
      fetchAccounts();
    } catch {
      setError("생성 중 오류가 발생했습니다.");
    }
  };

  const handleDelete = async (id: string) => {
    if (!key || !confirm(`계정 "${id}"을(를) 삭제할까요?`)) return;
    try {
      const r = await fetch(apiUrl(`/api/accounts/${id}`, key), { method: "DELETE" });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "삭제 실패");
        return;
      }
      setEditing(null);
      fetchAccounts();
    } catch {
      setError("삭제 중 오류가 발생했습니다.");
    }
  };

  const handleUpdate = async (id: string) => {
    if (!key) return;
    const nextPassword = editForm.password.trim();
    try {
      const r = await fetch(apiUrl(`/api/accounts/${id}`, key), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: editForm.unlimited ? null : editForm.startDate || null,
          endDate: editForm.unlimited ? null : editForm.endDate || null,
          unlimited: editForm.unlimited,
          toonaEmail: editForm.toonaEmail.trim() || null,
          ...(nextPassword ? { password: nextPassword } : {}),
        }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "수정 실패");
        return;
      }
      setEditing(null);
      setEditForm((f) => ({ ...f, password: "" }));
      fetchAccounts();
    } catch {
      setError("수정 중 오류가 발생했습니다.");
    }
  };

  const startEdit = (a: Account) => {
    setEditing(a.id);
    setEditForm({
      startDate: a.startDate ? new Date(a.startDate).toISOString().slice(0, 10) : "",
      endDate: a.endDate ? new Date(a.endDate).toISOString().slice(0, 10) : "",
      unlimited: a.startDate == null && a.endDate == null,
      password: "",
      toonaEmail: a.toonaEmail || "",
    });
  };

  if (!keyVerified) {
    return (
      <main className="min-h-screen bg-neutral-950 text-white p-8 flex items-center justify-center">
        <div className="w-full max-w-sm">
          <h1 className="text-xl font-bold mb-4 text-center">계정 관리</h1>
          <p className="text-neutral-400 text-sm mb-4 text-center">접근 키를 입력하세요.</p>
          <form onSubmit={handleKeySubmit} className="space-y-4">
            <PasswordField
              value={keyInput}
              onChange={(v) => {
                setKeyInput(v);
                setError("");
              }}
              placeholder="접근 키"
              autoFocus
              className="w-full px-4 py-3 rounded bg-neutral-800 border border-white/10 pr-16"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button type="submit" className="w-full py-3 rounded bg-emerald-600 hover:bg-emerald-500 font-medium">
              접속
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">계정 관리</h1>
          <button
            type="button"
            className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-sm"
            onClick={handleLogout}
          >
            접근 해제
          </button>
        </div>
        {error && <div className="p-3 rounded bg-red-900/50 text-red-200 text-sm">{error}</div>}

        <section className="rounded border border-white/10 bg-neutral-900/50 p-4">
          <h2 className="text-lg font-semibold mb-4">계정 생성</h2>
          <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-neutral-400 mb-1">이름</label>
              <input
                className="w-full px-3 py-2 rounded bg-neutral-800 border border-white/10"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="이름"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">회사명</label>
              <input
                className="w-full px-3 py-2 rounded bg-neutral-800 border border-white/10"
                value={form.companyName}
                onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))}
                placeholder="회사명"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">비밀번호</label>
              <PasswordField
                value={form.password}
                onChange={(v) => setForm((f) => ({ ...f, password: v }))}
                placeholder="비밀번호"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-neutral-400 mb-1">DIN(toona) 이메일 (자동 연동)</label>
              <input
                className="w-full px-3 py-2 rounded bg-neutral-800 border border-white/10"
                value={form.toonaEmail}
                onChange={(e) => setForm((f) => ({ ...f, toonaEmail: e.target.value }))}
                placeholder="sssss@gmail.com"
                type="email"
                autoComplete="off"
              />
            </div>
            <div className="flex items-end gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.unlimited}
                  onChange={(e) => setForm((f) => ({ ...f, unlimited: e.target.checked }))}
                  className="rounded"
                />
                <span className="text-sm">무제한</span>
              </label>
            </div>
            {!form.unlimited && (
              <>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">시작일</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 rounded bg-neutral-800 border border-white/10"
                    value={form.startDate}
                    onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-xs text-neutral-400 mb-1">종료일</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 rounded bg-neutral-800 border border-white/10"
                    value={form.endDate}
                    onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </>
            )}
            <div className="md:col-span-2">
              <button type="submit" className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500">
                생성
              </button>
            </div>
          </form>
        </section>

        <section className="rounded border border-white/10 bg-neutral-900/50 overflow-auto">
          <h2 className="text-lg font-semibold p-4 border-b border-white/10">계정 목록</h2>
          {loading ? (
            <div className="p-8 text-center text-neutral-400">로딩 중...</div>
          ) : accounts.length === 0 ? (
            <div className="p-8 text-center text-neutral-400">등록된 계정이 없습니다.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-neutral-400 border-b border-white/10">
                  <th className="p-2 text-left">ID</th>
                  <th className="p-2 text-left">이름</th>
                  <th className="p-2 text-left">회사명</th>
                  <th className="p-2 text-left">DIN 이메일</th>
                  <th className="p-2 text-left">시작일</th>
                  <th className="p-2 text-left">종료일</th>
                  <th className="p-2 text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.id} className="border-b border-white/10 align-top">
                    <td className="p-2 font-mono">{a.id}</td>
                    <td className="p-2">{a.name}</td>
                    <td className="p-2">{a.companyName}</td>
                    <td className="p-2 text-xs text-neutral-300">{a.toonaEmail || "—"}</td>
                    <td className="p-2">
                      {editing === a.id ? (
                        <input
                          type="date"
                          className="px-2 py-1 rounded bg-neutral-800 border border-white/10 w-36"
                          value={editForm.startDate}
                          onChange={(e) => setEditForm((f) => ({ ...f, startDate: e.target.value }))}
                          disabled={editForm.unlimited}
                        />
                      ) : a.startDate ? (
                        new Date(a.startDate).toLocaleDateString("ko-KR")
                      ) : (
                        "무제한"
                      )}
                    </td>
                    <td className="p-2">
                      {editing === a.id ? (
                        <input
                          type="date"
                          className="px-2 py-1 rounded bg-neutral-800 border border-white/10 w-36"
                          value={editForm.endDate}
                          onChange={(e) => setEditForm((f) => ({ ...f, endDate: e.target.value }))}
                          disabled={editForm.unlimited}
                        />
                      ) : a.endDate ? (
                        new Date(a.endDate).toLocaleDateString("ko-KR")
                      ) : (
                        "무제한"
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {editing === a.id ? (
                        <div className="flex flex-col items-end gap-2 min-w-[220px]">
                          <div className="w-full text-left">
                            <label className="block text-[11px] text-neutral-400 mb-1">
                              DIN(toona) 이메일
                            </label>
                            <input
                              type="email"
                              className="w-full px-2 py-1.5 rounded bg-neutral-800 border border-white/10 text-xs"
                              value={editForm.toonaEmail}
                              onChange={(e) => setEditForm((f) => ({ ...f, toonaEmail: e.target.value }))}
                              placeholder="sssss@gmail.com"
                              autoComplete="off"
                            />
                          </div>
                          <div className="w-full text-left">
                            <label className="block text-[11px] text-neutral-400 mb-1">
                              새 비밀번호 (비우면 유지)
                            </label>
                            <PasswordField
                              value={editForm.password}
                              onChange={(v) => setEditForm((f) => ({ ...f, password: v }))}
                              placeholder="새 비밀번호"
                              className="w-full px-2 py-1.5 rounded bg-neutral-800 border border-white/10 text-xs pr-14"
                            />
                          </div>
                          <div className="flex gap-1 justify-end flex-wrap">
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={editForm.unlimited}
                                onChange={(e) => setEditForm((f) => ({ ...f, unlimited: e.target.checked }))}
                                className="rounded"
                              />
                              무제한
                            </label>
                            <button
                              type="button"
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs"
                              onClick={() => handleUpdate(a.id)}
                            >
                              저장
                            </button>
                            <button
                              type="button"
                              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                              onClick={() => setEditing(null)}
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                            onClick={() => startEdit(a)}
                          >
                            수정
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs"
                            onClick={() => handleDelete(a.id)}
                          >
                            삭제
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <p className="text-xs text-neutral-500">
          접근 URL: /create-accounts — 페이지 접속 후 접근 키 입력
        </p>
      </div>
    </main>
  );
}
