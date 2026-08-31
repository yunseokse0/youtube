"use client";

import { useCallback, useEffect, useState } from "react";
import { getToonaDashboardUrl } from "@/lib/donation-ingest-mode";
import { loadStateFromApi, saveState } from "@/lib/state";

const SIG_INVENTORY_IMPORTED_EVENT = "youtube-sig-inventory-imported";

type HubSession = {
  email: string;
  streamKey: string;
  baseUrl: string;
  linkedAt: number;
  displayName?: string | null;
  lastStatusAt?: number | null;
  lastStatusOk?: boolean | null;
  lastStatusError?: string | null;
  lastIngestAt?: string | null;
  lastIngestOk?: boolean | null;
  lastIngestError?: string | null;
  youtubegitEnabled?: boolean | null;
  youtubeUserId?: string | null;
};

type HubLog = {
  id: string;
  at: number;
  donorName: string;
  amount: number;
  playerName?: string;
  target?: "account" | "toon";
  mode?: string;
  applied?: boolean;
  source: "ingest" | "toona";
  message?: string;
};

type SigImportResult = {
  ok?: boolean;
  count?: number;
  added?: number;
  updated?: number;
  error?: string;
};

type Props = {
  youtubeUserId: string;
};

function formatSigImport(sig: SigImportResult | undefined): string {
  if (!sig) return "";
  if (sig.ok === false) return `시그 가져오기 실패: ${sig.error || "unknown"}`;
  return `시그 ${sig.count ?? 0}개 병합 (추가 ${sig.added ?? 0} · 갱신 ${sig.updated ?? 0})`;
}

