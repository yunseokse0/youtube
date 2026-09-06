"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export type DinHubMissingDonationsModalProps = {
  open: boolean;
  onClose: () => void;
  userId: string;
};

type HubLog = { id: string; at?: number; donorName?: string; amount?: number; target?: "account" | "toon"; message?: string };
type MissingDonation = { id: string; at: string; donorName: string; accountType: string; amount: number; message: string };
type TabId = "status" | "import";

const RANGE_OPTS = [
  { id: "24h", label: "최근 24시간", ms: 86400000 },
  { id: "72h", label: "최근 72시간", ms: 259200000 },
  { id: "7d", label: "최근 7일", ms: 604800000 },
];
const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "status", label: "누락 현황", icon: "📋" },
  { id: "import", label: "수동 가져오기", icon: "⬇️" },
];
const fmtTime = (ms: number) => {
  if (!ms) return "-";
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fmtAmt = (n: number) => (typeof n === "number" && isFinite(n) ? n.toLocaleString("ko-KR") : "0");

export default function DinHubMissingDonationsModal({ open, onClose, userId }: DinHubMissingDonationsModalProps) {
  const [mounted, setMounted] = useState(false);
  const bdr = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<TabId>("status");
  const [sc, setSc] = useState<string | null>(null);
  const [scOk, setScOk] = useState(false);
  const [range, setRange] = useState("24h");
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState("");
  const [list, setList] = useState<MissingDonation[]>([]);
  const [hubN, setHubN] = useState(0);
  const [appN, setAppN] = useState(0);
  const [iBusy, setIBusy] = useState(false);
  const [iRes, setIRes] = useState("");
  const [iRaw, setIRaw] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", k);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !userId) return;
    setScOk(false); setSc(null); setRMsg(""); setList([]); setHubN(0); setAppN(0); setIRes(""); setIRaw(""); setTab("status");
    const ctrl = new AbortController();
    const tm = window.setTimeout(() => ctrl.abort(), 10000);
    (async () => {
      try {
        const res = await fetch("/api/toona/hub", { credentials: "include", signal: ctrl.signal });
        window.clearTimeout(tm);
        const d = (await res.json().catch(() => ({}))) as { scenario?: string };
        setSc(d.scenario ?? null);
      } catch { window.clearTimeout(tm); }
      setScOk(true);
    })();
    return () => { window.clearTimeout(tm); ctrl.abort(); };
  }, [open, userId]);

  const refresh = async () => {
    setRBusy(true); setRMsg(""); setList([]); setHubN(0); setAppN(0);
    const ro = RANGE_OPTS.find(r => r.id === range) ?? RANGE_OPTS[0];
    const cutoff = Date.now() - ro.ms;
    const ctrl = new AbortController();
    const tm = window.setTimeout(() => ctrl.abort(), 20000);
    try {
      const [sr, hr] = await Promise.all([
        fetch(`/api/state?u=${encodeURIComponent(userId)}`, { credentials: "include", signal: ctrl.signal }),
        fetch("/api/toona/hub", { credentials: "include", signal: ctrl.signal }),
      ]);
      window.clearTimeout(tm);
      if (!sr.ok) { setRMsg(`상태 조회 실패 (HTTP ${sr.status})`); return; }
      if (!hr.ok) { setRMsg(`허브 로그 조회 실패 (HTTP ${hr.status})`); return; }
      const sd = (await sr.json().catch(() => ({}))) as { donors?: { id?: string }[] };
      const hd = (await hr.json().catch(() => ({}))) as { donationLogs?: HubLog[]; logs?: HubLog[] };
      const ids = new Set<string>();
      if (Array.isArray(sd.donors)) for (const x of sd.donors) if (x?.id) ids.add(String(x.id));
      const logs: HubLog[] = Array.isArray(hd.donationLogs) ? hd.donationLogs : Array.isArray(hd.logs) ? hd.logs : [];
      const filt = logs.filter(l => l.id && (typeof l.at !== "number" || l.at >= cutoff));
      let an = 0;
      const miss: MissingDonation[] = [];
      for (const l of filt) {
        if (ids.has(String(l.id))) { an++; continue; }
        miss.push({
          id: String(l.id), at: fmtTime(l.at ?? 0), donorName: l.donorName?.toString() ?? "-",
          accountType: l.target === "toon" ? "툰" : l.target === "account" ? "계좌" : "-",
          amount: typeof l.amount === "number" ? l.amount : 0, message: l.message?.toString() ?? "",
        });
      }
      setHubN(filt.length); setAppN(an); setList(miss);
      setRMsg(`총 hub 로그 ${filt.length}건 · 반영된 ${an}건 · ❓ 누락 ${miss.length}건`);
    } catch (e) {
      window.clearTimeout(tm);
      setRMsg(e instanceof DOMException && e.name === "AbortError" ? "요청 타임아웃" : "네트워크 오류");
    } finally { setRBusy(false); }
  };

  const doImport = async () => {
    setIBusy(true); setIRes(""); setIRaw("");
    const ctrl = new AbortController();
    const tm = window.setTimeout(() => ctrl.abort(), 60000);
    try {
      const res = await fetch("/api/toona/hub?force=1", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync-donations" }), signal: ctrl.signal,
      });
      window.clearTimeout(tm);
      const text = await res.text().catch(() => "");
      setIRaw(text);
      if (res.status === 429) { setIRes("이미 가져오는 중입니다. 잠시만 기다려 주세요."); return; }
      if (!res.ok) { setIRes(`실패 (HTTP ${res.status})`); return; }
      let p: any = null;
      try { p = JSON.parse(text); } catch { setIRes(text || "완료"); return; }
      if (p && typeof p === "object") {
        const f = typeof p.fetched === "number" ? p.fetched : null;
        const a = typeof p.applied === "number" ? p.applied : null;
        const d = typeof p.duplicates === "number" ? p.duplicates : null;
        const s = typeof p.skipped === "number" ? p.skipped : null;
        const parts: string[] = [];
        if (f !== null) parts.push(`가져옴 ${f}건`);
        if (a !== null) parts.push(`반영 ${a}건`);
        if (d !== null) parts.push(`중복 ${d}건`);
        if (s !== null) parts.push(`건너뜀 ${s}건`);
        setIRes(parts.length ? `완료! ${parts.join(" · ")}` : text || "완료");
      } else setIRes(text || "완료");
    } catch (e) {
      window.clearTimeout(tm);
      setIRes(e instanceof DOMException && e.name === "AbortError" ? "요청 타임아웃" : "네트워크 오류");
    } finally { setIBusy(false); }
  };

  const onBd = (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === bdr.current) onClose(); };
  const reload = () => { onClose(); if (typeof window !== "undefined") window.location.reload(); };

  if (!mounted || !open) return null;
  const isB = scOk && sc === "B";
  const warn = scOk && sc !== null && sc !== "B";
  const $c = "flex w-full flex-col rounded-lg border text-white shadow-2xl";
  const $s = { maxWidth: 720, height: "80vh", background: "#1f1f1f", borderColor: "#333" } as const;
  const $hdr = "flex shrink-0 items-center justify-between border-b px-4 py-3";
  const $bdr = { borderColor: "#333" };
  const $btn = "rounded px-3 py-1.5 text-sm font-bold hover:opacity-80";
  const $bs = { background: "#333", color: "#fff", border: "1px solid #444" };

  return createPortal(
    <div ref={bdr} onClick={onBd} className="fixed inset-0 z-[500] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.8)" }}>
      <div className={$c} style={$s}>
        <header className={$hdr} style={$bdr}>
          <div>
            <h2 className="text-base font-bold" style={{ color: "#fff" }}>B모드 DIN 허브 · 누락 후원 가져오기</h2>
            <p className="text-xs mt-0.5" style={{ color: "#999" }}>누락된 후원 로그를 확인하고 강제로 가져옵니다</p>
          </div>
          <button type="button" onClick={onClose} className={$btn} style={$bs} aria-label="닫기">×</button>
        </header>

        {warn && (
          <div className="mx-4 mt-4 rounded border p-3 text-sm shrink-0" style={{ background: "rgba(220,38,38,0.15)", borderColor: "#dc2626", color: "#fca5a5" }}>
            ⚠️ 현재 A모드 (투네 직접 연결) 입니다. TOONA_INTAKE_MODE=B 또는 DIN 허브와 연동한 상태에서만 사용하세요.
          </div>
        )}

        {scOk && !warn && (
          <>
            <nav className="flex shrink-0 gap-2 border-b px-3 py-2" style={$bdr}>
              {TABS.map(t => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} className="rounded-md px-3 py-2 text-sm font-medium whitespace-nowrap"
                  style={tab === t.id ? { background: "#4f46e5", color: "#fff" } : { background: "rgba(255,255,255,0.05)", color: "#ccc" }}>
                  <span className="mr-1">{t.icon}</span>{t.label}
                </button>
              ))}
            </nav>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
              {tab === "status" && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-3 rounded border p-3" style={{ borderColor: "#333", background: "#1a1a1a" }}>
                    <label htmlFor="dh-r" className="text-sm font-medium" style={{ color: "#ddd" }}>범위</label>
                    <select id="dh-r" value={range} onChange={e => setRange(e.target.value)} className="rounded px-2 py-1.5 text-sm"
                      style={{ background: "#2a2a2a", color: "#fff", border: "1px solid #444" }}>
                      {RANGE_OPTS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </select>
                    <button type="button" onClick={refresh} disabled={rBusy} className="rounded px-3 py-1.5 text-sm font-bold disabled:opacity-50"
                      style={{ background: "#2563eb", color: "#fff", border: "1px solid #3b82f6" }}>
                      {rBusy ? "조회 중..." : "새로고침"}
                    </button>
                    {rMsg && <span className="text-sm" style={{ color: "#ccc" }}>{rMsg}</span>}
                  </div>
                  <div className="overflow-x-auto rounded border" style={{ borderColor: "#333" }}>
                    <table className="w-full text-sm border-collapse">
                      <thead><tr style={{ background: "#222" }}>
                        {["시간", "후원자", "계좌타입", "금액", "메시지", "상태"].map((h, i) => (
                          <th key={h} className={"px-3 py-2 font-semibold " + (i === 3 ? "text-right" : "text-left")}
                            style={{ borderBottom: "1px solid #333", color: "#ddd" }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {list.length === 0 ? (
                          <tr><td colSpan={6} className="px-3 py-8 text-center" style={{ color: "#777" }}>
                            {rBusy ? "조회 중..." : rMsg ? "— 데이터 없음 · 새로고침을 눌러주세요 —" : "— 누락된 후원이 없습니다 —"}
                          </td></tr>
                        ) : list.map(m => (
                          <tr key={m.id} style={{ borderBottom: "1px solid #2a2a2a" }}>
                            <td className="px-3 py-2" style={{ color: "#bbb", whiteSpace: "nowrap" }}>{m.at}</td>
                            <td className="px-3 py-2" style={{ color: "#fff" }}>{m.donorName}</td>
                            <td className="px-3 py-2" style={{ color: "#bbb" }}>{m.accountType}</td>
                            <td className="px-3 py-2 text-right" style={{ color: "#fde68a" }}>₩{fmtAmt(m.amount)}</td>
                            <td className="px-3 py-2 max-w-[180px]" style={{ color: "#ccc" }}>
                              <div className="truncate" title={m.message}>{m.message || "-"}</div>
                            </td>
                            <td className="px-3 py-2" style={{ color: "#f97316", fontWeight: 600 }}>누락됨</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {tab === "import" && (
                <div className="flex flex-col gap-4">
                  <div className="rounded border p-3 text-sm" style={{ borderColor: "#333", background: "#1a1a1a", color: "#ccc" }}>
                    강제로 DIN 허브에서 후원 로그를 다시 가져옵니다. (평소 60s 쿨다운 무시)
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={doImport} disabled={iBusy} className="rounded px-4 py-2 text-sm font-bold disabled:opacity-50"
                      style={{ background: "#059669", color: "#fff", border: "1px solid #10b981" }}>
                      {iBusy ? "가져오는 중..." : "지금 즉시 후원 가져오기 (force=1)"}
                    </button>
                  </div>
                  {iRes && (
                    <div className="rounded border p-3 text-sm" style={{ borderColor: "#333", background: "#1a1a1a", color: "#ddd" }}>
                      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{iRes}</div>
                      {iRaw && iRes !== iRaw && (
                        <details className="mt-2">
                          <summary style={{ cursor: "pointer", color: "#888" }}>원본 응답 보기</summary>
                          <pre className="mt-2 rounded p-2 text-xs overflow-x-auto" style={{ background: "#111", color: "#aaa" }}>{iRaw}</pre>
                        </details>
                      )}
                    </div>
                  )}
                  {!iBusy && iRes && iRes.includes("완료") && (
                    <div className="rounded border p-3" style={{ borderColor: "#059669", background: "rgba(5,150,105,0.1)" }}>
                      <div className="text-sm font-medium mb-2" style={{ color: "#6ee7b7" }}>✅ 가져오기 완료</div>
                      <button type="button" onClick={reload} className="rounded px-3 py-1.5 text-sm font-bold"
                        style={{ background: "#059669", color: "#fff", border: "1px solid #10b981" }}>
                        리스트 닫고 후원 목록 새로고침 (location.reload())
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
