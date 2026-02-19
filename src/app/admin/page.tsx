"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import MemberRow from "@/components/MemberRow";
import Toast from "@/components/Toast";
import {
  AppState,
  Member,
  Donor,
  DonorTarget,
  defaultState,
  loadState,
  saveState,
  saveStateAsync,
  loadStateFromApi,
  totalAccount,
  appendDailyLog,
  parseTenThousandThousand,
  maskTenThousandThousandInput,
  formatChatLine,
  STORAGE_KEY,
  DAILY_LOG_KEY,
  loadDailyLog,
  DailyLogEntry,
  formatManThousand,
  confirmHighAmount,
  appendForbidEvent,
  loadForbidEvents,
  FORBID_EVENTS_KEY,
} from "@/lib/state";
import {
  startYoutubePolling,
  OnForbidden,
  getPreferredLiveChatId,
  getSavedVideoUrl,
  setYoutubeVideoUrl,
  clearPreferredLiveChatId,
  getPreferredApiKey,
  setPreferredApiKey,
  clearPreferredApiKey,
} from "@/lib/youtube";
import Link from "next/link";

export default function AdminPage() {
  const [state, setState] = useState<AppState>(defaultState());
  const [syncStatus, setSyncStatus] = useState<"loading" | "synced" | "local" | "error">("loading");
  const [dailyLog, setDailyLog] = useState<Record<string, DailyLogEntry[]>>({});
  const [donorName, setDonorName] = useState("");
  const [donorAmount, setDonorAmount] = useState("");
  const [donorMemberId, setDonorMemberId] = useState<string | null>(null);
  const [donorTarget, setDonorTarget] = useState<DonorTarget>("account");
  const [copied, setCopied] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatDraftDirty, setChatDraftDirty] = useState(false);
  const [forbiddenText, setForbiddenText] = useState("");
  const [events, setEvents] = useState<Array<{ at: number; author: string; message: string; word: string }>>([]);
  const forbidEditRef = useRef<HTMLTextAreaElement | null>(null);
  const [ytUrl, setYtUrl] = useState("");
  const [liveChatId, setLiveChatId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  type OverlayPreset = {
    id: string; name: string; scale: string; memberSize: string; totalSize: string;
    dense: boolean; anchor: string; sumAnchor: string; sumFree: boolean; sumX: string; sumY: string;
    theme: string; showMembers: boolean; showTotal: boolean;
    showGoal: boolean; goal: string; goalLabel: string; goalWidth: string; goalAnchor: string;
    showTicker: boolean; showTimer: boolean; timerStart: number | null; timerAnchor: string;
  };
  const PRESET_STORAGE_KEY = "excel-broadcast-overlay-presets";
  const PRESET_TEMPLATES: { name: string; preset: Partial<OverlayPreset> }[] = [
    { name: "전체 통합", preset: { showMembers: true, showTotal: true } },
    { name: "멤버 목록만", preset: { showMembers: true, showTotal: false } },
    { name: "총합만", preset: { showMembers: false, showTotal: true, totalSize: "60" } },
    { name: "목표 프로그레스바", preset: { showMembers: false, showTotal: false, showGoal: true, goal: "500000", goalLabel: "목표 금액", goalWidth: "500" } },
    { name: "후원 티커", preset: { showMembers: false, showTotal: false, showTicker: true } },
    { name: "타이머", preset: { showMembers: false, showTotal: false, showTimer: true } },
  ];
  const defaultPreset = (name: string, overrides: Partial<OverlayPreset> = {}): OverlayPreset => ({
    id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name,
    scale: "0.75", memberSize: "18", totalSize: "40", dense: true, anchor: "tl",
    sumAnchor: "bc", sumFree: false, sumX: "50", sumY: "90", theme: "default",
    showMembers: true, showTotal: true, showGoal: false, goal: "0", goalLabel: "목표 금액",
    goalWidth: "400", goalAnchor: "bc", showTicker: false, showTimer: false,
    timerStart: null, timerAnchor: "tr", ...overrides,
  });
  const [presets, setPresets] = useState<OverlayPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    setDailyLog(loadDailyLog());
    setYtUrl(getSavedVideoUrl() || "");
    setLiveChatId(getPreferredLiveChatId());
    setApiKey(getPreferredApiKey() || "");
    setEvents(loadForbidEvents());
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      if (raw) setPresets(JSON.parse(raw));
    } catch {}
    loadStateFromApi().then((apiState) => {
      if (apiState) {
        setState(apiState);
        setSyncStatus("synced");
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(apiState)); } catch {}
      } else {
        const local = loadState();
        setState(local);
        setSyncStatus("local");
        saveStateAsync(local).then((ok) => { if (ok) setSyncStatus("synced"); });
      }
    });
  }, []);

  const savePresets = (next: OverlayPreset[]) => {
    setPresets(next);
    try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next)); } catch {}
  };
  const addPreset = (name: string, overrides: Partial<OverlayPreset> = {}) => {
    const p = defaultPreset(name, overrides);
    savePresets([...presets, p]);
    setEditingId(p.id);
  };
  const updatePreset = (id: string, patch: Partial<OverlayPreset>) => {
    savePresets(presets.map(p => p.id === id ? { ...p, ...patch } : p));
  };
  const removePreset = (id: string) => {
    if (!window.confirm("이 오버레이 프리셋을 삭제할까요?")) return;
    savePresets(presets.filter(p => p.id !== id));
    if (editingId === id) setEditingId(null);
  };
  const buildOverlayUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const q: Record<string, string> = {
      scale: p.scale, memberSize: p.memberSize, totalSize: p.totalSize,
      dense: String(p.dense), anchor: p.anchor, theme: p.theme,
      showMembers: String(p.showMembers), showTotal: String(p.showTotal),
    };
    if (p.sumFree) { q.sumX = p.sumX; q.sumY = p.sumY; } else { q.sumAnchor = p.sumAnchor; }
    if (p.showGoal) { q.showGoal = "true"; q.goal = String(Math.max(0, parseInt(p.goal || "0", 10) || 0)); q.goalLabel = p.goalLabel; q.goalWidth = p.goalWidth; q.goalAnchor = p.goalAnchor; }
    if (p.showTicker) q.showTicker = "true";
    if (p.showTimer && p.timerStart) { q.showTimer = "true"; q.timerStart = String(p.timerStart); q.timerAnchor = p.timerAnchor; }
    return `${base}?${new URLSearchParams(q).toString()}`;
  };
  const copyUrl = async (url: string, id: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url); }
      else { const ta = document.createElement("textarea"); ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };

  const persistState = (s: AppState) => {
    setSyncStatus("loading");
    saveStateAsync(s).then((ok) => setSyncStatus(ok ? "synced" : "error"));
  };

  useEffect(() => {
    setChatDraft(formatChatLine(state));
    setChatDraftDirty(false);
    setForbiddenText((state.forbiddenWords || []).join("\n"));
  }, [state]);

  useEffect(() => {
    const id = setInterval(() => persistState(state), 180_000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const incoming = JSON.parse(e.newValue) as AppState;
          setState(incoming);
        } catch {
          // ignore
        }
      } else if (e.key === DAILY_LOG_KEY) {
        setDailyLog(loadDailyLog());
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  useEffect(() => {
    const stop = startYoutubePolling(state.forbiddenWords, ({ word, author, message }: Parameters<OnForbidden>[0]) => {
      const text = `금칙어(${word}) 발견 - ${author}: ${message}`;
      window.dispatchEvent(new CustomEvent("forbidden-alert", { detail: { text } }));
      setEvents((prev) => {
        const ev = { at: Date.now(), author, message, word };
        appendForbidEvent(ev);
        const next = [ev, ...prev];
        return next.slice(0, 100);
      });
    });
    return () => stop && stop();
  }, [state.forbiddenWords, liveChatId, apiKey]);

  const updateMember = (m: Member) => {
    setState((prev: AppState) => {
      const next: AppState = { ...prev, members: prev.members.map((x: Member) => (x.id === m.id ? m : x)) };
      persistState(next);
      return next;
    });
  };

  const renameMember = (id: string, name: string) => {
    setState((prev: AppState) => {
      const next: AppState = { ...prev, members: prev.members.map((x: Member) => (x.id === id ? { ...x, name } : x)) };
      persistState(next);
      return next;
    });
  };

  const resetMemberAmounts = (id: string) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        members: prev.members.map((x: Member) => (x.id === id ? { ...x, account: 0, toon: 0 } : x)),
      };
      persistState(next);
      return next;
    });
  };

  const resetAllMembersAmounts = () => {
    if (typeof window !== "undefined" && !window.confirm("모든 멤버의 계좌/투네를 0으로 리셋할까요?")) return;
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        members: prev.members.map((x: Member) => ({ ...x, account: 0, toon: 0 })),
      };
      persistState(next);
      return next;
    });
  };

  const deleteMember = (id: string) => {
    const target = state.members.find((m) => m.id === id);
    const donorsCount = state.donors.filter((d) => d.memberId === id).length;
    const warn =
      `멤버를 삭제합니다.\n` +
      `이름: ${target?.name ?? id}\n` +
      `계좌: ${target?.account ?? 0}, 투네: ${target?.toon ?? 0}\n` +
      `연결된 후원 기록: ${donorsCount}건\n\n` +
      `삭제 후에는 되돌릴 수 없습니다. 계속할까요?`;
    if (typeof window !== "undefined" && !window.confirm(warn)) return;
    setState((prev: AppState) => {
      const members = prev.members.filter((m) => m.id !== id);
      const donors = prev.donors.filter((d) => d.memberId !== id);
      const next: AppState = { ...prev, members, donors };
      persistState(next);
      return next;
    });
    if (donorMemberId === id) {
      const nextId = state.members.find((m) => m.id !== id)?.id ?? null;
      setDonorMemberId(nextId);
    }
  };

  const addMember = () => {
    const base = (newMemberName || `멤버${state.members.length + 1}`).trim();
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    setState((prev: AppState) => {
      const next: AppState = { ...prev, members: [...prev.members, { id, name: base, account: 0, toon: 0 }] };
      persistState(next);
      return next;
    });
    setNewMemberName("");
  };

  const addDonor = () => {
    const amount = parseTenThousandThousand(donorAmount);
    if (!donorMemberId) return;
    if (!confirmHighAmount(amount)) return;
    const target = donorTarget;
    setState((prev: AppState) => {
      const safeName = (donorName || "무명").replace(/\s+/g, "");
      const existingIdx = prev.donors.findIndex((d) => d.name === safeName && d.memberId === donorMemberId && (d.target || "account") === target);
      let donors: Donor[];
      if (existingIdx >= 0) {
        const updated = { ...prev.donors[existingIdx], amount: prev.donors[existingIdx].amount + amount, at: Date.now() };
        donors = prev.donors.slice();
        donors[existingIdx] = updated;
      } else {
        const donor: Donor = {
          id: `d_${Date.now()}`,
          name: safeName,
          amount,
          memberId: donorMemberId,
          at: Date.now(),
          target,
        };
        donors = [...prev.donors, donor];
      }
      const field = target === "toon" ? "toon" : "account";
      const members = prev.members.map((m: Member) =>
        m.id === donorMemberId ? { ...m, [field]: (m[field] || 0) + amount } : m
      );
      const next: AppState = { ...prev, members, donors };
      persistState(next);
      return next;
    });
    setDonorName("");
    setDonorAmount("");
  };

  useEffect(() => {
    if (!state.members.length) return;
    if (!donorMemberId) setDonorMemberId(state.members[0].id);
  }, [state.members, donorMemberId]);

  const total = useMemo(() => totalAccount(state), [state]);
  const flatLogs = useMemo(() => {
    const arr: Array<{ date: string; entry: DailyLogEntry }> = [];
    Object.entries(dailyLog).forEach(([date, entries]) => {
      (entries || []).forEach((entry) => arr.push({ date, entry }));
    });
    return arr.sort((a,b)=> (a.date === b.date ? (a.entry.at < b.entry.at ? 1 : -1) : (a.date < b.date ? 1 : -1)));
  }, [dailyLog]);

  const regenerateDraft = () => {
    setChatDraft(formatChatLine(state));
    setChatDraftDirty(false);
  };

  const onCopyDraft = async () => {
    const text = chatDraft;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      const t = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(t);
    } catch {
      // ignore
    }
  };

  const saveForbidden = () => {
    const words = forbiddenText
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);
    const uniq = Array.from(new Set(words)).slice(0, 99);
    setState((prev: AppState) => {
      const next: AppState = { ...prev, forbiddenWords: uniq };
      persistState(next);
      return next;
    });
  };

  const onReset = () => {
    appendDailyLog(state);
    setDailyLog(loadDailyLog());
    const next = defaultState();
    setState(next);
    persistState(next);
  };

  const connectYoutube = async () => {
    const { liveChatId: id } = await setYoutubeVideoUrl(ytUrl.trim());
    setLiveChatId(id);
  };
  const disconnectYoutube = () => {
    clearPreferredLiveChatId();
    setLiveChatId(null);
  };
  const saveApiKey = () => {
    setPreferredApiKey(apiKey.trim());
    // trigger polling restart via state change (already in deps)
    setApiKey(getPreferredApiKey() || "");
  };
  const clearApiKey = () => {
    clearPreferredApiKey();
    setApiKey(getPreferredApiKey() || "");
  };

  const onSnapshotNow = () => {
    appendDailyLog(state);
    setDailyLog(loadDailyLog());
  };
  const onDownloadLog = () => {
    const raw = JSON.stringify(loadDailyLog(), null, 2);
    const blob = new Blob([raw], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `daily-log-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <Toast />
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">매니저 제어판</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${syncStatus === "synced" ? "bg-emerald-900/60 text-emerald-300" : syncStatus === "loading" ? "bg-yellow-900/60 text-yellow-300" : syncStatus === "error" ? "bg-red-900/60 text-red-300" : "bg-neutral-800 text-neutral-400"}`}>
              {syncStatus === "synced" ? "서버 동기화됨" : syncStatus === "loading" ? "동기화 중..." : syncStatus === "error" ? "서버 저장 실패" : "로컬 모드"}
            </span>
          </div>
          <Link className="text-sm text-neutral-300 underline" href="/youtube">유튜브 모니터 열기</Link>
        </div>
        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-6">
            <section className="glass p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">멤버 정산 보드</h2>
                <div className="text-right">
                  <div className="text-xs text-neutral-400">계좌 총합</div>
                  <div className="text-2xl font-bold">{formatManThousand(total)}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mb-4">
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="새 멤버 이름"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                />
                <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={addMember}>
                  멤버 추가
                </button>
                <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={resetAllMembersAmounts}>
                  모든 멤버 금액 리셋
                </button>
              </div>
              <div className="space-y-3 overflow-x-auto">
                {state.members.map((m: Member) => (
                  <MemberRow key={m.id} member={m} onChange={updateMember} onRename={renameMember} onReset={resetMemberAmounts} onDelete={deleteMember} />
                ))}
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-3">후원자 기록부</h2>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] gap-3">
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="후원자 이름"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                />
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="입금액 (예: 3.5 = 35,000)"
                  inputMode="numeric"
                  value={donorAmount}
                  onChange={(e) => setDonorAmount(maskTenThousandThousandInput(e.target.value))}
                />
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={donorTarget}
                  onChange={(e) => setDonorTarget(e.target.value as DonorTarget)}
                >
                  <option value="account">계좌</option>
                  <option value="toon">투네</option>
                </select>
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={donorMemberId || ""}
                  onChange={(e) => setDonorMemberId(e.target.value)}
                >
                  {state.members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 font-semibold"
                  onClick={addDonor}
                >
                  합산 추가
                </button>
              </div>
              <div className="text-sm text-neutral-400 mt-2">입력값에 콤마/문자 포함되어도 숫자만 인식</div>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-3">채팅용 복사 & 보안</h2>
              <textarea
                className="w-full min-h-[100px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10 font-mono"
                value={chatDraft}
                onChange={(e) => { setChatDraft(e.target.value); setChatDraftDirty(true); }}
                placeholder="여기에 결과가 표시됩니다. 방송 전 텍스트를 직접 보정할 수 있어요."
              />
              <div className="flex gap-2 mt-2">
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={regenerateDraft}
                >
                  재생성
                </button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={onCopyDraft}
                >
                  복사하기
                </button>
                {copied && <span className="self-center text-emerald-400">복사됨</span>}
              </div>
              <div className="text-sm text-neutral-400 mt-2">
                HTTPS 환경에서 클립보드 API 사용. 실패 시 폴백 사용.
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-3">후원자 리스트</h2>
              <div className="max-h-[260px] overflow-auto pr-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="text-left font-medium p-1">시간</th>
                      <th className="text-left font-medium p-1">후원자</th>
                      <th className="text-left font-medium p-1">멤버</th>
                      <th className="text-left font-medium p-1">대상</th>
                      <th className="text-right font-medium p-1">금액</th>
                      <th className="text-right font-medium p-1 w-16">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.donors
                      .slice()
                      .sort((a,b)=>b.at-a.at)
                      .map((d) => {
                        const m = state.members.find((x) => x.id === d.memberId);
                        return (
                          <tr key={d.id} className="border-t border-white/10">
                            <td className="p-1 text-neutral-400">{new Date(d.at).toLocaleTimeString()}</td>
                            <td className="p-1">{d.name}</td>
                            <td className="p-1 text-neutral-300">{m?.name || d.memberId}</td>
                            <td className="p-1">{(d.target || "account") === "toon" ? <span className="text-amber-300">투네</span> : <span className="text-emerald-300">계좌</span>}</td>
                            <td className="p-1 text-right">{formatManThousand(d.amount)}</td>
                            <td className="p-1 text-right">
                              <button
                                className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                                onClick={() => {
                                  if (typeof window !== "undefined" && !window.confirm("해당 후원 기록을 삭제할까요?")) return;
                                  setState((prev: AppState) => {
                                    const donors = prev.donors.filter((x) => x.id !== d.id);
                                    const field = (d.target || "account") === "toon" ? "toon" : "account";
                                    const members = prev.members.map((mm: Member) =>
                                      mm.id === d.memberId ? { ...mm, [field]: Math.max(0, (mm[field] || 0) - d.amount) } : mm
                                    );
                                    const next: AppState = { ...prev, donors, members };
                                    persistState(next);
                                    return next;
                                  });
                                }}
                              >
                                삭제
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    {state.donors.length === 0 && (
                      <tr><td className="p-2 text-neutral-400" colSpan={6}>기록이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">오버레이 관리 (다중)</h2>
                <div className="flex gap-1 flex-wrap">
                  {PRESET_TEMPLATES.map((t) => (
                    <button key={t.name} className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs" onClick={() => addPreset(t.name, t.preset)}>+ {t.name}</button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-neutral-400 mb-3">각 오버레이는 독립 URL을 가집니다. OBS/Prism에 브라우저 소스로 각각 추가하세요.</p>
              {presets.length === 0 && (
                <div className="text-sm text-neutral-400 p-6 text-center border border-dashed border-white/10 rounded">아직 오버레이가 없습니다. 위 버튼으로 추가하세요.</div>
              )}
              <div className="space-y-3">
                {presets.map((p) => {
                  const url = buildOverlayUrl(p);
                  const isOpen = editingId === p.id;
                  return (
                    <div key={p.id} className="rounded border border-white/10 bg-neutral-900/40">
                      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setEditingId(isOpen ? null : p.id)}>
                        <span className="text-sm">{isOpen ? "▼" : "▶"}</span>
                        <input
                          className="px-2 py-0.5 rounded bg-neutral-800 border border-white/10 text-sm font-semibold flex-shrink-0 w-40"
                          value={p.name}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updatePreset(p.id, { name: e.target.value })}
                        />
                        <span className="text-xs text-neutral-500 truncate flex-1 font-mono">{url.slice(0, 80)}...</span>
                        <button className={`px-2 py-1 rounded text-xs ${copiedId === p.id ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={(e) => { e.stopPropagation(); copyUrl(url, p.id); }}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                        <button className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs" onClick={(e) => { e.stopPropagation(); removePreset(p.id); }}>삭제</button>
                      </div>
                      {isOpen && (
                        <div className="px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-3 border-t border-white/10 pt-3">
                          <div className="space-y-2">
                            <div className="grid grid-cols-[110px_1fr] items-center gap-2">
                              <label className="text-xs text-neutral-400">테마</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.theme} onChange={(e) => updatePreset(p.id, { theme: e.target.value })}>
                                <option value="default">기본</option><option value="excel">엑셀</option><option value="neon">네온</option><option value="retro">레트로</option><option value="minimal">미니멀</option><option value="rpg">RPG</option><option value="pastel">파스텔</option>
                              </select>
                              <label className="text-xs text-neutral-400">배율</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.scale} onChange={(e) => updatePreset(p.id, { scale: e.target.value })} />
                              <label className="text-xs text-neutral-400">멤버 글자(px)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.memberSize} onChange={(e) => updatePreset(p.id, { memberSize: e.target.value })} />
                              <label className="text-xs text-neutral-400">총합 글자(px)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.totalSize} onChange={(e) => updatePreset(p.id, { totalSize: e.target.value })} />
                              <label className="text-xs text-neutral-400">줄 간격</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={String(p.dense)} onChange={(e) => updatePreset(p.id, { dense: e.target.value === "true" })}>
                                <option value="true">촘촘</option><option value="false">보통</option>
                              </select>
                              <label className="text-xs text-neutral-400">목록 위치</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.anchor} onChange={(e) => updatePreset(p.id, { anchor: e.target.value })}>
                                <option value="tl">좌상</option><option value="tr">우상</option><option value="bl">좌하</option><option value="br">우하</option>
                              </select>
                              <label className="text-xs text-neutral-400">총합 위치</label>
                              <div className="flex gap-1">
                                <button className={`px-2 py-0.5 rounded border text-xs ${!p.sumFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`} onClick={() => updatePreset(p.id, { sumFree: false })}>프리셋</button>
                                <button className={`px-2 py-0.5 rounded border text-xs ${p.sumFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`} onClick={() => updatePreset(p.id, { sumFree: true })}>자유</button>
                              </div>
                              {!p.sumFree ? (
                                <>
                                  <label className="text-xs text-neutral-400">총합 앵커</label>
                                  <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.sumAnchor} onChange={(e) => updatePreset(p.id, { sumAnchor: e.target.value })}>
                                    <option value="bc">하단중앙</option><option value="tc">상단중앙</option><option value="bl">좌하</option><option value="br">우하</option><option value="tr">우상</option><option value="tl">좌상</option>
                                  </select>
                                </>
                              ) : (
                                <>
                                  <label className="text-xs text-neutral-400">X(%)</label>
                                  <div className="flex items-center gap-1"><input type="range" min="0" max="100" value={p.sumX} onChange={(e) => updatePreset(p.id, { sumX: e.target.value })} className="flex-1 accent-emerald-500" /><span className="text-xs w-8 text-center">{p.sumX}</span></div>
                                  <label className="text-xs text-neutral-400">Y(%)</label>
                                  <div className="flex items-center gap-1"><input type="range" min="0" max="100" value={p.sumY} onChange={(e) => updatePreset(p.id, { sumY: e.target.value })} className="flex-1 accent-emerald-500" /><span className="text-xs w-8 text-center">{p.sumY}</span></div>
                                </>
                              )}
                            </div>

                            <div className="h-px bg-white/10 my-1" />
                            <div className="text-xs text-neutral-400 font-semibold">요소 표시/숨김</div>
                            <div className="flex flex-wrap gap-1">
                              {([["멤버 목록", "showMembers"], ["총합", "showTotal"], ["목표바", "showGoal"], ["후원 티커", "showTicker"], ["타이머", "showTimer"]] as [string, keyof OverlayPreset][]).map(([label, key]) => (
                                <button key={key} className={`px-2 py-0.5 rounded border text-xs ${p[key] ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { [key]: !p[key] })}>{label} {p[key] ? "ON" : "OFF"}</button>
                              ))}
                            </div>

                            {p.showGoal && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">목표 금액</div>
                                <div className="grid grid-cols-[90px_1fr] items-center gap-1">
                                  <label className="text-xs text-neutral-400">목표(원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" type="number" value={p.goal} onChange={(e) => updatePreset(p.id, { goal: e.target.value })} />
                                  <label className="text-xs text-neutral-400">라벨</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalLabel} onChange={(e) => updatePreset(p.id, { goalLabel: e.target.value })} />
                                  <label className="text-xs text-neutral-400">너비(px)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalWidth} onChange={(e) => updatePreset(p.id, { goalWidth: e.target.value })} />
                                  <label className="text-xs text-neutral-400">위치</label>
                                  <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalAnchor} onChange={(e) => updatePreset(p.id, { goalAnchor: e.target.value })}>
                                    <option value="bc">하단중앙</option><option value="tc">상단중앙</option><option value="bl">좌하</option><option value="br">우하</option><option value="tl">좌상</option><option value="tr">우상</option>
                                  </select>
                                </div>
                              </>
                            )}

                            {p.showTimer && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">방송 타이머</div>
                                <div className="flex flex-wrap gap-2 items-center">
                                  <button className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: Date.now() })}>{p.timerStart ? "재시작" : "시작"}</button>
                                  {p.timerStart && <button className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: null })}>정지</button>}
                                  <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs" value={p.timerAnchor} onChange={(e) => updatePreset(p.id, { timerAnchor: e.target.value })}>
                                    <option value="tr">우상</option><option value="tl">좌상</option><option value="br">우하</option><option value="bl">좌하</option><option value="tc">상단중앙</option><option value="bc">하단중앙</option>
                                  </select>
                                </div>
                              </>
                            )}

                            <div className="h-px bg-white/10 my-1" />
                            <div className="flex items-center gap-2">
                              <input className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 font-mono text-xs" readOnly value={url} />
                              <button className={`px-2 py-1 rounded text-xs whitespace-nowrap ${copiedId === p.id ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={() => copyUrl(url, p.id)}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                            </div>
                          </div>

                          <div className="rounded border border-white/10 bg-black/70 p-2">
                            <div className="text-xs text-neutral-400 mb-1">프리뷰</div>
                            <div className="relative w-full h-[350px] rounded overflow-hidden">
                              <iframe src={url} title={`preview-${p.id}`} className="absolute inset-0 w-full h-full" style={{ background: "transparent" }} scrolling="no" />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">데이터</h2>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-2 rounded bg-red-600 hover:bg-red-500"
                    onClick={onReset}
                  >
                    정산 리셋(로그 기록)
                  </button>
                </div>
              </div>
              <div className="text-sm text-neutral-400 mt-2">
                3분마다 상태를 자동 저장합니다. 다른 탭과 실시간 동기화됩니다. 마지막 저장{" "}
                <span className="text-neutral-200">{new Date(state.updatedAt).toLocaleTimeString()}</span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `state-${new Date().toISOString().slice(0,10)}.json`;
                    a.click();
                  }}
                >상태 내보내기(JSON)</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={onSnapshotNow}
                >지금 스냅샷 기록</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={onDownloadLog}
                >히스토리 다운로드(JSON)</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => {
                    if (typeof window === "undefined") return;
                    const raw = window.localStorage.getItem("excel-broadcast-daily-log-v1") || "{}";
                    const blob = new Blob([raw], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `daily-log.json`;
                    a.click();
                  }}
                >일일 로그 내보내기(JSON)</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => {
                    const header = "at,name,member,amount\r\n";
                    const rows = state.donors
                      .map((d) => {
                        const m = state.members.find((x)=>x.id===d.memberId)?.name || d.memberId;
                        const ts = new Date(d.at).toISOString();
                        return `${ts},${d.name},${m},${d.amount}`;
                      })
                      .join("\r\n");
                    const blob = new Blob([header+rows], { type: "text/csv;charset=utf-8" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `donors.csv`;
                    a.click();
                  }}
                >후원자 내보내기(CSV)</button>
              </div>
              <div className="rounded border border-white/10 bg-neutral-900/60 mt-3 max-h-[220px] overflow-auto">
                {flatLogs.length === 0 && <div className="p-3 text-sm text-neutral-400">히스토리가 없습니다. 리셋 시 자동 기록되며, [지금 스냅샷 기록]으로 즉시 저장할 수 있습니다.</div>}
                {flatLogs.map((it, idx) => (
                  <div key={idx} className="p-3 border-t border-white/10 text-sm">
                    <div className="text-xs text-neutral-400">{it.date} {new Date(it.entry.at).toLocaleTimeString()}</div>
                    <div className="text-neutral-300">총합 {it.entry.total.toLocaleString()} · 멤버 {it.entry.members.length} · 후원 {it.entry.donors.length}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
