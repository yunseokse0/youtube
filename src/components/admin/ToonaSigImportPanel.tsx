"use client";

import { useCallback, useEffect, useState } from "react";
import type { SigItem } from "@/types";
import {
  applyToonaSigItemsToInventory,
  type ToonaSigImportMode,
} from "@/lib/toona-sig-import";

const LS_BASE = "toonaSigImport.baseUrl";
const LS_EMAIL = "toonaSigImport.email";

const DEFAULT_BASE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_TOONA_API_BASE_URL?.trim()) ||
  "http://localhost:4000";

type Props = {
  inventory: SigItem[];
  onApply: (next: SigItem[], summary: string) => void;
};

export default function ToonaSigImportPanel({ inventory, onApply }: Props) {
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<ToonaSigImportMode>("merge");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const b = window.localStorage.getItem(LS_BASE);
      const e = window.localStorage.getItem(LS_EMAIL);
      if (b?.trim()) setBaseUrl(b.trim());
      if (e?.trim()) setEmail(e.trim());
    } catch {
      /* ignore */
    }
  }, []);

  const runImport = useCallback(async () => {
    setMessage("");
    const trimmedBase = baseUrl.trim();
    const trimmedEmail = email.trim();
    if (!trimmedBase || !trimmedEmail || !password) {
      setMessage("Base URL·이메일·비밀번호를 입력하세요.");
      return;
    }

    setBusy(true);
    try {
      try {
        window.localStorage.setItem(LS_BASE, trimmedBase);
        window.localStorage.setItem(LS_EMAIL, trimmedEmail);
      } catch {
        /* ignore */
      }

      const res = await fetch("/api/toona/signatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          baseUrl: trimmedBase,
          email: trimmedEmail,
          password,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        count?: number;
        streamKey?: string;
        items?: SigItem[];
      };

      if (!res.ok || !data.ok || !Array.isArray(data.items)) {
        setMessage(
          data.message ||
            (data.error === "login_failed"
              ? "toona 로그인 실패"
              : data.error === "toona_unreachable"
                ? "toona 서버에 연결할 수 없습니다"
                : `가져오기 실패 (${data.error || res.status})`)
        );
        return;
      }

      const label =
        mode === "replace"
          ? `toona 시그 ${data.count}개로 목록을 교체합니다(한방 시그 유지).\nstreamKey=${data.streamKey}\n계속할까요?`
          : `toona 시그 ${data.count}개를 병합합니다(같은 이름은 가격·이미지 갱신).\nstreamKey=${data.streamKey}\n계속할까요?`;

      if (!window.confirm(label)) {
        setMessage(`불러옴 ${data.count}개 — 취소됨`);
        return;
      }

      const { nextInventory, added, updated } = applyToonaSigItemsToInventory(
        inventory,
        data.items,
        mode
      );
      const summary =
        mode === "replace"
          ? `toona에서 시그 ${data.count}개로 교체·저장`
          : `toona 병합·저장 (추가 ${added} · 갱신 ${updated} · 수신 ${data.count})`;
      onApply(nextInventory, summary);
      setMessage(summary);
      setPassword("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "가져오기 실패");
    } finally {
      setBusy(false);
    }
  }, [baseUrl, email, password, mode, inventory, onApply]);

  return (
    <div className="rounded border border-violet-500/30 bg-violet-950/20 p-2 space-y-2">
      <div className="text-xs text-violet-200/90 font-medium">toona에서 시그 가져오기</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="block text-[11px] text-neutral-400">
          toona API Base URL
          <input
            className="mt-0.5 w-full rounded bg-black/40 border border-white/15 px-2 py-1 text-sm font-mono text-neutral-100"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:4000"
            autoComplete="off"
          />
        </label>
        <label className="block text-[11px] text-neutral-400">
          이메일
          <input
            className="mt-0.5 w-full rounded bg-black/40 border border-white/15 px-2 py-1 text-sm text-neutral-100"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin 또는 email"
            autoComplete="username"
          />
        </label>
        <label className="block text-[11px] text-neutral-400">
          비밀번호
          <input
            type="password"
            className="mt-0.5 w-full rounded bg-black/40 border border-white/15 px-2 py-1 text-sm text-neutral-100"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <fieldset className="text-[11px] text-neutral-400 space-y-1">
          <legend className="mb-0.5">반영 방식</legend>
          <label className="flex items-center gap-1.5 text-neutral-200">
            <input
              type="radio"
              name="toona-sig-mode"
              checked={mode === "merge"}
              onChange={() => setMode("merge")}
            />
            병합 (같은 이름 갱신 · 신규 추가)
          </label>
          <label className="flex items-center gap-1.5 text-neutral-200">
            <input
              type="radio"
              name="toona-sig-mode"
              checked={mode === "replace"}
              onChange={() => setMode("replace")}
            />
            교체 (한방만 유지하고 전체 교체)
          </label>
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 text-sm disabled:opacity-50"
          disabled={busy}
          onClick={() => void runImport()}
        >
          {busy ? "가져오는 중…" : "로그인 후 시그 가져오기"}
        </button>
        {message ? <span className="text-xs text-neutral-300">{message}</span> : null}
      </div>
      <p className="text-[10px] text-neutral-500 leading-relaxed">
        비밀번호는 서버 프록시로만 전달되며 저장하지 않습니다. 이미지 상대 경로는 toona Base URL이
        붙습니다.
      </p>
    </div>
  );
}