export default function ToonaHubPanel({ youtubeUserId }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [baseUrl, setBaseUrl] = useState(getToonaDashboardUrl());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<HubSession | null>(null);
  const [logs, setLogs] = useState<HubLog[]>([]);

  const applyPayload = useCallback((data: { session?: HubSession | null; logs?: HubLog[] }) => {
    setSession(data.session ?? null);
    setLogs(Array.isArray(data.logs) ? data.logs : []);
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      const res = await fetch(`/api/toona/hub${refresh ? "?refresh=1" : ""}`, {
        credentials: "include",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        session?: HubSession | null;
        logs?: HubLog[];
        error?: string;
      };
      if (!res.ok || data.ok === false) {
        setMessage(data.error || "상태 조회 실패");
        return;
      }
      applyPayload(data);
      if (data.session?.email) setEmail(data.session.email);
      if (data.session?.baseUrl) setBaseUrl(data.session.baseUrl);
    },
    [applyPayload]
  );

  useEffect(() => {
    void load(false);
  }, [load, youtubeUserId]);

  useEffect(() => {
    if (!session) return;
    const t = window.setInterval(() => void load(true), 15_000);
    return () => window.clearInterval(t);
  }, [session, load]);

  const syncLocalSigInventory = useCallback(async () => {
    try {
      const remote = await loadStateFromApi(youtubeUserId, { forceFull: true });
      if (remote) {
        saveState(remote, youtubeUserId);
        window.dispatchEvent(
          new CustomEvent(SIG_INVENTORY_IMPORTED_EVENT, {
            detail: { userId: youtubeUserId },
          })
        );
      }
    } catch {
      /* ignore */
    }
  }, [youtubeUserId]);

  const onLogin = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/toona/hub", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, baseUrl }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        session?: HubSession | null;
        logs?: HubLog[];
        sigImport?: SigImportResult;
      };
      if (!res.ok || !data.ok) {
        setMessage(data.error || "로그인 실패");
        return;
      }
      setPassword("");
      applyPayload(data);
      if (data.sigImport?.ok) {
        await syncLocalSigInventory();
      }
      const sigMsg = formatSigImport(data.sigImport);
      setMessage(
        sigMsg
          ? `toona 로그인·연동 완료 · ${sigMsg}`
          : "toona 로그인·youtubegit 연동 완료"
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "로그인 실패");
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    setBusy(true);
    setMessage("");
    try {
      await fetch("/api/toona/hub", { method: "DELETE", credentials: "include" });
      setSession(null);
      setLogs([]);
      setPassword("");
      setMessage("허브 연결을 해제했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const onSyncLogs = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/toona/hub", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-donations" }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        imported?: number;
        session?: HubSession | null;
        logs?: HubLog[];
      };
      if (!res.ok || !data.ok) {
        setMessage(data.error || "후원 동기화 실패");
        return;
      }
      applyPayload(data);
      setMessage(`로그인 이후 후원 ${data.imported ?? 0}건 동기화`);
    } finally {
      setBusy(false);
    }
  };

  const onImportSigs = async () => {
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/toona/hub", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import-signatures" }),
      });
      const data = (await res.json().catch(() => ({}))) as SigImportResult & {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setMessage(data.error || "시그 가져오기 실패");
        return;
      }
      await syncLocalSigInventory();
      setMessage(formatSigImport(data));
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = !session
    ? "미연결"
    : session.lastStatusOk === false
      ? "오류"
      : session.youtubegitEnabled === false
        ? "연동 OFF"
        : "연결됨";

  const statusClass = !session
    ? "border-white/10 text-neutral-400 bg-black/20"
    : session.lastStatusOk === false
      ? "border-rose-500/40 text-rose-300 bg-rose-500/10"
      : "border-emerald-500/40 text-emerald-300 bg-emerald-500/10";

  return (
    <div className="rounded border border-violet-500/30 bg-violet-950/25 px-3 py-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-xs font-semibold text-violet-200">DIN 허브 모드</div>
        <span className={`text-[11px] px-2 py-0.5 rounded border ${statusClass}`}>{statusLabel}</span>
        {session?.lastIngestAt ? (
          <span className="text-[11px] text-neutral-400">
            마지막 ingest: {new Date(session.lastIngestAt).toLocaleString("ko-KR")}
            {session.lastIngestOk === false ? " · 실패" : session.lastIngestOk ? " · 성공" : ""}
          </span>
        ) : null}
      </div>

      {!session ? (
        <div className="space-y-2">
          <p className="text-[11px] text-neutral-300 leading-relaxed">
            toona 계정으로 로그인하면 youtube-git 연동(시나리오 B·후원자 리스트 반영)·시그 가져오기가
            함께 됩니다. 비밀번호는 서버에서만 사용하며 저장하지 않습니다.
          </p>
          <label className="block text-[11px] text-neutral-400">
            toona API Base URL
            <input
              className="mt-0.5 w-full rounded bg-black/40 border border-white/15 px-2 py-1.5 text-sm font-mono text-neutral-100"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:4000"
            />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <label className="block text-[11px] text-neutral-400">
              이메일
              <input
                className="mt-0.5 w-full rounded bg-black/40 border border-white/15 px-2 py-1.5 text-sm text-neutral-100"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="block text-[11px] text-neutral-400">
              비밀번호
              <input
                type="password"
                className="mt-0.5 w-full rounded bg-black/40 border border-white/15 px-2 py-1.5 text-sm text-neutral-100"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </label>
          </div>
          <button
            type="button"
            disabled={busy || !email.trim() || !password}
            className="px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-xs font-semibold disabled:opacity-50"
            onClick={() => void onLogin()}
          >
            {busy ? "연결 중…" : "toona 로그인 · 연동"}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-[11px] text-neutral-300 leading-relaxed space-y-0.5">
            <div>
              계정: <span className="text-violet-100">{session.displayName || session.email}</span> (
              {session.email})
            </div>
            <div>
              streamKey: <code className="text-violet-100">{session.streamKey}</code>
            </div>
            <div>
              youtube u= <code className="text-violet-100">{session.youtubeUserId || youtubeUserId}</code>
            </div>
            <div>연결 시각: {new Date(session.linkedAt).toLocaleString("ko-KR")}</div>
            {session.lastStatusError ? (
              <div className="text-rose-300">상태 오류: {session.lastStatusError}</div>
            ) : null}
            {session.lastIngestError ? (
              <div className="text-amber-200">ingest 오류: {session.lastIngestError}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-xs font-semibold disabled:opacity-50"
              onClick={() => void load(true)}
            >
              상태 새로고침
            </button>
            <button
              type="button"
              disabled={busy}
              className="px-3 py-1.5 rounded bg-violet-800/80 hover:bg-violet-700 text-xs font-semibold disabled:opacity-50"
              onClick={() => void onImportSigs()}
            >
              시그 다시 가져오기
            </button>
            <button
              type="button"
              disabled={busy}
              className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs disabled:opacity-50"
              onClick={() => void onSyncLogs()}
            >
              후원 로그 동기화
            </button>
            <a
              href={`${session.baseUrl.replace(/\/$/, "")}/dashboard/alert`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
            >
              toona 투네·알림창
            </a>
            <button
              type="button"
              disabled={busy}
              className="px-3 py-1.5 rounded bg-rose-900/70 hover:bg-rose-800 text-xs disabled:opacity-50"
              onClick={() => void onLogout()}
            >
              연결 해제
            </button>
          </div>
        </div>
      )}

      {session ? (
        <div className="rounded border border-white/10 bg-black/25 p-2">
          <div className="text-xs text-neutral-400 mb-2">
            로그인 이후 후원 로그 ({logs.length})
          </div>
          <div className="max-h-[200px] overflow-auto space-y-1 pr-1">
            {logs.length === 0 ? (
              <div className="text-[11px] text-neutral-500">아직 수신된 후원이 없습니다.</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="text-[11px] text-neutral-300 flex flex-wrap gap-x-2">
                  <span className="text-neutral-500 tabular-nums">
                    {new Date(log.at).toLocaleTimeString("ko-KR", { hour12: false })}
                  </span>
                  <span className="text-white">{log.donorName}</span>
                  {log.playerName ? <span>→ {log.playerName}</span> : null}
                  <span className="text-cyan-200">{log.amount.toLocaleString("ko-KR")}</span>
                  <span className="text-neutral-500">
                    {log.target === "account" ? "계좌" : "투네"} · {log.source}
                    {log.mode === "alert_only"
                      ? " · 알림만(리스트 미반영)"
                      : log.mode === "excel"
                        ? log.applied
                          ? " · 리스트 반영"
                          : " · 대기열"
                        : log.mode
                          ? ` · ${log.mode}`
                          : ""}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}

      {message ? <p className="text-[11px] text-neutral-300">{message}</p> : null}
    </div>
  );
}
