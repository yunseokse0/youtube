"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import MemberRow from "@/components/MemberRow";
import Toast from "@/components/Toast";
import {
  AppState,
  Member,
  Donor,
  defaultState,
  loadState,
  saveState,
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
  const [dailyLog, setDailyLog] = useState<Record<string, DailyLogEntry[]>>({});
  const [donorName, setDonorName] = useState("");
  const [donorAmount, setDonorAmount] = useState("");
  const [donorMemberId, setDonorMemberId] = useState<string | null>(null);
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
  const [ovScale, setOvScale] = useState("0.75");
  const [ovMemberSize, setOvMemberSize] = useState("18");
  const [ovTotalSize, setOvTotalSize] = useState("40");
  const [ovDense, setOvDense] = useState(true);
  const [ovAnchor, setOvAnchor] = useState("tl");
  const [ovSumAnchor, setOvSumAnchor] = useState("bc");
  const [overlayUrl, setOverlayUrl] = useState("");

  useEffect(() => {
    setState(loadState());
    setDailyLog(loadDailyLog());
    setYtUrl(getSavedVideoUrl() || "");
    setLiveChatId(getPreferredLiveChatId());
    setApiKey(getPreferredApiKey() || "");
    setEvents(loadForbidEvents());
  }, []);

  useEffect(() => {
    if (!chatDraftDirty) {
      setChatDraft(formatChatLine(state));
    }
    setForbiddenText((state.forbiddenWords || []).join("\n"));
  }, [state, chatDraftDirty]);

  useEffect(() => {
    const id = setInterval(() => saveState(state), 180_000);
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
      saveState(next);
      return next;
    });
  };

  const renameMember = (id: string, name: string) => {
    setState((prev: AppState) => {
      const next: AppState = { ...prev, members: prev.members.map((x: Member) => (x.id === id ? { ...x, name } : x)) };
      saveState(next);
      return next;
    });
  };

  const resetMemberAmounts = (id: string) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        members: prev.members.map((x: Member) => (x.id === id ? { ...x, account: 0, toon: 0 } : x)),
      };
      saveState(next);
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
      saveState(next);
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
      saveState(next);
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
      saveState(next);
      return next;
    });
    setNewMemberName("");
  };

  const addDonor = () => {
    const amount = parseTenThousandThousand(donorAmount);
    if (!donorMemberId) return;
    if (!confirmHighAmount(amount)) return;
    setState((prev: AppState) => {
      const safeName = (donorName || "무명").replace(/\s+/g, "");
      const existingIdx = prev.donors.findIndex((d) => d.name === safeName && d.memberId === donorMemberId);
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
        };
        donors = [...prev.donors, donor];
      }
      const members = prev.members.map((m: Member) =>
        m.id === donorMemberId ? { ...m, account: m.account + amount } : m
      );
      const next: AppState = { ...prev, members, donors };
      saveState(next);
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
      saveState(next);
      return next;
    });
  };

  const onReset = () => {
    appendDailyLog(state);
    setDailyLog(loadDailyLog());
    const next = defaultState();
    setState(next);
    saveState(next);
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const base = `${window.location.origin}/overlay`;
    const params = new URLSearchParams({
      scale: ovScale,
      memberSize: ovMemberSize,
      totalSize: ovTotalSize,
      dense: String(ovDense),
      anchor: ovAnchor,
      sumAnchor: ovSumAnchor,
    }).toString();
    setOverlayUrl(`${base}?${params}`);
  }, [ovScale, ovMemberSize, ovTotalSize, ovDense, ovAnchor, ovSumAnchor]);

  const copyOverlayUrl = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(overlayUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = overlayUrl;
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
    } catch {}
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <Toast />
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">매니저 제어판</h1>
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
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3">
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
                            <td className="p-1 text-right">{formatManThousand(d.amount)}</td>
                            <td className="p-1 text-right">
                              <button
                                className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                                onClick={() => {
                                  if (typeof window !== "undefined" && !window.confirm("해당 후원 기록을 삭제할까요?")) return;
                                  setState((prev: AppState) => {
                                    const donors = prev.donors.filter((x) => x.id !== d.id);
                                    const members = prev.members.map((mm: Member) =>
                                      mm.id === d.memberId ? { ...mm, account: Math.max(0, mm.account - d.amount) } : mm
                                    );
                                    const next: AppState = { ...prev, donors, members };
                                    saveState(next);
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
                      <tr><td className="p-2 text-neutral-400" colSpan={4}>기록이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-3">오버레이 프리뷰 & URL</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <div className="grid grid-cols-[120px_1fr] items-center gap-2">
                    <label className="text-sm text-neutral-400">배율(scale)</label>
                    <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={ovScale} onChange={(e) => setOvScale(e.target.value)} />
                    <label className="text-sm text-neutral-400">멤버 글자(px)</label>
                    <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={ovMemberSize} onChange={(e) => setOvMemberSize(e.target.value)} />
                    <label className="text-sm text-neutral-400">총합 글자(px)</label>
                    <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={ovTotalSize} onChange={(e) => setOvTotalSize(e.target.value)} />
                    <label className="text-sm text-neutral-400">줄 간격(dense)</label>
                    <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={String(ovDense)} onChange={(e) => setOvDense(e.target.value === "true")}>
                      <option value="true">촘촘</option>
                      <option value="false">보통</option>
                    </select>
                    <label className="text-sm text-neutral-400">목록 위치(anchor)</label>
                    <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={ovAnchor} onChange={(e) => setOvAnchor(e.target.value)}>
                      <option value="tl">좌상</option><option value="tr">우상</option><option value="bl">좌하</option><option value="br">우하</option>
                    </select>
                    <label className="text-sm text-neutral-400">총합 위치(sumAnchor)</label>
                    <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10" value={ovSumAnchor} onChange={(e) => setOvSumAnchor(e.target.value)}>
                      <option value="bc">하단중앙</option><option value="tc">상단중앙</option><option value="bl">좌하</option><option value="br">우하</option><option value="tr">우상</option><option value="tl">좌상</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <input className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 font-mono text-xs" readOnly value={overlayUrl} />
                    <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={copyOverlayUrl}>URL 복사</button>
                  </div>
                  <div className="text-xs text-neutral-400">브라우저 소스에 이 URL을 그대로 붙여넣으면 투명 배경으로 출력됩니다.</div>
                </div>
                <div className="rounded border border-white/10 bg-black/70 p-2">
                  <div className="text-xs text-neutral-400 mb-1">프리뷰</div>
                  <div className="relative w-full h-[420px] rounded overflow-hidden">
                    <iframe
                      src={overlayUrl}
                      title="overlay-preview"
                      className="absolute inset-0 w-full h-full"
                      style={{ background: "transparent" }}
                      scrolling="no"
                    />
                  </div>
                </div>
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
