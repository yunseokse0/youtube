"use client";

import { useCallback, useEffect, useState } from "react";
import { getToonaDashboardUrl } from "@/lib/donation-ingest-mode";
import { ingestErrorVisibleAfterLink } from "@/lib/toona-hub-ingest-error";
import { loadStateFromApi, saveState } from "@/lib/state";
import { TOONA_HUB_CLIENT_CONNECT_TIMEOUT_MS } from "@/lib/toona-hub-login";
import {
  triggerAndPollSigImport,
  formatSigImportResultMessage,
  type SigImportSummary,
} from "@/lib/toona-sig-import-client";

const SIG_INVENTORY_IMPORTED_EVENT = "youtube-sig-inventory-imported";
/** 정산 리셋 등 — 세션은 유지한 채 로그/커서만 바뀐 뒤 패널 재조회 */
export const TOONA_HUB_REFRESH_EVENT = "youtube-toona-hub-refresh";

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
  lastSigImport?: SigImportSummary | null;
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
  onLoggedIn?: () => void;
};

function formatSigImport(sig: SigImportResult | undefined): string {
  if (!sig) return "";
  if (sig.error === "deferred") return "";
  if (sig.ok === false) return `시그 가져오기 실패: ${sig.error || "unknown"}`;
  return `시그 ${sig.count ?? 0}개 병합 (추가 ${sig.added ?? 0} · 갱신 ${sig.updated ?? 0})`;
}

