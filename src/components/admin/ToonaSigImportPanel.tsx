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
  const [hubLinked, setHubLinked] = useState(false);
  const [hubEmail, setHubEmail] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/toona/hub", { credentials: "include" });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          session?: { email?: string; baseUrl?: string } | null;
        };
        if (cancelled || !res.ok || !data.ok || !data.session) {
          if (!cancelled) {
            setHubLinked(false);
            setHubEmail(null);
          }
          return;
        }
        setHubLinked(true);
        setHubEmail(data.session.email || null);
        if (data.session.baseUrl?.trim()) setBaseUrl(data.session.baseUrl.trim());
        if (data.session.email?.trim()) setEmail(data.session.email.trim());
      } catch {
        if (!cancelled) {
          setHubLinked(false);
          setHubEmail(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyFetchedItems = useCallback(
    (items: SigItem[], count: number, streamKey: string | undefined) => {
      const label =
        mode === "replace"
          ? `toona 시그 ${count}개로 목록을 교체합니다(한방 시그 유지).\nstreamKey=${streamKey || "-"}\n계속할까요?`
          : `toona 시그 ${count}개를 병합합니다(같은 이름은 가격·이미지 갱신).\nstreamKey=${streamKey || "-"}\n계속할까요?`;

      if (!window.confirm(label)) {
        setMessage(`불러옴 ${count}개 — 취소됨`);
        return;
      }

      const { nextInventory, added, updated } = applyToonaSigItemsToInventory(
        inventory,
        items,
        mode
      );
      const summary =
        mode === "replace"
          ? `toona에서 시그 ${count}개로 교체·저장`
          : `toona 병합·저장 (추가 ${added} · 갱신 ${updated} · 수신 ${count})`;
      onApply(nextInventory, summary);
      setMessage(summary);
      try {
        window.dispatchEvent(new CustomEvent("youtube-sig-inventory-imported"));
      } catch {
        /* ignore */
      }
    },
    [inventory, mode, onApply]
  );

  const runImportViaHub = useCallback(async () => {
    setMessage("");
    setBusy(true);
    try {
      const res = await fetch("/api/toona/signatures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ useHubSession: true }),
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
            (data.error === "hub_not_linked"
              ? "허브 미연결 — 먼저 toona 허브에 로그인하세요"
              : `가져오기 실패 (${data.error || res.status})`)
        );
        return;
      }

      applyFetchedItems(data.items, data.count ?? data.items.length, data.streamKey);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "가져오기 실패");
    } finally {
      setBusy(false);
    }
  }, [applyFetchedItems]);

  const runImportWithPassword = useCallback(async () => {
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

      applyFetchedItems(data.items, data.count ?? data.items.length, data.streamKey);
      setPassword("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "가져오기 실패");
    } finally {
      setBusy(false);
    }
  }, [baseUrl, email, password, applyFetchedItems]);

  return (
    <div className="rounded border border-violet-500/30 bg-violet-950/20 p-2 space-y-2">
      <div className="text-xs text-violet-200/90 font-medium">toona에서 시그 가져오기</div>

      {hubLinked ? (
        <div className="space-y-2">
          <p className="text-[11px] text-neutral-300 leading-relaxed">
            허브 연결됨{hubEmail ? ` (${hubEmail})` : ""}. 비밀번호 없이 시그 목록을 가져옵니다.
            (로그인 시에도 자동 병합됩니다.)
          </p>
          <fieldset className="text-[11px] text-neutral-400 space-y-1">
            <legend className="mb-0.5">반영 방식</legend>
            <label className="flex items-center gap-1.5 text-neutral-200">
              <input
                type="radio"
                name="toona-sig-mode-hub"
                checked={mode === "merge"}
                onChange={() => setMode("merge")}
              />
              병합 (같은 이름 갱신 · 없으면 추가)
            </label>
            <label className="flex items-center gap-1.5 text-neutral-200">
              <input
                type="radio"
                name="toona-sig-mode-hub"
                checked={mode === "replace"}
                onChange={() => setMode("replace")}
              />
              교체 (한방만 유지하고 전체 교체)
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded bg-violet-700 hover:bg-violet-600 text-sm disabled:opacity-50"
              disabled={busy}
              onClick={() => void runImportViaHub()}
            >
              {busy ? "가져오는 중…" : "시그 가져오기"}
            </button>
            {message ? <span className="text-xs text-neutral-300">{message}</span> : null}
          </div>
        </div>
      ) : (
        <>
          <p className="text-[11px] text-amber-200/80 leading-relaxed">
            허브 미연결 — 아래에서 로그인하거나, 후원 수집 탭에서 toona 허브 로그인을 먼저 하세요.
            (허브 로그인 시 시그가 자동으로 병합됩니다.)
          </p>
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
                병합 (같은 이름 갱신 · 없으면 추가)
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
              onClick={() => void runImportWithPassword()}
            >
              {busy ? "가져오는 중…" : "로그인 후 시그 가져오기"}
            </button>
            {message ? <span className="text-xs text-neutral-300">{message}</span> : null}
          </div>
          <p className="text-[10px] text-neutral-500 leading-relaxed">
            비밀번호는 서버 프록시로만 전달되며 저장하지 않습니다. 이미지 상대 경로는 toona Base URL이
            붙습니다.
          </p>
        </>
      )}
    </div>
  );
}
