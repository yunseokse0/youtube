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
  MissionItem,
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
import { useRouter } from "next/navigation";
import { appendSettlementRecordAndSync, SettlementMemberRatioOverrides } from "@/lib/settlement";

function ClientTime({ ts }: { ts: number | string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    try {
      const n = typeof ts === "string" ? Date.parse(ts) : ts;
      setText(new Date(n).toLocaleTimeString());
    } catch {
      setText("");
    }
  }, [ts]);
  return <span suppressHydrationWarning>{text}</span>;
}

export default function AdminPage() {
  const router = useRouter();
  const [state, setState] = useState<AppState>(defaultState());
  const [syncStatus, setSyncStatus] = useState<"loading" | "synced" | "local" | "error">("loading");
  const stateUpdatedAtRef = useRef<number>(0);
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
  const [missionTitle, setMissionTitle] = useState("");
  const [missionPrice, setMissionPrice] = useState("");
  const [settlementTitle, setSettlementTitle] = useState("");
  const [accountRatioInput, setAccountRatioInput] = useState("70");
  const [toonRatioInput, setToonRatioInput] = useState("60");
  const [taxRateInput, setTaxRateInput] = useState("3.3");
  const [useMemberRatioOverrides, setUseMemberRatioOverrides] = useState(false);
  const [memberRatioInputs, setMemberRatioInputs] = useState<Record<string, { account: string; toon: string }>>({});
  const [ytUrl, setYtUrl] = useState("");
  const [liveChatId, setLiveChatId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  type OverlayPreset = {
    id: string; name: string; scale: string; memberSize: string; totalSize: string;
    dense: boolean; anchor: string; sumAnchor: string; sumFree: boolean; sumX: string; sumY: string;
    theme: string; showMembers: boolean; showTotal: boolean;
    showGoal: boolean; goal: string; goalLabel: string; goalWidth: string; goalAnchor: string; goalCurrent?: string;
    showPersonalGoal?: boolean;
    personalGoalTheme?: string;
    personalGoalAnchor?: string;
    personalGoalLimit?: string;
    personalGoalFree?: boolean;
    personalGoalX?: string;
    personalGoalY?: string;
    tickerInMembers?: boolean;
    tickerInGoal?: boolean;
    tickerInPersonalGoal?: boolean;
    showTicker: boolean; tickerAnchor?: string; tickerWidth?: string; tickerFree?: boolean; tickerX?: string; tickerY?: string; showTimer: boolean; timerStart: number | null; timerAnchor: string;
    showMission: boolean; missionAnchor: string;
    showBottomDonors?: boolean; donorsSize?: string; donorsGap?: string; donorsSpeed?: string; donorsLimit?: string; donorsFormat?: string; donorsUnit?: string; donorsColor?: string; tickerTheme?: string; tickerGlow?: string; tickerShadow?: string; currencyLocale?: string;
  };
  const PRESET_STORAGE_KEY = "excel-broadcast-overlay-presets";
  const SETTLEMENT_OPTIONS_KEY = "excel-broadcast-settlement-options-v1";
  const PRESET_TEMPLATES: { name: string; preset: Partial<OverlayPreset> }[] = [
    { name: "전체 통합", preset: { showMembers: true, showTotal: true } },
    { name: "멤버 목록만", preset: { showMembers: true, showTotal: false } },
    { name: "총합만", preset: { showMembers: false, showTotal: true, totalSize: "60" } },
    { name: "목표 프로그레스바", preset: { showMembers: false, showTotal: false, showGoal: true, goal: "500000", goalLabel: "목표 금액", goalWidth: "500" } },
    { name: "개인 골", preset: { showMembers: false, showTotal: false, showPersonalGoal: true } },
    { name: "후원 티커", preset: { showMembers: false, showTotal: false, showTicker: true } },
    { name: "타이머", preset: { showMembers: false, showTotal: false, showTimer: true } },
    { name: "미션 메뉴판", preset: { showMembers: false, showTotal: false, showMission: true, missionAnchor: "br" } },
  ];
  const defaultPreset = (name: string, overrides: Partial<OverlayPreset> = {}): OverlayPreset => ({
    id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name,
    scale: "0.75", memberSize: "18", totalSize: "40", dense: true, anchor: "tl",
    sumAnchor: "bc", sumFree: false, sumX: "50", sumY: "90", theme: "default",
    showMembers: true, showTotal: true, showGoal: false, goal: "0", goalLabel: "목표 금액", showPersonalGoal: false, personalGoalTheme: "goalClassic", personalGoalAnchor: "br", personalGoalLimit: "3", personalGoalFree: false, personalGoalX: "78", personalGoalY: "82",
    tickerInMembers: true, tickerInGoal: true, tickerInPersonalGoal: true,
    goalWidth: "400", goalAnchor: "bc", goalCurrent: "", showTicker: false, tickerAnchor: "bc", tickerWidth: "600", tickerFree: false, tickerX: "50", tickerY: "86", showTimer: false,
    timerStart: null, timerAnchor: "tr", showMission: false, missionAnchor: "br",
    showBottomDonors: true, donorsSize: "", donorsGap: "16", donorsSpeed: "20", donorsLimit: "8", donorsFormat: "short", donorsUnit: "", donorsColor: "", tickerTheme: "auto", tickerGlow: "45", tickerShadow: "35", currencyLocale: "ko-KR",
    ...overrides,
  });
  const [presets, setPresets] = useState<OverlayPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    stateUpdatedAtRef.current = state.updatedAt || 0;
  }, [state.updatedAt]);

  useEffect(() => {
    let localPresets: OverlayPreset[] = [];
    setDailyLog(loadDailyLog());
    setYtUrl(getSavedVideoUrl() || "");
    setLiveChatId(getPreferredLiveChatId());
    setApiKey(getPreferredApiKey() || "");
    setEvents(loadForbidEvents());
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      if (raw) {
        localPresets = JSON.parse(raw) as OverlayPreset[];
        setPresets(localPresets);
      }
    } catch {}
    try {
      const raw = window.localStorage.getItem(SETTLEMENT_OPTIONS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          accountRatioInput?: string;
          toonRatioInput?: string;
          taxRateInput?: string;
          useMemberRatioOverrides?: boolean;
          memberRatioInputs?: Record<string, { account?: string; toon?: string }>;
        };
        if (typeof parsed.accountRatioInput === "string") setAccountRatioInput(parsed.accountRatioInput);
        if (typeof parsed.toonRatioInput === "string") setToonRatioInput(parsed.toonRatioInput);
        if (typeof parsed.taxRateInput === "string") setTaxRateInput(parsed.taxRateInput);
        if (typeof parsed.useMemberRatioOverrides === "boolean") setUseMemberRatioOverrides(parsed.useMemberRatioOverrides);
        if (parsed.memberRatioInputs && typeof parsed.memberRatioInputs === "object") {
          const normalized: Record<string, { account: string; toon: string }> = {};
          Object.entries(parsed.memberRatioInputs).forEach(([memberId, value]) => {
            normalized[memberId] = {
              account: typeof value?.account === "string" ? value.account : "",
              toon: typeof value?.toon === "string" ? value.toon : "",
            };
          });
          setMemberRatioInputs(normalized);
        }
      }
    } catch {}
    loadStateFromApi().then((apiState) => {
      if (apiState) {
        setState(apiState);
        if (Array.isArray(apiState.overlayPresets) && apiState.overlayPresets.length > 0) {
          setPresets(apiState.overlayPresets as OverlayPreset[]);
        } else if (localPresets.length > 0) {
          const next = { ...apiState, overlayPresets: localPresets };
          setState(next);
          persistState(next);
        }
        setSyncStatus("synced");
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(apiState)); } catch {}
      } else {
        const local = loadState();
        if (Array.isArray(local.overlayPresets) && local.overlayPresets.length > 0) {
          setPresets(local.overlayPresets as OverlayPreset[]);
        } else if (localPresets.length > 0) {
          local.overlayPresets = localPresets;
          setPresets(localPresets);
        }
        setState(local);
        setSyncStatus("local");
        saveStateAsync(local).then((ok) => { if (ok) setSyncStatus("synced"); });
      }
    });
  }, []);

  // Keep admin amounts synchronized across mobile/PC sessions.
  // We only accept strictly newer server snapshots to avoid stale overwrites.
  useEffect(() => {
    let running = true;
    let inFlight = false;
    const syncFromApi = async () => {
      if (!running || inFlight) return;
      inFlight = true;
      try {
        const remote = await loadStateFromApi();
        if (!remote) return;
        const remoteUpdatedAt = remote.updatedAt || 0;
        if (remoteUpdatedAt > stateUpdatedAtRef.current) {
          stateUpdatedAtRef.current = remoteUpdatedAt;
          setState(remote);
          if (Array.isArray(remote.overlayPresets)) {
            setPresets(remote.overlayPresets as OverlayPreset[]);
          }
          setSyncStatus("synced");
          try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(remote)); } catch {}
        }
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => { void syncFromApi(); }, 1200);
    void syncFromApi();
    return () => {
      running = false;
      window.clearInterval(timer);
    };
  }, []);

  const savePresets = (next: OverlayPreset[]) => {
    setPresets(next);
    try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next)); } catch {}
    setState((prev) => {
      const merged: AppState = { ...prev, overlayPresets: next };
      persistState(merged);
      return merged;
    });
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
    const q: Record<string, string> = { p: p.id };
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
    setMemberRatioInputs((prev) => {
      const next: Record<string, { account: string; toon: string }> = {};
      for (const m of state.members) {
        next[m.id] = {
          account: prev[m.id]?.account ?? "",
          toon: prev[m.id]?.toon ?? "",
        };
      }
      return next;
    });
  }, [state.members]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        SETTLEMENT_OPTIONS_KEY,
        JSON.stringify({
          accountRatioInput,
          toonRatioInput,
          taxRateInput,
          useMemberRatioOverrides,
          memberRatioInputs,
        })
      );
    } catch {}
  }, [SETTLEMENT_OPTIONS_KEY, accountRatioInput, toonRatioInput, taxRateInput, useMemberRatioOverrides, memberRatioInputs]);

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
    if (amount <= 0) return;
    const target = donorTarget;
    setState((prev: AppState) => {
      const safeName = (donorName || "무명").replace(/\s+/g, "");
      // Keep each donation as a separate row for easier per-transaction corrections.
      const donor: Donor = {
        id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: safeName,
        amount,
        memberId: donorMemberId,
        at: Date.now(),
        target,
      };
      const donors: Donor[] = [...prev.donors, donor];
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
  const donorTotalsByName = useMemo(() => {
    const map = new Map<string, { name: string; account: number; toon: number; total: number; count: number }>();
    for (const d of state.donors) {
      const key = (d.name || "무명").trim() || "무명";
      const prev = map.get(key) || { name: key, account: 0, toon: 0, total: 0, count: 0 };
      const isToon = (d.target || "account") === "toon";
      const next = {
        name: key,
        account: prev.account + (isToon ? 0 : d.amount),
        toon: prev.toon + (isToon ? d.amount : 0),
        total: prev.total + d.amount,
        count: prev.count + 1,
      };
      map.set(key, next);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [state.donors]);

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

  const onFinishBroadcastAndSettle = async () => {
    const accountRatioPct = Math.max(0, Math.min(100, parseFloat(accountRatioInput || "70") || 70));
    const toonRatioPct = Math.max(0, Math.min(100, parseFloat(toonRatioInput || "60") || 60));
    const taxRatePct = Math.max(0, Math.min(100, parseFloat(taxRateInput || "3.3") || 3.3));
    const accountRatio = accountRatioPct / 100;
    const toonRatio = toonRatioPct / 100;
    const taxRate = taxRatePct / 100;
    const parseOptionalPct = (value: string): number | null => {
      const trimmed = (value || "").trim();
      if (!trimmed) return null;
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(100, n)) / 100;
    };
    const memberRatioOverrides: SettlementMemberRatioOverrides | undefined = useMemberRatioOverrides
      ? state.members.reduce<SettlementMemberRatioOverrides>((acc, m) => {
          const input = memberRatioInputs[m.id];
          const account = parseOptionalPct(input?.account || "");
          const toon = parseOptionalPct(input?.toon || "");
          if (account !== null || toon !== null) {
            acc[m.id] = {
              ...(account !== null ? { accountRatio: account } : {}),
              ...(toon !== null ? { toonRatio: toon } : {}),
            };
          }
          return acc;
        }, {})
      : undefined;
    const title =
      settlementTitle.trim() ||
      `${new Date().toISOString().slice(0, 10)} 정산`;
    const rec = await appendSettlementRecordAndSync(title, state.members, accountRatio, toonRatio, taxRate, memberRatioOverrides);
    router.push(`/settlements/${rec.id}`);
  };

  return (
    <main className="min-h-screen p-4 md:p-8">
      <Toast />
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-wrap items-start sm:items-center justify-between gap-2 mb-6">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
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
              <div className="text-xs text-neutral-400">계좌 · 투네 · 전체</div>
              <div className="text-2xl font-bold">
                {formatManThousand(state.members.reduce((s,m)=>s+(m.account||0),0))}
                <span className="text-neutral-500 mx-1">·</span>
                {formatManThousand(state.members.reduce((s,m)=>s+(m.toon||0),0))}
                <span className="text-neutral-500 mx-1">·</span>
                {formatManThousand(state.members.reduce((s,m)=>s+(m.account||0)+(m.toon||0),0))}
              </div>
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
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto_auto_auto] gap-3">
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
                            <td className="p-1 text-neutral-400"><ClientTime ts={d.at} /></td>
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
              <div className="text-xs text-neutral-400 mt-2">
                후원자 리스트는 건별 기록입니다. (동일 후원자여도 건별로 별도 행 표시)
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <h2 className="text-lg font-semibold mb-3">후원자별 누적 합계</h2>
              <div className="max-h-[240px] overflow-auto pr-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="text-left font-medium p-1">후원자</th>
                      <th className="text-right font-medium p-1">계좌 누적</th>
                      <th className="text-right font-medium p-1">투네 누적</th>
                      <th className="text-right font-medium p-1">총 누적</th>
                      <th className="text-right font-medium p-1">건수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donorTotalsByName.map((row) => (
                      <tr key={row.name} className="border-t border-white/10">
                        <td className="p-1">{row.name}</td>
                        <td className="p-1 text-right text-emerald-300">{formatManThousand(row.account)}</td>
                        <td className="p-1 text-right text-amber-300">{formatManThousand(row.toon)}</td>
                        <td className="p-1 text-right font-semibold">{formatManThousand(row.total)}</td>
                        <td className="p-1 text-right text-neutral-400">{row.count}</td>
                      </tr>
                    ))}
                    {donorTotalsByName.length === 0 && (
                      <tr><td className="p-2 text-neutral-400" colSpan={5}>누적 데이터가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">미션 메뉴판</h2>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-2 mb-3">
                <input className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10" placeholder="미션 제목 (예: 노래 부르기)" value={missionTitle} onChange={(e) => setMissionTitle(e.target.value)} />
                <input className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 w-full lg:w-32" placeholder="가격 (예: 3만)" value={missionPrice} onChange={(e) => setMissionPrice(e.target.value)} />
                <button className="px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 font-semibold" onClick={() => {
                  if (!missionTitle.trim()) return;
                  setState((prev) => {
                    const m: MissionItem = { id: `mis_${Date.now()}`, title: missionTitle.trim(), price: missionPrice.trim() || "무료" };
                    const next = { ...prev, missions: [...(prev.missions || []), m] };
                    persistState(next);
                    return next;
                  });
                  setMissionTitle(""); setMissionPrice("");
                }}>추가</button>
              </div>
              {(state.missions || []).length === 0 && <div className="text-sm text-neutral-400 p-4 text-center border border-dashed border-white/10 rounded">미션이 없습니다.</div>}
              {(state.missions || []).length > 0 && (
                <div className="space-y-1 max-h-[300px] overflow-auto">
                  {(state.missions || []).map((mis, idx) => (
                    <div key={mis.id} className="flex items-center gap-2 px-3 py-2 rounded bg-neutral-900/40 border border-white/10">
                      <span className="text-sm font-mono text-neutral-500 w-6">{idx + 1}</span>
                      <input className="flex-1 px-2 py-1 rounded bg-neutral-800 border border-white/10 text-sm" value={mis.title} onChange={(e) => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, title: e.target.value } : m) };
                          persistState(next); return next;
                        });
                      }} />
                      <input className="w-24 px-2 py-1 rounded bg-neutral-800 border border-white/10 text-sm text-right" value={mis.price} onChange={(e) => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, price: e.target.value } : m) };
                          persistState(next); return next;
                        });
                      }} />
                      <button className={`px-2 py-1 rounded border text-xs ${mis.isHot ? "border-red-500 text-red-300" : "border-white/10 text-neutral-500"}`} onClick={() => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, isHot: !m.isHot } : m) };
                          persistState(next); return next;
                        });
                      }}>{mis.isHot ? "HOT" : "hot"}</button>
                      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => {
                        if (idx === 0) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}>▲</button>
                      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => {
                        if (idx >= (state.missions || []).length - 1) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}>▼</button>
                      <button className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs" onClick={() => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).filter(m => m.id !== mis.id) };
                          persistState(next); return next;
                        });
                      }}>삭제</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-neutral-400 mt-2">오버레이 프리셋에서 &quot;미션 메뉴&quot;를 ON하면 방송 화면에 표시됩니다.</div>
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
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setEditingId(isOpen ? null : p.id)}>
                        <span className="text-sm">{isOpen ? "▼" : "▶"}</span>
                        <input
                          className="px-2 py-0.5 rounded bg-neutral-800 border border-white/10 text-sm font-semibold flex-shrink-0 w-full sm:w-40"
                          value={p.name}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updatePreset(p.id, { name: e.target.value })}
                        />
                        <span className="text-xs text-neutral-500 truncate basis-full sm:basis-auto sm:flex-1 font-mono">{url.slice(0, 80)}...</span>
                        <button className={`px-2 py-1 rounded text-xs ${copiedId === p.id ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={(e) => { e.stopPropagation(); copyUrl(url, p.id); }}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                        <button className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs" onClick={(e) => { e.stopPropagation(); removePreset(p.id); }}>삭제</button>
                      </div>
                      {isOpen && (
                        <div className="px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-3 border-t border-white/10 pt-3">
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] items-center gap-2">
                              <label className="text-xs text-neutral-400">테마</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.theme} onChange={(e) => updatePreset(p.id, { theme: e.target.value })}>
                                <option value="default">기본</option><option value="excel">엑셀</option><option value="neon">네온</option><option value="neonExcel">네온 엑셀</option><option value="retro">레트로</option><option value="minimal">미니멀</option><option value="rpg">RPG</option><option value="pastel">파스텔</option>
                              </select>
                              <label className="text-xs text-neutral-400">배율</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="0.2"
                                  max="2"
                                  step="0.01"
                                  value={p.scale}
                                  onChange={(e) => updatePreset(p.id, { scale: e.target.value })}
                                  className="flex-1 accent-emerald-500"
                                />
                                <input
                                  className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                  value={p.scale}
                                  onChange={(e) => updatePreset(p.id, { scale: e.target.value.replace(/[^\d.]/g, "") })}
                                />
                              </div>
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
                              {([["멤버 목록", "showMembers"], ["총합", "showTotal"], ["목표바", "showGoal"], ["개인 골", "showPersonalGoal"], ["후원 티커", "showTicker"], ["타이머", "showTimer"], ["미션 메뉴", "showMission"]] as [string, keyof OverlayPreset][]).map(([label, key]) => (
                                <button key={key} className={`px-2 py-0.5 rounded border text-xs ${p[key] ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { [key]: !p[key] })}>{label} {p[key] ? "ON" : "OFF"}</button>
                              ))}
                            </div>

                            <div className="h-px bg-white/10 my-1" />
                            <div className="text-xs text-neutral-400 font-semibold">데모 빠른 실행</div>
                            <div className="flex flex-wrap gap-1">
                              {[
                                { label: "멤버 보드", patch: { showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false } },
                                { label: "총합", patch: { showMembers: false, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false } },
                                { label: "목표바", patch: { showMembers: false, showTotal: false, showGoal: true, showTicker: false, showTimer: false, showMission: false } },
                                { label: "후원 티커", patch: { showMembers: false, showTotal: false, showGoal: false, showTicker: true, showTimer: false, showMission: false } },
                                { label: "타이머", patch: { showMembers: false, showTotal: false, showGoal: false, showTicker: false, showTimer: true, showMission: false, timerStart: Date.now() } },
                                { label: "미션 메뉴", patch: { showMembers: false, showTotal: false, showGoal: false, showTicker: false, showTimer: false, showMission: true } },
                              ].map(({ label, patch }) => (
                                <button
                                  key={label}
                                  className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                  onClick={() => {
                                    if (typeof window === "undefined") return;
                                    const base = buildOverlayUrl({ ...p, ...patch });
                                    const u = new URL(base);
                                    u.searchParams.set("demo", "true");
                                    // 권장 프리셋 추가
                                    u.searchParams.set("autoFont", "true");
                                    u.searchParams.set("fitBase", "480");
                                    u.searchParams.set("compact", "true");
                                    u.searchParams.set("tight", "true");
                                    u.searchParams.set("lockWidth", "true");
                                    window.open(u.toString(), "_blank");
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                              <button
                                className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                onClick={() => {
                                  if (typeof window === "undefined") return;
                                  const url = `${window.location.origin}/goal-overlay.html`;
                                  window.open(url, "_blank");
                                }}
                              >
                                목표 달성 바(HTML)
                              </button>
                            </div>

                            <div className="h-px bg-white/10 my-1" />
                            <div className="text-xs text-neutral-400 font-semibold">후원 리스트 옵션</div>
                            <div className="grid grid-cols-1 sm:grid-cols-[110px_1fr] items-center gap-2">
                              <label className="text-xs text-neutral-400">멤버목록 내 티커</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.tickerInMembers ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { tickerInMembers: !p.tickerInMembers })}>
                                {p.tickerInMembers ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">목표바 내 티커</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.tickerInGoal ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { tickerInGoal: !p.tickerInGoal })}>
                                {p.tickerInGoal ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">개인골 내 티커</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.tickerInPersonalGoal ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { tickerInPersonalGoal: !p.tickerInPersonalGoal })}>
                                {p.tickerInPersonalGoal ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">하단 리스트 표시</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.showBottomDonors ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { showBottomDonors: !p.showBottomDonors })}>
                                {p.showBottomDonors ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">티커 글자(px)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="(기본 자동)" value={p.donorsSize || ""} onChange={(e) => updatePreset(p.id, { donorsSize: e.target.value })} />
                              <label className="text-xs text-neutral-400">간격(px)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.donorsGap || ""} onChange={(e) => updatePreset(p.id, { donorsGap: e.target.value })} />
                              <label className="text-xs text-neutral-400">속도(초/루프)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.donorsSpeed || ""} onChange={(e) => updatePreset(p.id, { donorsSpeed: e.target.value })} />
                              <label className="text-xs text-neutral-400">표시 개수(N)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.donorsLimit || ""} onChange={(e) => updatePreset(p.id, { donorsLimit: e.target.value })} />
                              <label className="text-xs text-neutral-400">금액 표기</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.donorsFormat || "short"} onChange={(e) => updatePreset(p.id, { donorsFormat: e.target.value })}>
                                <option value="full">풀(1,234)</option>
                                <option value="short">단축(1.2만)</option>
                              </select>
                              <label className="text-xs text-neutral-400">통화 로케일</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="ko-KR / en-US 등" value={p.currencyLocale || ""} onChange={(e) => updatePreset(p.id, { currencyLocale: e.target.value })} />
                              <label className="text-xs text-neutral-400">단위 표시</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="원 / KRW 등" value={p.donorsUnit || ""} onChange={(e) => updatePreset(p.id, { donorsUnit: e.target.value })} />
                              <label className="text-xs text-neutral-400">글자 색상</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="#a0e9ff" value={p.donorsColor || ""} onChange={(e) => updatePreset(p.id, { donorsColor: e.target.value })} />
                              <label className="text-xs text-neutral-400">티커 테마</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tickerTheme || "auto"} onChange={(e) => updatePreset(p.id, { tickerTheme: e.target.value })}>
                                <option value="auto">기본(테마 따름)</option>
                                <option value="accent">강조</option>
                                <option value="neon">네온</option>
                                <option value="warm">웜</option>
                                <option value="ice">아이스</option>
                                <option value="mono">모노</option>
                              </select>
                              <label className="text-xs text-neutral-400">글로우 강도</label>
                              <div className="flex items-center gap-1">
                                <input type="range" min="0" max="100" value={p.tickerGlow || "45"} onChange={(e) => updatePreset(p.id, { tickerGlow: e.target.value })} className="flex-1 accent-emerald-500" />
                                <span className="text-xs w-8 text-center">{p.tickerGlow || "45"}</span>
                              </div>
                              <label className="text-xs text-neutral-400">그림자 강도</label>
                              <div className="flex items-center gap-1">
                                <input type="range" min="0" max="100" value={p.tickerShadow || "35"} onChange={(e) => updatePreset(p.id, { tickerShadow: e.target.value })} className="flex-1 accent-emerald-500" />
                                <span className="text-xs w-8 text-center">{p.tickerShadow || "35"}</span>
                              </div>
                            </div>

                            {p.showGoal && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">목표 금액</div>
                                <div className="grid grid-cols-1 sm:grid-cols-[90px_1fr] items-center gap-1">
                                  <label className="text-xs text-neutral-400">목표(원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" type="number" value={p.goal} onChange={(e) => updatePreset(p.id, { goal: e.target.value })} />
                                  <label className="text-xs text-neutral-400">라벨</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalLabel} onChange={(e) => updatePreset(p.id, { goalLabel: e.target.value })} />
                                  <label className="text-xs text-neutral-400">데모 현재액(원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="미지정 시 자동" value={p.goalCurrent || ""} onChange={(e) => updatePreset(p.id, { goalCurrent: e.target.value })} />
                                  <label className="text-xs text-neutral-400">너비(px)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalWidth} onChange={(e) => updatePreset(p.id, { goalWidth: e.target.value })} />
                                  <label className="text-xs text-neutral-400">위치</label>
                                  <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalAnchor} onChange={(e) => updatePreset(p.id, { goalAnchor: e.target.value })}>
                                    <option value="bc">하단중앙</option><option value="tc">상단중앙</option><option value="bl">좌하</option><option value="br">우하</option><option value="tl">좌상</option><option value="tr">우상</option>
                                  </select>
                                </div>
                              </>
                            )}

                            {p.showPersonalGoal && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">개인골 표시</div>
                                <div className="grid grid-cols-1 sm:grid-cols-[90px_1fr] items-center gap-1">
                                  <label className="text-xs text-neutral-400">테마</label>
                                  <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.personalGoalTheme || "goalClassic"} onChange={(e) => updatePreset(p.id, { personalGoalTheme: e.target.value })}>
                                    <option value="goalClassic">개인골 클래식</option>
                                    <option value="goalNeon">개인골 네온</option>
                                  </select>
                                  <label className="text-xs text-neutral-400">위치 모드</label>
                                  <div className="flex gap-1">
                                    <button className={`px-2 py-0.5 rounded border text-xs ${!p.personalGoalFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`} onClick={() => updatePreset(p.id, { personalGoalFree: false })}>프리셋</button>
                                    <button className={`px-2 py-0.5 rounded border text-xs ${p.personalGoalFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`} onClick={() => updatePreset(p.id, { personalGoalFree: true })}>자유</button>
                                  </div>
                                  <label className="text-xs text-neutral-400">위치</label>
                                  {!p.personalGoalFree ? (
                                    <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.personalGoalAnchor || "br"} onChange={(e) => updatePreset(p.id, { personalGoalAnchor: e.target.value })}>
                                      <option value="br">우하</option><option value="bl">좌하</option><option value="tr">우상</option><option value="tl">좌상</option><option value="bc">하단중앙</option><option value="tc">상단중앙</option>
                                    </select>
                                  ) : (
                                    <div className="text-xs text-neutral-500">아래 X/Y 사용</div>
                                  )}
                                  {p.personalGoalFree && (
                                    <>
                                      <label className="text-xs text-neutral-400">X(%)</label>
                                      <div className="flex items-center gap-1"><input type="range" min="0" max="100" value={p.personalGoalX || "78"} onChange={(e) => updatePreset(p.id, { personalGoalX: e.target.value })} className="flex-1 accent-emerald-500" /><span className="text-xs w-8 text-center">{p.personalGoalX || "78"}</span></div>
                                      <label className="text-xs text-neutral-400">Y(%)</label>
                                      <div className="flex items-center gap-1"><input type="range" min="0" max="100" value={p.personalGoalY || "82"} onChange={(e) => updatePreset(p.id, { personalGoalY: e.target.value })} className="flex-1 accent-emerald-500" /><span className="text-xs w-8 text-center">{p.personalGoalY || "82"}</span></div>
                                    </>
                                  )}
                                  <label className="text-xs text-neutral-400">표시 개수</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.personalGoalLimit || "3"} onChange={(e) => updatePreset(p.id, { personalGoalLimit: e.target.value.replace(/[^\d]/g, "") })} />
                                </div>
                              </>
                            )}

                            {p.showTicker && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">후원 티커 위치</div>
                                <div className="grid grid-cols-1 sm:grid-cols-[90px_1fr] items-center gap-1">
                                  <label className="text-xs text-neutral-400">위치 모드</label>
                                  <div className="flex gap-1">
                                    <button className={`px-2 py-0.5 rounded border text-xs ${!p.tickerFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`} onClick={() => updatePreset(p.id, { tickerFree: false })}>프리셋</button>
                                    <button className={`px-2 py-0.5 rounded border text-xs ${p.tickerFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`} onClick={() => updatePreset(p.id, { tickerFree: true })}>자유</button>
                                  </div>
                                  <label className="text-xs text-neutral-400">위치</label>
                                  {!p.tickerFree ? (
                                    <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs" value={p.tickerAnchor || "bc"} onChange={(e) => updatePreset(p.id, { tickerAnchor: e.target.value })}>
                                      <option value="tr">우상</option><option value="tl">좌상</option><option value="br">우하</option><option value="bl">좌하</option><option value="tc">상단중앙</option><option value="bc">하단중앙</option>
                                    </select>
                                  ) : (
                                    <div className="text-xs text-neutral-500">아래 X/Y 슬라이더 사용</div>
                                  )}
                                  {p.tickerFree && (
                                    <>
                                      <label className="text-xs text-neutral-400">X(%)</label>
                                      <div className="flex items-center gap-1"><input type="range" min="0" max="100" value={p.tickerX || "50"} onChange={(e) => updatePreset(p.id, { tickerX: e.target.value })} className="flex-1 accent-emerald-500" /><span className="text-xs w-8 text-center">{p.tickerX || "50"}</span></div>
                                      <label className="text-xs text-neutral-400">Y(%)</label>
                                      <div className="flex items-center gap-1"><input type="range" min="0" max="100" value={p.tickerY || "86"} onChange={(e) => updatePreset(p.id, { tickerY: e.target.value })} className="flex-1 accent-emerald-500" /><span className="text-xs w-8 text-center">{p.tickerY || "86"}</span></div>
                                    </>
                                  )}
                                  <label className="text-xs text-neutral-400">폭(px)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs" value={p.tickerWidth || "600"} onChange={(e) => updatePreset(p.id, { tickerWidth: e.target.value })} />
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

                            {p.showMission && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">미션 메뉴판 위치</div>
                                <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs" value={p.missionAnchor} onChange={(e) => updatePreset(p.id, { missionAnchor: e.target.value })}>
                                  <option value="br">우하</option><option value="bl">좌하</option><option value="tr">우상</option><option value="tl">좌상</option>
                                </select>
                              </>
                            )}

                            <div className="h-px bg-white/10 my-1" />
                            <div className="flex items-center gap-2">
                              <input className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 font-mono text-xs" readOnly value={url} />
                              <button className={`px-2 py-1 rounded text-xs whitespace-nowrap ${copiedId === p.id ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={() => copyUrl(url, p.id)}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                            </div>
                          </div>

                          <VerticalPreview url={url} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="glass p-4 md:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold">방송 종료 정산</h2>
                <Link className="text-sm text-neutral-300 underline" href="/settlements">정산 기록 보기</Link>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto] gap-2">
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="정산 제목 (예: 16화 세부)"
                  value={settlementTitle}
                  onChange={(e) => setSettlementTitle(e.target.value)}
                />
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="계좌 비율 % (예: 70)"
                  value={accountRatioInput}
                  onChange={(e) => setAccountRatioInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="투네 비율 % (예: 60)"
                  value={toonRatioInput}
                  onChange={(e) => setToonRatioInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="세금 비율 % (예: 3.3)"
                  value={taxRateInput}
                  onChange={(e) => setTaxRateInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <button
                  className="px-4 py-2 rounded bg-emerald-700 hover:bg-emerald-600 font-semibold"
                  onClick={onFinishBroadcastAndSettle}
                >
                  방송 종료(정산 생성)
                </button>
              </div>
              <div className="mt-3 rounded border border-white/10 bg-neutral-900/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-neutral-200 font-medium">멤버별 개별 비율</div>
                  <button
                    className={`px-2 py-1 rounded border text-xs ${useMemberRatioOverrides ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`}
                    onClick={() => setUseMemberRatioOverrides((v) => !v)}
                  >
                    {useMemberRatioOverrides ? "사용 중" : "미사용"}
                  </button>
                </div>
                <div className="text-xs text-neutral-400">
                  개별 비율을 비워두면 상단 공통 비율(계좌 {accountRatioInput || "70"}%, 투네 {toonRatioInput || "60"}%)이 적용됩니다.
                </div>
                {useMemberRatioOverrides && (
                  <div className="overflow-auto rounded border border-white/10">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-neutral-400 border-b border-white/10">
                          <th className="p-2 text-left">멤버</th>
                          <th className="p-2 text-left">계좌 비율 %</th>
                          <th className="p-2 text-left">투네 비율 %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.members.map((m) => (
                          <tr key={m.id} className="border-b border-white/10">
                            <td className="p-2">{m.name}</td>
                            <td className="p-2">
                              <input
                                className="w-full px-2 py-1 rounded bg-neutral-900/80 border border-white/10"
                                placeholder={accountRatioInput || "70"}
                                value={memberRatioInputs[m.id]?.account || ""}
                                onChange={(e) => {
                                  const nextValue = e.target.value.replace(/[^\d.]/g, "");
                                  setMemberRatioInputs((prev) => ({
                                    ...prev,
                                    [m.id]: {
                                      account: nextValue,
                                      toon: prev[m.id]?.toon ?? "",
                                    },
                                  }));
                                }}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                className="w-full px-2 py-1 rounded bg-neutral-900/80 border border-white/10"
                                placeholder={toonRatioInput || "60"}
                                value={memberRatioInputs[m.id]?.toon || ""}
                                onChange={(e) => {
                                  const nextValue = e.target.value.replace(/[^\d.]/g, "");
                                  setMemberRatioInputs((prev) => ({
                                    ...prev,
                                    [m.id]: {
                                      account: prev[m.id]?.account ?? "",
                                      toon: nextValue,
                                    },
                                  }));
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="text-xs text-neutral-400 mt-2">
                계산식: (계좌×계좌비율 + 투네×투네비율) - 세금비율% / 비율은 % 단위로 입력
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
                <span className="text-neutral-200"><ClientTime ts={state.updatedAt} /></span>
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
                    <div className="text-xs text-neutral-400">{it.date} <ClientTime ts={it.entry.at} /></div>
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

function VerticalPreview({ url }: { url: string }) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [showFrame, setShowFrame] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [w, h] = orientation === "portrait" ? [360, 640] : [640, 360];
  const previewUrl = useMemo(() => {
    try {
      const u = new URL(url);
      u.searchParams.set("previewGuide", "true");
      return u.toString();
    } catch {
      return url;
    }
  }, [url]);
  return (
    <div className="rounded border border-white/10 bg-black/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="text-xs text-neutral-400">프리뷰(단일 영상)</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`px-2 py-0.5 rounded border text-xs ${showFrame ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-300"}`}
            onClick={() => setShowFrame(!showFrame)}
            title="장식 프레임"
          >
            프레임
          </button>
          <button
            className={`px-2 py-0.5 rounded border text-xs ${showGuides ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-300"}`}
            onClick={() => setShowGuides(!showGuides)}
            title="안전 구역 가이드"
          >
            가이드
          </button>
          <button
            className="px-2 py-0.5 rounded border text-xs border-white/10 text-neutral-300 hover:border-emerald-500 hover:text-emerald-300"
            onClick={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")}
            title="가로/세로 전환"
          >
            {orientation === "portrait" ? "세로 9:16" : "가로 16:9"}
          </button>
        </div>
      </div>
      <div
        className="relative mx-auto rounded-xl overflow-hidden"
        style={{
          width: "100%",
          maxWidth: w,
          aspectRatio: `${w} / ${h}`,
          border: "1px solid rgba(255,255,255,0.1)",
          background: "#0b0b0b",
          boxShadow: showFrame ? "0 6px 24px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 8px 24px rgba(255,255,255,0.04)" : "none",
        }}
      >
        <iframe src={previewUrl} title="vertical-preview" className="absolute inset-0 w-full h-full" style={{ background: "transparent" }} scrolling="no" />
        {showGuides && (
          <>
            <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 0 1px rgba(0,255,170,0.35)" }} />
            <div className="absolute pointer-events-none" style={{ top: "5%", left: "5%", right: "5%", bottom: "5%", boxShadow: "inset 0 0 0 1px rgba(64,200,255,0.45)" }} />
            <div className="absolute pointer-events-none" style={{ top: "10%", left: "10%", right: "10%", bottom: "10%", boxShadow: "inset 0 0 0 1px rgba(255,200,0,0.5)" }} />
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-1/2 top-0 bottom-0" style={{ width: 1, background: "rgba(255,255,255,0.15)" }} />
              <div className="absolute top-1/2 left-0 right-0" style={{ height: 1, background: "rgba(255,255,255,0.15)" }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