export default function ToonaHubPanel({ youtubeUserId, onLoggedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [streamKey, setStreamKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(getToonaDashboardUrl());
  const [busy, setBusy] = useState(false);
  const [sigImportBusy, setSigImportBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"info" | "success" | "error" | "running">("info");
  const [session, setSession] = useState<HubSession | null>(null);
  const [logs, setLogs] = useState<HubLog[]>([]);
  const [showStreamKeyFallback, setShowStreamKeyFallback] = useState(false);
  const [currentSigCount, setCurrentSigCount] = useState<number | null>(null);

  // 로컬 저장소에서 현재 시그 개수 초기값 로드
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`youtube_state_${youtubeUserId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.sigInventory)) {
          setCurrentSigCount(parsed.sigInventory.length);
        }
      }
    } catch {
      /* noop */
    }
  }, [youtubeUserId]);

  const applyPayload = useCallback(
    (data: { session?: HubSession | null; logs?: HubLog[]; currentSigCount?: number }) => {
      setSession(data.session ?? null);
      setLogs(Array.isArray(data.logs) ? data.logs : []);
      if (typeof data.currentSigCount === "number") {
        setCurrentSigCount(data.currentSigCount);
      } else if (data.session?.lastSigImport?.totalCount) {
        setCurrentSigCount(data.session.lastSigImport.totalCount);
      }
    },
    []
  );

  const load = useCallback(
    async (refresh = false) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const res = await fetch(`/api/toona/hub${refresh ? "?refresh=1" : ""}`, {
          credentials: "include",
          signal: controller.signal,
        });
        window.clearTimeout(timeout);
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          session?: HubSession | null;
          logs?: HubLog[];
          currentSigCount?: number;
          error?: string;
          slow?: boolean;
        };
        if (!res.ok || data.ok === false) {
          setMessage(data.error || `상태 조회 실패 (HTTP ${res.status})`);
          setMessageType("error");
          return {
            ok: false,
            slow: data.slow === true,
            status: res.status,
            session: data.session ?? null,
          } as const;
        }
        applyPayload(data);
        if (data.session?.email) setEmail(data.session.email);
        if (data.session?.streamKey) setStreamKey(data.session.streamKey);
        if (data.session?.baseUrl) setBaseUrl(data.session.baseUrl);
        if (data.error) {
          setMessage(data.error);
          setMessageType("error");
        } else if (!refresh) {
          // 메시지는 사용자가 조작 중인 결과 알림을 덮어쓰지 않도록 초기화하지 않음
        }
        return { ok: true, slow: data.slow === true, status: res.status, session: data.session ?? null } as const;
      } catch (err) {
        window.clearTimeout(timeout);
        const msg =
          err instanceof DOMException && err.name === "AbortError"
            ? "허브 폴링 타임아웃 (15초 초과)"
            : "네트워크 오류 — 잠시 후 재시도";
        setMessage(msg);
        setMessageType("error");
        return { ok: false, slow: true, status: 0, session: null } as const;
      }
    },
    [applyPayload]
  );

  useEffect(() => {
    void load(false);
  }, [load, youtubeUserId]);

  useEffect(() => {
    const onRefresh = () => {
      void load(true);
    };
    window.addEventListener(TOONA_HUB_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(TOONA_HUB_REFRESH_EVENT, onRefresh);
  }, [load]);

  useEffect(() => {
    if (!session) return;
    /** refresh=1 은 toona 외부 API+후원 sync — 겹치면 Node/MySQL 풀이 막혀 504→502 연쇄 */
    let inFlight = false;
    let stopped = false;
    let backoffMs = 30_000;
    let handle: number | undefined;
    const scheduleNext = (nextMs: number) => {
      if (stopped) return;
      handle = window.setTimeout(tick, nextMs);
    };
    const tick = async () => {
      if (stopped) return;
      if (inFlight) {
        scheduleNext(backoffMs);
        return;
      }
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        scheduleNext(60_000);
        return;
      }
      inFlight = true;
      try {
        const result = await load(true);
        if (result?.ok && !result?.slow) {
          backoffMs = 30_000;
        } else {
          backoffMs = Math.min(120_000, Math.floor(backoffMs * 1.6) + 10_000);
        }
      } catch {
        backoffMs = Math.min(180_000, Math.floor(backoffMs * 2) + 15_000);
      } finally {
        inFlight = false;
        scheduleNext(backoffMs);
      }
    };
    scheduleNext(30_000);
    return () => {
      stopped = true;
      if (handle) window.clearTimeout(handle);
    };
  }, [session, load]);

  const syncLocalSigInventory = useCallback(async () => {
    try {
      const remote = await loadStateFromApi(youtubeUserId, { forceFull: true });
      if (remote) {
        saveState(remote, youtubeUserId);
        if (Array.isArray(remote.sigInventory)) {
          setCurrentSigCount(remote.sigInventory.length);
        }
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

  const onLogin = async (mode: "email" | "streamKey" = "email") => {
    setBusy(true);
    setMessage("");
    setMessageType("info");
    try {
      const body =
        mode === "streamKey"
          ? { streamKey, baseUrl }
          : { email, password, baseUrl };
      const res = await fetch("/api/toona/hub", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        /** 서버 무응답·후처리 지연 시 「연결 중…」고착 방지 */
        signal: AbortSignal.timeout(TOONA_HUB_CLIENT_CONNECT_TIMEOUT_MS),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        session?: HubSession | null;
        logs?: HubLog[];
        sigImport?: SigImportResult;
      };
      if (!res.ok || !data.ok) {
        const recovered = await load(false);
        if (recovered.ok && recovered.session?.streamKey) {
          setMessage(
            mode === "streamKey"
              ? "스트림 키로 DIN 허브 연결 완료"
              : "toona 로그인·연동 완료"
          );
          setMessageType("success");
          if (typeof onLoggedIn === "function") {
            try {
              onLoggedIn();
            } catch (_) {
              /* noop */
            }
          }
          return;
        }
        const err = String(data.error || "");
        setMessage(
          err === "login_required" || err === "unauthorized"
            ? "관리자 로그인이 필요합니다. 다시 로그인해 주세요."
            : res.status === 502 || res.status === 504
              ? "서버가 응답하지 못했습니다(502/504). 잠시 후 다시 연결해 주세요."
              : err || (mode === "streamKey" ? "연결 실패" : "로그인 실패")
        );
        setMessageType("error");
        return;
      }
      if (mode === "email") setPassword("");
      applyPayload(data);
      if (data.sigImport?.ok) {
        await syncLocalSigInventory();
      }
      const sigMsg = formatSigImport(data.sigImport);
      const doneLabel = mode === "streamKey" ? "스트림 키 연결 완료" : "toona 로그인·연동 완료";
      setMessage(
        sigMsg
          ? `${doneLabel} · ${sigMsg}`
          : data.sigImport?.error === "deferred"
            ? `${doneLabel} · 시그 가져오기는 백그라운드에서 진행 중`
            : mode === "streamKey"
              ? "스트림 키로 DIN 허브 연결 완료"
              : "toona 로그인·youtubegit 연동 완료"
      );
      setMessageType("success");
      if (typeof onLoggedIn === "function") {
        try {
          onLoggedIn();
        } catch (_) {
          /* noop */
        }
      }
    } catch (err) {
      const timedOut =
        err instanceof Error &&
        (err.name === "TimeoutError" || err.name === "AbortError");
      setMessage(
        timedOut
          ? "연결 시간 초과 — youtube 서버(/api/toona/hub) 응답이 없습니다. EC2 상태를 확인하세요."
          : err instanceof Error
            ? err.message
            : mode === "streamKey"
              ? "연결 실패"
              : "로그인 실패"
      );
      setMessageType("error");
    } finally {
      setBusy(false);
    }
  };

  const onLogout = async () => {
    setBusy(true);
    setMessage("");
    setMessageType("info");
    try {
      await fetch("/api/toona/hub", { method: "DELETE", credentials: "include" });
      setSession(null);
      setLogs([]);
      setStreamKey("");
      setPassword("");
      setMessage("허브 연결을 해제했습니다.");
      setMessageType("info");
    } finally {
      setBusy(false);
    }
  };

  const onSyncLogs = async () => {
    setBusy(true);
    setMessage("");
    setMessageType("info");
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
        applied?: number;
        session?: HubSession | null;
        logs?: HubLog[];
      };
      if (!res.ok || !data.ok) {
        setMessage(data.error || "후원 동기화 실패");
        setMessageType("error");
        return;
      }
      applyPayload(data);
      setMessage(
        `toona 후원 ${data.imported ?? 0}건 확인 · 엑셀 신규 반영 ${data.applied ?? 0}건 (시나리오 B·1:1)`
      );
      setMessageType("success");
    } finally {
      setBusy(false);
    }
  };

  const onImportSigs = async () => {
    setSigImportBusy(true);
    setMessage("시그 가져오기 진행 중... (toona에서 시그 목록을 조회하고 엑셀 방송 시스템에 병합 중)");
    setMessageType("running");

    try {
      const res = await triggerAndPollSigImport((stage) => {
        setMessage(`시그 가져오기 진행 중... (${stage})`);
        setMessageType("running");
      });

      await syncLocalSigInventory();

      if (res.ok && res.summary) {
        if (typeof res.summary.totalCount === "number") {
          setCurrentSigCount(res.summary.totalCount);
        }
        setMessage(`✅ ${formatSigImportResultMessage(res.summary)}`);
        setMessageType("success");
        // 세션 정보도 최신화
        void load(false);
      } else {
        setMessage(`❌ ${res.error || "시그 가져오기 실패"}`);
        setMessageType("error");
      }
    } catch (err) {
      setMessage(`❌ 시그 가져오기 오류: ${err instanceof Error ? err.message : "네트워크 오류"}`);
      setMessageType("error");
    } finally {
      setSigImportBusy(false);
    }
  };

  const ingestError = session ? ingestErrorVisibleAfterLink(session) : null;

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
            {ingestError ? " · 실패" : session.lastIngestOk ? " · 성공" : ""}
          </span>
        ) : null}
      </div>

      {!session ? (
        <div className="space-y-2">
          <p className="text-[11px] text-neutral-300 leading-relaxed">
            toona 계정으로 로그인하면 후원 1:1 엑셀 반영·시그 가져오기가 함께 됩니다. 비밀번호는 서버에서만
            사용하며 저장하지 않습니다.
          </p>
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
            onClick={() => void onLogin("email")}
          >
            {busy ? "연결 중…" : "toona 로그인 · 연동"}
          </button>
          <button
            type="button"
            className="block text-[10px] text-neutral-500 hover:text-neutral-300 underline-offset-2 hover:underline"
            onClick={() => setShowStreamKeyFallback((v) => !v)}
          >
            {showStreamKeyFallback ? "스트림 키 연결 숨기기" : "스트림 키로 연결 (대체)"}
          </button>
          {showStreamKeyFallback ? (
            <div className="space-y-2 rounded border border-white/10 bg-black/20 p-2">
              <label className="block text-[11px] text-neutral-400">
                스트림 키
                <input
                  className="mt-0.5 w-full rounded bg-black/40 border border-white/15 px-2 py-1.5 text-sm font-mono text-neutral-100"
                  value={streamKey}
                  onChange={(e) => setStreamKey(e.target.value)}
                  placeholder="toona 스트림 키"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <button
                type="button"
                disabled={busy || !streamKey.trim()}
                className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs font-semibold disabled:opacity-50"
                onClick={() => void onLogin("streamKey")}
              >
                {busy ? "연결 중…" : "스트림 키로 연결"}
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="text-[11px] text-neutral-300 leading-relaxed space-y-0.5">
            <div>
              계정:{" "}
              <span className="text-violet-100">{session.displayName || session.email || "스트림 키"}</span>
              {session.email ? ` (${session.email})` : null}
            </div>
            <div>
              스트림 키: <code className="text-violet-100">{session.streamKey}</code>
            </div>
            <div>
              youtube u= <code className="text-violet-100">{session.youtubeUserId || youtubeUserId}</code>
            </div>
            <div>연결 시각: {new Date(session.linkedAt).toLocaleString("ko-KR")}</div>
            {session.lastStatusError ? (
              <div className="text-rose-300">상태 오류: {session.lastStatusError}</div>
            ) : null}
            {ingestError ? (
              <div className="text-amber-200">ingest 오류: {ingestError}</div>
            ) : null}
          </div>

          {/* 시그 등록 및 동기화 현황 정보 카드 */}
          <div className="rounded border border-violet-500/30 bg-black/30 p-2.5 space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-violet-200">🎨 등록된 시그 현황</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-violet-900/60 text-violet-100 border border-violet-500/40 tabular-nums">
                  총 {currentSigCount !== null ? `${currentSigCount}개` : "확인 중…"}
                </span>
                {sigImportBusy && (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300 font-semibold animate-pulse">
                    <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
                    가져오는 중…
                  </span>
                )}
              </div>
              {session.lastSigImport?.at ? (
                <span className="text-[11px] text-neutral-400">
                  마지막 동기화:{" "}
                  {new Date(session.lastSigImport.at).toLocaleString("ko-KR", {
                    month: "numeric",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              ) : null}
            </div>

            {session.lastSigImport && (
              <div className="text-[11px] text-neutral-300 flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 border-t border-white/5">
                {session.lastSigImport.status === "completed" ? (
                  <>
                    <span className="text-emerald-400 font-semibold">동기화 성공</span>
                    <span className="text-neutral-500">·</span>
                    <span>toona 확인: <strong className="text-white">{session.lastSigImport.fetchedCount}개</strong></span>
                    <span className="text-neutral-500">·</span>
                    <span>신규 추가: <strong className="text-emerald-300">+{session.lastSigImport.addedCount}개</strong></span>
                    <span className="text-neutral-500">·</span>
                    <span>기존 갱신: <strong className="text-cyan-300">{session.lastSigImport.updatedCount}개</strong></span>
                  </>
                ) : session.lastSigImport.status === "running" ? (
                  <span className="text-amber-300">현재 백그라운드에서 시그 목록을 동기화 중입니다…</span>
                ) : session.lastSigImport.status === "failed" ? (
                  <span className="text-rose-400">마지막 가져오기 실패: {session.lastSigImport.error}</span>
                ) : null}
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || sigImportBusy}
              className="px-3 py-1.5 rounded bg-violet-700 hover:bg-violet-600 text-xs font-semibold disabled:opacity-50"
              onClick={() => void load(true)}
            >
              상태 새로고침
            </button>
            <button
              type="button"
              disabled={busy || sigImportBusy}
              className="px-3 py-1.5 rounded bg-violet-800 hover:bg-violet-700 text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-1.5 shadow-sm"
              onClick={() => void onImportSigs()}
            >
              {sigImportBusy ? (
                <>
                  <span className="inline-block w-2.5 h-2.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>시그 가져오는 중…</span>
                </>
              ) : (
                "시그 다시 가져오기"
              )}
            </button>
            <button
              type="button"
              disabled={busy || sigImportBusy}
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
              disabled={busy || sigImportBusy}
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
            연결 이후 후원 로그 ({logs.length})
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

      {message ? (
        <div
          className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
            messageType === "success"
              ? "border-emerald-500/40 bg-emerald-950/40 text-emerald-200"
              : messageType === "error"
                ? "border-rose-500/40 bg-rose-950/40 text-rose-200"
                : messageType === "running"
                  ? "border-amber-500/40 bg-amber-950/40 text-amber-200"
                  : "border-white/10 bg-black/30 text-neutral-300"
          }`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
