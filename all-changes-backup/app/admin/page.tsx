"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
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
  confirmHighAmount,
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
  const [donorName, setDonorName] = useState("");
  const [donorAmount, setDonorAmount] = useState("");
  const [donorMemberId, setDonorMemberId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatDraftDirty, setChatDraftDirty] = useState(false);
  const [forbiddenText, setForbiddenText] = useState("");
  const [events, setEvents] = useState<Array<{ at: number; author: string; message: string; word: string }>>([]);
  const [ytUrl, setYtUrl] = useState("");
  const [liveChatId, setLiveChatId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>("");

  // Load state on mount
  useEffect(() => {
    loadState().then(setState);
    const savedUrl = getSavedVideoUrl();
    if (savedUrl) setYtUrl(savedUrl);
    const savedChatId = getPreferredLiveChatId();
    if (savedChatId) setLiveChatId(savedChatId);
    const savedApiKey = getPreferredApiKey();
    if (savedApiKey) setApiKey(savedApiKey);
  }, []);

  // Save state when it changes
  useEffect(() => {
    saveState(state);
  }, [state]);

  const addDonor = useCallback((memberId: string, amount: number, message: string = "") => {
    const member = state.members.find(m => m.id === memberId);
    if (!member) return;

    const donor: Donor = {
      id: Date.now().toString(),
      name: member.name,
      amount,
      memberId,
      target: "account",
      at: Date.now(),
      message,
    };

    if (confirmHighAmount(amount)) {
      setState(prev => ({
        ...prev,
        donors: [donor, ...prev.donors],
        members: prev.members.map(m => 
          m.id === memberId ? { ...m, account: m.account + amount, today: m.today + amount } : m
        ),
      }));

      appendDailyLog(member.name, amount);
    }
  }, [state.members]);

  // Start YouTube polling
  useEffect(() => {
    if (!ytUrl || !apiKey) return;
    
    const onDonation = (author: string, amount: number, message: string) => {
      const member = state.members.find(m => m.name === author);
      if (member) {
        addDonor(member.id, amount, message);
      }
    };

    const onForbidden: OnForbidden = ({ word, author, message }) => {
      setEvents(prev => [{ at: Date.now(), author, message, word }, ...prev.slice(0, 9)]);
    };

    return startYoutubePolling(ytUrl, apiKey, onDonation, onForbidden);
  }, [ytUrl, apiKey, state.members, addDonor]);

  const total = useMemo(() => totalAccount(state), [state]);

  const addMember = () => {
    if (!newMemberName.trim()) return;
    
    const newMember: Member = {
      id: Date.now().toString(),
      name: newMemberName.trim(),
      account: 0,
      toon: 0,
      today: 0,
      missions: [],
    };
    
    setState(prev => ({
      ...prev,
      members: [...prev.members, newMember],
    }));
    
    setNewMemberName("");
  };

  const updateMember = (id: string, updates: Partial<Member>) => {
    setState(prev => ({
      ...prev,
      members: prev.members.map(m => m.id === id ? { ...m, ...updates } : m),
    }));
  };

  const renameMember = (id: string, newName: string) => {
    if (!newName.trim()) return;
    updateMember(id, { name: newName.trim() });
  };

  const resetMemberAmounts = (id: string) => {
    updateMember(id, { account: 0, today: 0 });
  };

  const deleteMember = (id: string) => {
    setState(prev => ({
      ...prev,
      members: prev.members.filter(m => m.id !== id),
    }));
  };

  const resetAllMembersAmounts = () => {
    setState(prev => ({
      ...prev,
      members: prev.members.map(m => ({ ...m, account: 0, today: 0 })),
    }));
  };

  const handleManualDonation = () => {
    if (!donorName.trim() || !donorAmount || !donorMemberId) return;
    
    const amount = parseTenThousandThousand(donorAmount);
    if (isNaN(amount) || amount <= 0) return;
    
    addDonor(donorMemberId, amount);
    setDonorName("");
    setDonorAmount("");
    setDonorMemberId(null);
  };

  const handleYoutubeUrlChange = (url: string) => {
    setYtUrl(url);
    setYoutubeVideoUrl(url);
    if (!url) {
      clearPreferredLiveChatId();
      setLiveChatId(null);
    }
  };

  const handleApiKeyChange = (key: string) => {
    setApiKey(key);
    if (key) {
      setPreferredApiKey(key);
    } else {
      clearPreferredApiKey();
    }
  };

  const copyOverlayUrl = () => {
    const url = new URL(window.location.origin);
    url.pathname = "/overlay";
    url.searchParams.set("theme", "excel");
    url.searchParams.set("scale", "1");
    url.searchParams.set("memberSize", "24");
    url.searchParams.set("totalSize", "32");
    url.searchParams.set("dense", "false");
    url.searchParams.set("anchor", "top-right");
    url.searchParams.set("sumAnchor", "bottom-left");
    url.searchParams.set("sumFree", "true");
    url.searchParams.set("sumX", "10");
    url.searchParams.set("sumY", "10");
    url.searchParams.set("showMembers", "true");
    url.searchParams.set("showTotal", "true");
    url.searchParams.set("showGoal", "false");
    url.searchParams.set("showTicker", "false");
    url.searchParams.set("showTimer", "false");
    url.searchParams.set("showMission", "true");
    
    navigator.clipboard.writeText(url.toString());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <Toast />
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">매니저 제어판</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.open('/simple-admin', '_blank')}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-medium transition-all duration-200 shadow-lg"
            >
              🎯 간단한 모드로 전환
            </button>
            <Link className="text-sm text-neutral-300 underline" href="/overlay">오버레이 열기</Link>
          </div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
          <div className="space-y-6">
            <section className="glass p-4 md:p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">멤버 정산 보드</h2>
                <div className="text-right">
                  <div className="text-xs text-neutral-400">계좌 총합</div>
                  <div className="text-2xl font-bold">{total.toLocaleString()}</div>
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
              
              <div className="space-y-3">
                {state.members.map((m: Member) => (
                  <MemberRow key={m.id} member={m} onChange={updateMember} onRename={renameMember} onReset={resetMemberAmounts} onDelete={deleteMember} />
                ))}
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-4">수동 후원 추가</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="후원자 이름"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                />
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="금액 (예: 1만 = 10000)"
                  value={donorAmount}
                  onChange={(e) => setDonorAmount(maskTenThousandThousandInput(e.target.value))}
                />
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={donorMemberId || ""}
                  onChange={(e) => setDonorMemberId(e.target.value || null)}
                >
                  <option value="">멤버 선택</option>
                  {state.members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>
              <button
                className="mt-4 px-4 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleManualDonation}
                disabled={!donorName.trim() || !donorAmount || !donorMemberId}
              >
                후원 추가
              </button>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-4">YouTube 설정</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">YouTube URL</label>
                  <input
                    className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="https://www.youtube.com/watch?v=..."
                    value={ytUrl}
                    onChange={(e) => handleYoutubeUrlChange(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">API Key</label>
                  <input
                    className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="YouTube Data API v3 Key"
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                  />
                </div>
                {liveChatId && (
                  <div className="text-sm text-green-400">
                    ✅ Live Chat ID: {liveChatId}
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-4">오버레이 URL</h2>
              <button
                className={`px-4 py-2 rounded transition-all ${
                  copied 
                    ? "bg-green-600 text-white" 
                    : "bg-blue-600 hover:bg-blue-700 text-white"
                }`}
                onClick={copyOverlayUrl}
              >
                {copied ? "✅ 복사됨!" : "📋 오버레이 URL 복사"}
              </button>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-4">최근 후원</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {state.donors.slice(0, 10).map((donor) => (
                  <div key={donor.id} className="flex justify-between items-center p-2 bg-neutral-900/40 rounded">
                    <div>
                      <div className="font-medium">{donor.name}</div>
                      {donor.message && (
                        <div className="text-sm text-neutral-400">{donor.message}</div>
                      )}
                    </div>
                    <div className="font-bold text-emerald-400">
                      {donor.amount.toLocaleString()}원
                    </div>
                  </div>
                ))}
                {state.donors.length === 0 && (
                  <div className="text-center text-neutral-500 py-8">
                    최근 후원이 없습니다
                  </div>
                )}
              </div>
            </section>

            {events.length > 0 && (
              <section className="glass p-4 md:p-6">
                <h2 className="text-lg font-semibold mb-4">금지어 감지</h2>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {events.map((event, idx) => (
                    <div key={idx} className="p-2 bg-red-900/40 border border-red-500/30 rounded">
                      <div className="font-medium text-red-300">{event.author}</div>
                      <div className="text-sm text-neutral-300">{event.message}</div>
                      <div className="text-xs text-red-400 mt-1">금지어: {event.word}</div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}