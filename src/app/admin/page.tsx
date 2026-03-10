"use client";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
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
  appendDailyLog,
  parseTenThousandThousand,
  maskTenThousandThousandInput,
  formatChatLine,
  storageKey,
  dailyLogStorageKey,
  DAILY_LOG_KEY,
  loadDailyLog,
  DailyLogEntry,
  formatManThousand,
  confirmHighAmount,
  MissionItem,
  totalCombined,
} from "@/lib/state";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { appendSettlementRecordAndSync, SettlementMemberRatioOverrides } from "@/lib/settlement";
import { presetToParams, type OverlayPresetLike } from "@/lib/overlay-params";
import MissionBoard from "@/components/MissionBoard";
import MissionBoardSlot from "@/components/MissionBoardSlot";

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
  const [user, setUser] = useState<{ id: string; companyName: string; name?: string; remainingDays?: number | null; unlimited?: boolean } | null>(null);
  const [state, setState] = useState<AppState>(defaultState());
  const [syncStatus, setSyncStatus] = useState<"loading" | "synced" | "local" | "error">("loading");
  const stateUpdatedAtRef = useRef<number>(0);
  const lastLocalPersistAtRef = useRef<number>(0);
  const syncStatusRef = useRef<"loading" | "synced" | "local" | "error">("loading");
  const pendingUnsyncedRef = useRef<boolean>(false);
  const [dailyLog, setDailyLog] = useState<Record<string, DailyLogEntry[]>>({});
  const [donorName, setDonorName] = useState("");
  const [donorAmount, setDonorAmount] = useState("");
  const [donorMemberId, setDonorMemberId] = useState<string | null>(null);
  const [donorTarget, setDonorTarget] = useState<DonorTarget>("account");
  const [copied, setCopied] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatDraftDirty, setChatDraftDirty] = useState(false);
  const [missionTitle, setMissionTitle] = useState("");
  const [missionPrice, setMissionPrice] = useState("");
  const [settlementTitle, setSettlementTitle] = useState("");
  const [accountRatioInput, setAccountRatioInput] = useState("70");
  const [toonRatioInput, setToonRatioInput] = useState("60");
  const [taxRateInput, setTaxRateInput] = useState("3.3");
  const [useMemberRatioOverrides, setUseMemberRatioOverrides] = useState(false);
  const [memberRatioInputs, setMemberRatioInputs] = useState<Record<string, { account: string; toon: string }>>({});
  type OverlayPreset = {
    id: string; name: string; scale: string; memberSize: string; totalSize: string;
    layout?: "center-fixed" | "center";
    zoomMode?: "follow" | "invert" | "neutral";
    dense: boolean; anchor: string; tableFree?: boolean; tableX?: string; tableY?: string; autoFont?: boolean; compact?: boolean; tight?: boolean; lockWidth?: boolean; nameGrow?: boolean; nameCh?: string; tableMarginTop?: string; tableMarginRight?: string; tableMarginBottom?: string; tableMarginLeft?: string; autoFit?: "none" | "width" | "height" | "contain" | "cover"; autoFitPin?: "cc" | "tl" | "tr" | "bl" | "br" | "tc" | "bc" | "cl" | "cr"; box?: "full" | "tight"; noCrop?: boolean; sumAnchor: string; sumFree: boolean; sumX: string; sumY: string;
    theme: string;
    membersTheme?: string;
    totalTheme?: string;
    goalTheme?: string;
    tickerBaseTheme?: string;
    timerTheme?: string;
    missionTheme?: string;
    missionWidth?: string;
    missionDuration?: string;
    missionBgOpacity?: string;
    missionBgColor?: string;
    missionItemColor?: string;
    missionTitleColor?: string;
    missionTitleText?: string;
    missionFontSize?: string;
    missionEffect?: string;
    missionEffectHotOnly?: string;
    missionDisplayMode?: string;
    missionVisibleCount?: string;
    missionSpeed?: string;
    missionGapSize?: string;
    showMembers: boolean; showTotal: boolean;
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
    showBottomDonors?: boolean; donorsSize?: string; donorsGap?: string; donorsSpeed?: string; donorsLimit?: string; donorsFormat?: string; donorsUnit?: string; donorsColor?: string; donorsBgColor?: string; donorsBgOpacity?: string; tickerTheme?: string; tickerGlow?: string; tickerShadow?: string; currencyLocale?: string; tableOnly?: boolean;
    confettiMilestone?: string;
    tableBgOpacity?: string;
    vertical?: boolean;
    accountColor?: string;
    toonColor?: string;
    host?: string;
  };
  const PRESET_STORAGE_KEY = "excel-broadcast-overlay-presets";
  const SETTLEMENT_OPTIONS_KEY = "excel-broadcast-settlement-options-v1";
  const PRESET_TEMPLATES: { name: string; preset: Partial<OverlayPreset> }[] = [
    { name: "엑셀표만", preset: { theme: "excel", showMembers: true, showTotal: true, tableOnly: true } },
    { name: "전체 통합", preset: { showMembers: true, showTotal: true } },
    { name: "표만 (엑셀)", preset: { theme: "excel", showMembers: true, showTotal: true, tableOnly: true } },
    { name: "멤버 목록만", preset: { showMembers: true, showTotal: false, showBottomDonors: false, tickerInMembers: false } },
    { name: "총합만", preset: { showMembers: false, showTotal: true, totalSize: "60" } },
    { name: "목표 프로그레스바", preset: { showMembers: false, showTotal: false, showGoal: true, goal: "500000", goalLabel: "목표 금액", goalWidth: "500" } },
    { name: "개인 골", preset: { showMembers: false, showTotal: false, showPersonalGoal: true, personalGoalAnchor: "tl" } },
    { name: "미션 전광판", preset: { showMembers: false, showTotal: false, showMission: true, missionAnchor: "bc" } },
  ];
  const managePositionInPrism = true;
  const defaultPreset = (name: string, overrides: Partial<OverlayPreset> = {}): OverlayPreset => ({
    id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name,
    scale: "0.75", memberSize: "18", totalSize: "40", dense: true, anchor: "cc",
    layout: "center-fixed", zoomMode: "follow",
    tableFree: false, tableX: "50", tableY: "50",
    sumAnchor: "bc", sumFree: false, sumX: "50", sumY: "90", theme: "default",
    showMembers: true, showTotal: true, showGoal: false, goal: "0", goalLabel: "목표 금액", showPersonalGoal: false, personalGoalTheme: "goalClassic", personalGoalAnchor: "tl", personalGoalLimit: "3", personalGoalFree: false, personalGoalX: "78", personalGoalY: "82",
    tickerInMembers: false, tickerInGoal: false, tickerInPersonalGoal: false,
    goalWidth: "400", goalAnchor: "bc", goalCurrent: "", showTicker: false, tickerAnchor: "bc", tickerWidth: "600", tickerFree: false, tickerX: "50", tickerY: "86", showTimer: false,
    timerStart: null, timerAnchor: "tr", showMission: false, missionAnchor: "br",
    missionWidth: "800", missionDuration: "25",
    membersTheme: "auto", totalTheme: "auto", goalTheme: "auto", tickerBaseTheme: "auto", timerTheme: "auto", missionTheme: "auto",
    showBottomDonors: false, donorsSize: "", donorsGap: "16", donorsSpeed: "20", donorsLimit: "8", donorsFormat: "short", donorsUnit: "", donorsColor: "", donorsBgColor: "", donorsBgOpacity: "0", tickerTheme: "auto", tickerGlow: "45", tickerShadow: "35", currencyLocale: "ko-KR",
    confettiMilestone: "",
    tableBgOpacity: "",
    accountColor: "",
    toonColor: "",
    ...overrides,
  });
  const [presets, setPresets] = useState<OverlayPreset[]>([]);
  const [presetRev, setPresetRev] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const actionConfirmRef = useRef<null | (() => void)>(null);
  const resetInProgressRef = useRef(false);
  const [actionSheet, setActionSheet] = useState<{ open: boolean; title: string; desc: string; confirmText: string; danger: boolean }>({
    open: false,
    title: "",
    desc: "",
    confirmText: "확인",
    danger: true,
  });
  const [resetSheetOpen, setResetSheetOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<"dashboard" | "settlement" | "donor" | "overlay" | "logs">("dashboard");
  const panelCardClass = "rounded-xl border border-white/10 bg-[#252525] shadow-[0_8px_24px_rgba(0,0,0,0.28)]";
  const simpleMode = false;
  const navItems: Array<{ key: "dashboard" | "settlement" | "donor" | "overlay" | "logs"; label: string; targetId: string }> = [
    { key: "dashboard", label: "대시보드", targetId: "dashboard-summary" },
    { key: "settlement", label: "정산 관리", targetId: "settlement-member-board" },
    { key: "donor", label: "후원자", targetId: "donor-management" },
    { key: "overlay", label: "오버레이 설정", targetId: "overlay-settings" },
    { key: "logs", label: "로그 / 데이터", targetId: "logs-data" },
  ];
  const baseThemeChoices = ["default","excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo","neon","neonExcel","retro","minimal","rpg","pastel","rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"];
  const memberThemeChoices = ["auto","default","excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo","minimal","pastel","retro","rpg"];
  const missionThemeChoices = ["auto","default","excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo","neon","neonExcel","rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice","minimal","pastel","retro","rpg"];
  const themeStyle = (id: string): React.CSSProperties => {
    const map: Record<string, React.CSSProperties> = {
      default: { background: "linear-gradient(135deg,#111,#333)" },
      minimal: { background: "linear-gradient(135deg,#0b0b0b,#1f2937)" },
      retro: { background: "linear-gradient(135deg,#7c2d12,#ca8a04)" },
      rpg: { background: "linear-gradient(135deg,#1b1b1b,#3f3f46)" },
      pastel: { background: "linear-gradient(135deg,#f5d0fe,#bfdbfe)" },
      excel: { background: "linear-gradient(135deg,#065f46,#34d399)" },
      excelBlue: { background: "linear-gradient(135deg,#1e3a8a,#60a5fa)" },
      excelSlate: { background: "linear-gradient(135deg,#0f172a,#334155)" },
      excelAmber: { background: "linear-gradient(135deg,#92400e,#f59e0b)" },
      excelRose: { background: "linear-gradient(135deg,#9f1239,#fb7185)" },
      excelNavy: { background: "linear-gradient(135deg,#0b132b,#1c2541)" },
      excelTeal: { background: "linear-gradient(135deg,#0f766e,#5eead4)" },
      excelPurple: { background: "linear-gradient(135deg,#5b21b6,#c084fc)" },
      excelEmerald: { background: "linear-gradient(135deg,#064e3b,#10b981)" },
      excelOrange: { background: "linear-gradient(135deg,#7c2d12,#fb923c)" },
      excelIndigo: { background: "linear-gradient(135deg,#3730a3,#818cf8)" },
      neon: { background: "linear-gradient(135deg,#06b6d4,#a78bfa,#f472b6)" },
      neonExcel: { background: "linear-gradient(135deg,#10b981,#22d3ee,#f472b6)" },
      rainbow: { background: "linear-gradient(90deg,#ef4444,#f59e0b,#10b981,#3b82f6,#8b5cf6)" },
      sunset: { background: "linear-gradient(135deg,#fb923c,#ef4444,#7c3aed)" },
      ocean: { background: "linear-gradient(135deg,#0ea5e9,#22d3ee,#10b981)" },
      forest: { background: "linear-gradient(135deg,#065f46,#16a34a,#22c55e)" },
      aurora: { background: "linear-gradient(135deg,#22d3ee,#a78bfa,#34d399)" },
      violet: { background: "linear-gradient(135deg,#7c3aed,#a78bfa)" },
      coral: { background: "linear-gradient(135deg,#fb7185,#f59e0b)" },
      mint: { background: "linear-gradient(135deg,#14b8a6,#a7f3d0)" },
      lava: { background: "linear-gradient(135deg,#ef4444,#f97316,#f59e0b)" },
      ice: { background: "linear-gradient(135deg,#67e8f9,#bae6fd)" },
    };
    return map[id] || map.default;
  };
  const ThemeThumbs = ({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) => (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-md border ${value === opt ? "border-emerald-400" : "border-white/10"} overflow-hidden`}
          title={opt}
          style={{ width: 48, height: 28 }}
        >
          <div className="w-full h-full" style={themeStyle(opt)} />
        </button>
      ))}
    </div>
  );
  
  const moveToSection = (key: "dashboard" | "settlement" | "donor" | "overlay" | "logs", targetId: string) => {
    setActiveNav(key);
    if (typeof window === "undefined") return;
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const toColorPickerValue = (raw?: string, fallback = "#ffffff") => {
    const v = (raw || "").trim();
    const m = v.match(/^#([0-9a-fA-F]{6})$/);
    return m ? `#${m[1].toLowerCase()}` : fallback;
  };
  const requestConfirm = (title: string, desc: string, onConfirm: () => void, options?: { confirmText?: string; danger?: boolean }) => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile) {
      const text = desc ? `${title}\n\n${desc}` : title;
      if (window.confirm(text)) onConfirm();
      return;
    }
    actionConfirmRef.current = onConfirm;
    setActionSheet({
      open: true,
      title,
      desc,
      confirmText: options?.confirmText || "확인",
      danger: options?.danger ?? true,
    });
  };
  const closeActionSheet = () => {
    actionConfirmRef.current = null;
    setActionSheet((prev) => ({ ...prev, open: false }));
  };

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.user) {
          setUser(data.user);
        } else {
          router.replace("/login");
        }
      });
  }, [router]);

  useEffect(() => {
    stateUpdatedAtRef.current = state.updatedAt || 0;
  }, [state.updatedAt]);
  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  useEffect(() => {
    if (!user) return;
    let localPresets: OverlayPreset[] = [];
    setDailyLog(loadDailyLog(user?.id));
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
    loadStateFromApi(user?.id).then((apiState) => {
      if (apiState) {
        setState(apiState);
        if (Array.isArray(apiState.overlayPresets) && apiState.overlayPresets.length > 0) {
          setPresets(apiState.overlayPresets as OverlayPreset[]);
        } else if (localPresets.length > 0) {
          const next = { ...apiState, overlayPresets: localPresets };
          setState(next);
          persistState(next);
        } else {
          const first = defaultPreset("전체 통합", { showMembers: true, showTotal: true });
          const merged = { ...apiState, overlayPresets: [first] };
          setPresets([first]);
          setState(merged);
          persistState(merged);
          try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify([first])); } catch {}
        }
        setSyncStatus("synced");
        try { window.localStorage.setItem(storageKey(user?.id), JSON.stringify(apiState)); } catch {}
      } else {
        const local = loadState(user?.id);
        if (Array.isArray(local.overlayPresets) && local.overlayPresets.length > 0) {
          setPresets(local.overlayPresets as OverlayPreset[]);
        } else if (localPresets.length > 0) {
          local.overlayPresets = localPresets;
          setPresets(localPresets);
        } else {
          const first = defaultPreset("전체 통합", { showMembers: true, showTotal: true });
          local.overlayPresets = [first];
          setPresets([first]);
          try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify([first])); } catch {}
        }
        setState(local);
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setSyncStatus(offline ? "local" : "error");
        // 의미 있는 데이터가 있을 때만 서버에 업로드 (초기 기본값 덮어쓰기 방지)
        const hasMeaningfulData = totalCombined(local) > 0 || (local.donors && local.donors.length > 0);
        if (!offline && hasMeaningfulData) {
          saveStateAsync(local, user?.id).then((ok) => { if (ok) setSyncStatus("synced"); });
        }
      }
    });
  }, [user]);

  // Keep admin amounts synchronized across mobile/PC sessions.
  // Server state is treated as source of truth across devices.
  useEffect(() => {
    if (!user) return;
    let running = true;
    let inFlight = false;
    const syncFromApi = async () => {
      if (!running || inFlight) return;
      inFlight = true;
      try {
        const remote = await loadStateFromApi(user?.id);
        if (!remote) {
          if (typeof navigator !== "undefined" && !navigator.onLine) setSyncStatus("local");
          else setSyncStatus("error");
          return;
        }
        setSyncStatus("synced");
        const remoteUpdatedAt = remote.updatedAt || 0;
        const shouldApplyRemote = remoteUpdatedAt !== stateUpdatedAtRef.current;
        if (shouldApplyRemote) {
          stateUpdatedAtRef.current = remoteUpdatedAt;
          setState(remote);
          if (Array.isArray(remote.overlayPresets)) {
            setPresets(remote.overlayPresets as OverlayPreset[]);
          }
          pendingUnsyncedRef.current = false;
          try { window.localStorage.setItem(storageKey(user?.id), JSON.stringify(remote)); } catch {}
        }
      } finally {
        inFlight = false;
      }
    };
    const onFocus = () => { void syncFromApi(); };
    const onOnline = () => { setSyncStatus("loading"); void syncFromApi(); };
    const onOffline = () => { setSyncStatus("local"); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void syncFromApi();
    };
    const timer = window.setInterval(() => { void syncFromApi(); }, 1200);
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    void syncFromApi();
    return () => {
      running = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user]);

  const savePresets = (next: OverlayPreset[]) => {
    setPresets(next);
    try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(next)); } catch {}
    setState((prev) => {
      const merged: AppState = { ...prev, overlayPresets: next };
      persistState(merged);
      return merged;
    });
  };
  // 상단바 전용 프리셋 기능 제거됨
  const addPreset = (name: string, overrides: Partial<OverlayPreset> = {}) => {
    const p = defaultPreset(name, overrides);
    savePresets([...presets, p]);
    setEditingId(p.id);
  };
  const updatePreset = (id: string, patch: Partial<OverlayPreset>) => {
    const nextPresets = presets.map(p => p.id === id ? { ...p, ...patch } : p);
    setPresets(nextPresets);
    try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(nextPresets)); } catch {}
    setState((prev: AppState) => {
      const merged: AppState = {
        ...prev,
        overlayPresets: nextPresets,
        overlaySettings: { ...(prev.overlaySettings || {}), currentPresetId: id },
      };
      persistState(merged);
      return merged;
    });
    setPresetRev((r) => r + 1);
  };
  const removePreset = (id: string) => {
    requestConfirm("오버레이 프리셋 삭제", "이 오버레이 프리셋을 삭제할까요?", () => {
      savePresets(presets.filter(p => p.id !== id));
      if (editingId === id) setEditingId(null);
    }, { confirmText: "삭제", danger: true });
  };
  const buildOverlayUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const q = new URLSearchParams();
    q.set("p", p.id);
    q.set("u", user?.id || "finalent");
    return `${base}?${q.toString()}`;
  };
  const buildPrismOverlayUrl = (p: OverlayPreset, vertical: boolean): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    // Prism용은 최소 파라미터만 포함(옵션은 서버 프리셋/Prism에서 조정)
    const q = new URLSearchParams();
    q.set("p", p.id);
    q.set("u", user?.id || "finalent");
    q.set("vertical", vertical ? "true" : "false");
    q.set("host", "prism");
    // 프리셋 저장/전파 지연 시에도 즉시 반영되도록 핵심 미션 옵션은 URL로 보강
    if ((p as any).missionDisplayMode) q.set("displayMode", String((p as any).missionDisplayMode));
    if ((p as any).missionVisibleCount) q.set("visibleCount", String((p as any).missionVisibleCount));
    if ((p as any).missionSpeed) q.set("missionSpeed", String((p as any).missionSpeed));
    if ((p as any).missionGapSize) q.set("gapSize", String((p as any).missionGapSize));
    if ((p as any).missionEffect) q.set("missionEffect", String((p as any).missionEffect));
    if ((p as any).missionEffectHotOnly) q.set("missionEffectHotOnly", String((p as any).missionEffectHotOnly) === "true" ? "true" : "false");
    return `${base}?${q.toString()}`;
  };
  const buildPreviewOverlayUrl = (p: OverlayPreset): string => {
    const url = buildOverlayUrl(p);
    const u = new URL(url);
    u.searchParams.set("previewGuide", "true");
    const isVertical = u.searchParams.get("vertical") === "true" || !!p.vertical;
    u.searchParams.set("renderWidth", isVertical ? "1080" : "1920");
    u.searchParams.set("renderHeight", isVertical ? "1920" : "1080");
    return u.toString();
  };
  const buildStablePreviewUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const q = new URLSearchParams(presetToParams(p));
    q.set("p", p.id);
    q.set("u", user?.id || "finalent");
    q.set("previewGuide", "true");
    const isVertical = !!p.vertical;
    q.set("renderWidth", isVertical ? "1080" : "1920");
    q.set("renderHeight", isVertical ? "1920" : "1080");
    try {
      const snapObj = {
        members: state.members.map(m => ({ id: m.id, name: m.name, account: m.account, toon: m.toon, goal: m.goal, role: m.role, operating: m.operating })),
        donors: [],
        missions: (state as any).missions || [],
        forbiddenWords: state.forbiddenWords || [],
        goal: (() => { const n = parseInt((p.goal || "0") as any, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; })(),
        goalCurrent: (() => {
          const raw = (p.goalCurrent || "") as any;
          const n = raw === "" || raw === null || raw === undefined ? null : parseInt(String(raw), 10);
          return n === null || Number.isNaN(n) ? null : Math.max(0, n);
        })(),
        updatedAt: Date.now(),
      };
      const json = JSON.stringify(snapObj);
      const b64 = btoa(encodeURIComponent(json));
      q.set("snap", b64);
    } catch {}
    return `${base}?${q.toString()}`;
  };
  const copyUrl = async (url: string, id: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url); }
      else { const ta = document.createElement("textarea"); ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };
  const buildEmergencySnapshotUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const snapObj = {
      members: state.members.map(m => ({ id: m.id, name: m.name, account: m.account, toon: m.toon, goal: m.goal, role: m.role, operating: m.operating })),
      donors: [],
      missions: (state as any).missions || [],
      forbiddenWords: state.forbiddenWords || [],
      goal: (() => { const n = parseInt((p.goal || "0") as any, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; })(),
      goalCurrent: (() => {
        const raw = (p.goalCurrent || "") as any;
        const n = raw === "" || raw === null || raw === undefined ? null : parseInt(String(raw), 10);
        return n === null || Number.isNaN(n) ? null : Math.max(0, n);
      })(),
      updatedAt: Date.now(),
    };
    const json = JSON.stringify(snapObj);
    const b64 = btoa(encodeURIComponent(json));
    const q = new URLSearchParams();
    q.set("p", p.id);
    q.set("u", user?.id || "finalent");
    q.set("snap", b64);
    return `${base}?${q.toString()}`;
  };

  const persistState = (s: AppState) => {
    lastLocalPersistAtRef.current = Date.now();
    pendingUnsyncedRef.current = true;
    setSyncStatus("loading");
    saveStateAsync(s, user?.id).then((ok) => {
      if (ok) {
        pendingUnsyncedRef.current = false;
        setSyncStatus("synced");
      } else {
        // 서버 실패 시에도 로컬 저장은 된 상태 → 로컬 모드로 전환
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setSyncStatus(offline ? "local" : "error");
      }
    });
  };

  useEffect(() => {
    setChatDraft(formatChatLine(state));
    setChatDraftDirty(false);
  }, [state]);

  useEffect(() => {
    // Retry unsynced writes quickly to minimize cross-device drift.
    const id = setInterval(() => {
      if (pendingUnsyncedRef.current || syncStatusRef.current === "error") {
        persistState(state);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [state]);

  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const key = storageKey(user.id);
    const dailyKey = dailyLogStorageKey(user.id);
    const handler = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          const incoming = JSON.parse(e.newValue) as AppState;
          setState(incoming);
        } catch {
          // ignore
        }
      } else if (e.key === dailyKey) {
        setDailyLog(loadDailyLog(user.id));
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [user?.id]);

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
    requestConfirm("모든 멤버 금액 리셋", "모든 멤버의 계좌/투네를 0으로 리셋할까요?", () => {
      setState((prev: AppState) => {
        const next: AppState = {
          ...prev,
          members: prev.members.map((x: Member) => ({ ...x, account: 0, toon: 0 })),
        };
        persistState(next);
        return next;
      });
    }, { confirmText: "리셋", danger: true });
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
    requestConfirm("멤버 삭제", warn, () => {
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
    }, { confirmText: "삭제", danger: true });
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

  const isOperatingMember = (m: Member) => Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(m.role || "");
  const total = useMemo(
    () => state.members.reduce((sum, m) => sum + (m.account || 0) + (m.toon || 0), 0),
    [state.members]
  );
  const activeMemberCount = useMemo(
    () => state.members.filter((m) => !isOperatingMember(m)).length,
    [state.members]
  );
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

  const onResetKeepMembers = () => {
    if (resetInProgressRef.current) return;
    const total = totalCombined(state);
    const hasDonors = state.donors.length > 0;
    if (total === 0 && !hasDonors) {
      setResetSheetOpen(false);
      return;
    }
    resetInProgressRef.current = true;
    setResetSheetOpen(false);
    appendDailyLog(state, user?.id);
    setDailyLog(loadDailyLog(user?.id));
    const next: AppState = {
      ...state,
      members: state.members.map((m) => ({ ...m, account: 0, toon: 0 })),
      donors: [],
      overlayPresets: state.overlayPresets || [],
      missions: state.missions || [],
      updatedAt: Date.now(),
    };
    setState(next);
    persistState(next);
    resetInProgressRef.current = false;
  };
  const onResetInitMembers = () => {
    if (resetInProgressRef.current) return;
    const total = totalCombined(state);
    const hasDonors = state.donors.length > 0;
    if (total === 0 && !hasDonors) {
      setResetSheetOpen(false);
      return;
    }
    resetInProgressRef.current = true;
    setResetSheetOpen(false);
    appendDailyLog(state, user?.id);
    setDailyLog(loadDailyLog(user?.id));
    const next = {
      ...defaultState(),
      overlayPresets: state.overlayPresets || [],
      missions: state.missions || [],
    };
    setState(next);
    persistState(next);
    resetInProgressRef.current = false;
  };

  const onSnapshotNow = () => {
    appendDailyLog(state, user?.id);
    setDailyLog(loadDailyLog(user?.id));
  };
  const onFetchLatestFromServer = async () => {
    setSyncStatus("loading");
    const remote = await loadStateFromApi(user?.id);
    if (!remote) {
      setSyncStatus("error");
      if (typeof window !== "undefined") window.alert("서버에서 상태를 가져오지 못했습니다.");
      return;
    }
    stateUpdatedAtRef.current = remote.updatedAt || 0;
    pendingUnsyncedRef.current = false;
    setState(remote);
    if (Array.isArray(remote.overlayPresets)) {
      setPresets(remote.overlayPresets as OverlayPreset[]);
      try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(remote.overlayPresets)); } catch {}
    }
    try { window.localStorage.setItem(storageKey(user?.id), JSON.stringify(remote)); } catch {}
    setSyncStatus("synced");
  };
  const runPullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    await onFetchLatestFromServer();
    window.setTimeout(() => {
      setPullRefreshing(false);
      setPullDistance(0);
    }, 240);
  };
  const handleTouchStart = (e: any) => {
    if (typeof window === "undefined") return;
    if (window.scrollY <= 0) touchStartYRef.current = e.touches?.[0]?.clientY ?? null;
  };
  const handleTouchMove = (e: any) => {
    if (typeof window === "undefined") return;
    if (touchStartYRef.current === null || window.scrollY > 0) return;
    const delta = (e.touches?.[0]?.clientY ?? 0) - touchStartYRef.current;
    if (delta <= 0) return;
    setPullDistance(Math.min(88, Math.round(delta * 0.45)));
  };
  const handleTouchEnd = () => {
    touchStartYRef.current = null;
    if (pullDistance >= 64) {
      void runPullRefresh();
      return;
    }
    setPullDistance(0);
  };
  const onDownloadLog = () => {
    const raw = JSON.stringify(loadDailyLog(user?.id), null, 2);
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
    appendDailyLog(state, user?.id);
    const rec = await appendSettlementRecordAndSync(title, state.members, accountRatio, toonRatio, taxRate, memberRatioOverrides, state.donors, user?.id);
    router.push(`/settlements/${rec.id}`);
  };

  return (
    <main
      className="min-h-screen p-4 md:p-8 pb-24 md:pb-10 text-neutral-100"
      style={{ backgroundColor: "#1a1a1a" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Toast />
      <div className="lg:hidden fixed left-1/2 -translate-x-1/2 top-2 z-40 pointer-events-none">
        <div
          className={`px-3 py-1 rounded-full text-[11px] border border-white/10 transition-all ${
            pullRefreshing ? "bg-[#22c55e]/30 text-[#86efac]" : "bg-black/50 text-neutral-300"
          }`}
          style={{ opacity: pullDistance > 8 || pullRefreshing ? 1 : 0, transform: `translateY(${Math.min(18, pullDistance * 0.28)}px)` }}
        >
          {pullRefreshing ? "동기화 중..." : pullDistance >= 64 ? "놓아서 동기화" : "아래로 당겨 동기화"}
        </div>
      </div>
      <div className="mx-auto max-w-[1600px] grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
        <aside className="hidden lg:block lg:sticky lg:top-6 self-start rounded-xl border border-white/10 bg-[#222222] p-3 h-fit">
          <div className="text-xs uppercase tracking-[0.12em] text-neutral-400 px-2 pb-2">메뉴</div>
          <div className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => moveToSection(item.key, item.targetId)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeNav === item.key
                    ? "bg-indigo-500 text-white"
                    : "bg-transparent text-neutral-300 hover:bg-white/5"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>
        <div>
        <div className="flex flex-wrap items-start sm:items-center justify-between gap-2 mb-6">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-2xl font-bold">{user?.companyName || "매니저"} 정산 시스템</h1>
            {(user?.remainingDays != null || user?.unlimited) && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${user?.unlimited ? "bg-blue-900/60 text-blue-300" : (user?.remainingDays ?? 0) <= 7 ? "bg-amber-900/60 text-amber-300" : "bg-neutral-800 text-neutral-400"}`}>
                {user?.unlimited ? "무제한" : `남은 일수: ${user?.remainingDays ?? 0}일`}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${syncStatus === "synced" ? "bg-emerald-900/60 text-emerald-300" : syncStatus === "loading" ? "bg-yellow-900/60 text-yellow-300" : syncStatus === "error" ? "bg-amber-900/60 text-amber-300" : "bg-neutral-800 text-neutral-400"}`}>
              {syncStatus === "synced" ? "서버 동기화됨" : syncStatus === "loading" ? "동기화 중..." : syncStatus === "error" ? "연결 재시도 중" : "로컬 모드 (오프라인)"}
            </span>
            <button
              className="px-2 py-1 rounded bg-[#22c55e] hover:bg-[#16a34a] text-xs font-medium text-white"
              onClick={onFetchLatestFromServer}
              title="로컬이 리셋되었을 때 서버 최신 상태를 다시 가져옵니다"
            >
              서버에서 가져오기
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                router.push("/login");
                router.refresh();
              }}
            >
              로그아웃
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Link className="text-sm text-neutral-300 underline" href="/settlements">정산 기록 보기</Link>
          </div>
        </div>
        <section id="dashboard-summary" className={`${panelCardClass} p-4 mb-6`}>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg bg-[#1e1e1e] border border-white/10 px-3 py-2">
              <div className="text-xs text-neutral-400">오늘 총 후원액</div>
              <div className="text-xl font-bold text-white">{formatManThousand(total)}</div>
            </div>
            <div className="rounded-lg bg-[#1e1e1e] border border-white/10 px-3 py-2">
              <div className="text-xs text-neutral-400">후원 건수</div>
              <div className="text-xl font-bold text-[#6366f1]">{state.donors.length.toLocaleString("ko-KR")}</div>
            </div>
            <div className="rounded-lg bg-[#1e1e1e] border border-white/10 px-3 py-2">
              <div className="text-xs text-neutral-400">멤버 수</div>
              <div className="text-xl font-bold text-[#22c55e]">{activeMemberCount.toLocaleString("ko-KR")}</div>
            </div>
          </div>
        </section>
        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-6">
            <section id="settlement-member-board" className={`${panelCardClass} p-4 md:p-6`}>
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
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {state.members.map((m: Member) => (
                  <MemberRow key={m.id} member={m} onChange={updateMember} onRename={renameMember} onReset={resetMemberAmounts} onDelete={deleteMember} />
                ))}
              </div>
            </section>

            <section id="donor-management" className={`${panelCardClass} p-4 md:p-6`}>
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

            <section className={`${panelCardClass} p-4 md:p-6 ${simpleMode ? "hidden" : ""}`}>
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

            <section className={`${panelCardClass} p-4 md:p-6 ${simpleMode ? "hidden" : ""}`}>
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
                                  requestConfirm("후원 기록 삭제", "해당 후원 기록을 삭제할까요?", () => {
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
                                  }, { confirmText: "삭제", danger: true });
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

            <section className={`${panelCardClass} p-4 md:p-6 ${simpleMode ? "hidden" : ""}`}>
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

            <section className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">미션 전광판</h2>
                <button
                  className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs"
                  onClick={() => {
                    requestConfirm("미션 전광판 초기화", "계정에 저장된 모든 미션을 삭제할까요?", () => {
                      setState((prev) => {
                        const next = { ...prev, missions: [] };
                        persistState(next);
                        return next;
                      });
                    }, { confirmText: "초기화", danger: true });
                  }}
                >
                  초기화
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 mb-3">
                <input className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 min-h-[44px]" placeholder="미션 제목 (예: 노래 부르기)" value={missionTitle} onChange={(e) => setMissionTitle(e.target.value)} />
                <input className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 w-full sm:w-32 min-h-[44px]" placeholder="가격 (예: 3만)" value={missionPrice} onChange={(e) => setMissionPrice(e.target.value)} />
                <button className="px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 font-semibold min-h-[44px]" onClick={() => {
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
                <div className="space-y-1 max-h-[340px] overflow-auto">
                  {(state.missions || []).map((mis, idx) => (
                    <div key={mis.id}
                      className="flex items-center gap-2 px-3 py-2 rounded bg-neutral-900/40 border border-white/10 min-h-[44px]"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(idx)); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const src = parseInt(e.dataTransfer.getData("text/plain") || "-1", 10);
                        if (isNaN(src) || src < 0 || src === idx) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          const [moved] = arr.splice(src, 1);
                          arr.splice(idx, 0, moved);
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}
                    >
                      <span className="text-sm font-mono text-neutral-500 w-6">{idx + 1}</span>
                      <input className="flex-1 px-2 py-1 rounded bg-neutral-800 border border-white/10 text-sm min-h-[40px]" value={mis.title} onChange={(e) => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, title: e.target.value } : m) };
                          persistState(next); return next;
                        });
                      }} />
                      <input className="w-24 px-2 py-1 rounded bg-neutral-800 border border-white/10 text-sm text-right min-h-[40px]" value={mis.price} onChange={(e) => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, price: e.target.value } : m) };
                          persistState(next); return next;
                        });
                      }} />
                      <button className={`px-2 py-1 rounded border text-xs min-h-[36px] ${mis.isHot ? "border-red-500 text-red-300" : "border-white/10 text-neutral-500"}`} onClick={() => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, isHot: !m.isHot } : m) };
                          persistState(next); return next;
                        });
                      }}>{mis.isHot ? "HOT" : "hot"}</button>
                      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs min-h-[36px]" onClick={() => {
                        if (idx === 0) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}>▲</button>
                      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs min-h-[36px]" onClick={() => {
                        if (idx >= (state.missions || []).length - 1) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}>▼</button>
                      <button className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs min-h-[36px]" onClick={() => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).filter(m => m.id !== mis.id) };
                          persistState(next); return next;
                        });
                      }}>삭제</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-neutral-400 mt-2">오버레이 프리셋에서 &quot;미션 전광판&quot;을 ON하면 우측→좌측 흐름으로 방송 화면에 표시됩니다.</div>
            </section>

            <section id="overlay-settings" className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">오버레이 관리 (다중)</h2>
                <div className="flex gap-1 flex-wrap">
                  {PRESET_TEMPLATES.map((t) => (
                    <button key={t.name} className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white" onClick={() => addPreset(t.name, t.preset)}>+ {t.name}</button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-neutral-400 mb-3">각 오버레이는 독립 URL을 가집니다. OBS/Prism에 브라우저 소스로 각각 추가하세요.</p>
              <p className="text-xs text-neutral-500 mb-3">위치/크기 조정은 Prism에서 진행하고, 여기 프리뷰는 형태/디자인과 실시간 상태 업데이트 확인용으로 사용하세요. Prism 브라우저 소스 크기를 1080×1920(세로)으로 맞추면 프리뷰와 방송 화면이 일치합니다.</p>
              {presets.length === 0 && (
                <div className="text-sm text-neutral-400 p-6 text-center border border-dashed border-white/10 rounded">아직 오버레이가 없습니다. 위 버튼으로 추가하세요.</div>
              )}
              <div className="space-y-3">
                {presets.map((p) => {
                  const url = buildPrismOverlayUrl(p, !!p.vertical);
                  const previewUrl = buildStablePreviewUrl(p);
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
                        <button className={`px-2 py-1 rounded text-xs ${copiedId === p.id ? "bg-[#22c55e]" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={(e) => { e.stopPropagation(); copyUrl(url, p.id); }}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                        <button className="px-2 py-1 rounded bg-[#ef4444] hover:bg-[#dc2626] text-xs text-white" onClick={(e) => { e.stopPropagation(); removePreset(p.id); }}>삭제</button>
                      </div>
                      {isOpen && (
                        <div className={`px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-3 border-t border-white/10 pt-3 ${simpleMode ? "hidden" : ""}`}>
                          <div className="space-y-2 lg:order-2">
                            <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                              <label className="text-xs text-neutral-400">테마</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.theme} onChange={(e) => updatePreset(p.id, { theme: e.target.value })}>
                                <option value="default">기본</option>
                                <option value="excel">엑셀(녹색)</option><option value="excelBlue">엑셀(파랑)</option><option value="excelSlate">엑셀(슬레이트)</option><option value="excelAmber">엑셀(앰버)</option><option value="excelRose">엑셀(로즈)</option><option value="excelNavy">엑셀(네이비)</option><option value="excelTeal">엑셀(틸)</option><option value="excelPurple">엑셀(퍼플)</option><option value="excelEmerald">엑셀(에메랄드)</option><option value="excelOrange">엑셀(오렌지)</option><option value="excelIndigo">엑셀(인디고)</option>
                                <option value="neon">네온</option><option value="neonExcel">네온 엑셀</option><option value="retro">레트로</option><option value="minimal">미니멀</option><option value="rpg">RPG</option><option value="pastel">파스텔</option>
                                <option value="rainbow">무지개</option><option value="sunset">일몰</option><option value="ocean">오션</option><option value="forest">포레스트</option><option value="aurora">오로라</option><option value="violet">바이올렛</option><option value="coral">코랄</option><option value="mint">민트</option><option value="lava">라바</option><option value="ice">아이스</option>
                              </select>
                              {/* Palette view removed per user preference; compact select retained */}
                              {(p.showMembers || p.showTotal) && (
                                <>
                                  <label className="text-xs text-neutral-400">멤버·총합 테마</label>
                                  <select
                                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                    value={p.membersTheme || "auto"}
                                    onChange={(e) => updatePreset(p.id, { membersTheme: e.target.value, totalTheme: e.target.value })}
                                  >
                                    <option value="auto">자동(전체 테마 따름)</option>
                                    <option value="default">기본</option>
                                    <option value="excel">엑셀(녹색)</option><option value="excelBlue">엑셀(파랑)</option><option value="excelSlate">엑셀(슬레이트)</option><option value="excelAmber">엑셀(앰버)</option><option value="excelRose">엑셀(로즈)</option><option value="excelNavy">엑셀(네이비)</option><option value="excelTeal">엑셀(틸)</option><option value="excelPurple">엑셀(퍼플)</option><option value="excelEmerald">엑셀(에메랄드)</option><option value="excelOrange">엑셀(오렌지)</option><option value="excelIndigo">엑셀(인디고)</option>
                                    <option value="minimal">미니멀</option><option value="pastel">파스텔</option><option value="retro">레트로</option><option value="rpg">RPG</option>
                                  </select>
                                  {/* Palette view removed; keep compact select */}
                                  <label className="text-xs text-neutral-400">표 배경 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="0" max="100" value={p.tableBgOpacity || "100"} onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value })} className="flex-1 accent-emerald-500" />
                                    <input className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right" value={p.tableBgOpacity || "100"} onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value.replace(/[^\\d]/g, "") })} />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                </>
                              )}
                              {p.showGoal && (
                                <>
                                  <label className="text-xs text-neutral-400">목표바 테마</label>
                                  <select
                                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                    value={p.goalTheme || "auto"}
                                    onChange={(e) => updatePreset(p.id, { goalTheme: e.target.value })}
                                  >
                                    <option value="auto">자동(전체 테마 따름)</option>
                                    <option value="default">기본</option>
                                    <option value="excel">엑셀(녹색)</option><option value="excelBlue">엑셀(파랑)</option><option value="excelSlate">엑셀(슬레이트)</option><option value="excelAmber">엑셀(앰버)</option><option value="excelRose">엑셀(로즈)</option><option value="excelNavy">엑셀(네이비)</option><option value="excelTeal">엑셀(틸)</option><option value="excelPurple">엑셀(퍼플)</option><option value="excelEmerald">엑셀(에메랄드)</option><option value="excelOrange">엑셀(오렌지)</option><option value="excelIndigo">엑셀(인디고)</option>
                                    <option value="minimal">미니멀</option><option value="pastel">파스텔</option><option value="retro">레트로</option><option value="rpg">RPG</option>
                                  </select>
                                  {/* Palette view removed; keep compact select */}
                                </>
                              )}
                              <label className="text-xs text-neutral-400">안가림 모드</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.noCrop !== false ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { noCrop: !(p.noCrop !== false) })}>
                                {p.noCrop !== false ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">Prism 영역</label>
                              <select
                                className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                value={p.box || "full"}
                                onChange={(e) => updatePreset(p.id, { box: e.target.value as any })}
                              >
                                <option value="full">전체(1920x1080/1080x1920)</option>
                                <option value="tight">콘텐츠만(여백 제거)</option>
                              </select>
                              <label className="text-xs text-neutral-400">중앙 고정 레이아웃</label>
                              <button
                                className={`px-2 py-0.5 rounded border text-xs ${p.layout === "center-fixed" ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`}
                                onClick={() => updatePreset(p.id, { layout: p.layout === "center-fixed" ? undefined : "center-fixed" })}
                                type="button"
                              >
                                {p.layout === "center-fixed" ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">줌 반응</label>
                              <select
                                className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                value={p.zoomMode || "follow"}
                                onChange={(e) => updatePreset(p.id, { zoomMode: e.target.value as any })}
                              >
                                <option value="follow">정상(확대=커짐)</option>
                                <option value="invert">반전(확대=작아짐)</option>
                                <option value="neutral">무시(크기 고정)</option>
                              </select>
                              <label className={`text-xs ${p.tableFree ? "text-neutral-600" : "text-neutral-400"}`}>표 위치(앵커)</label>
                              <select
                                className={`px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm ${(p.tableFree || p.layout === "center-fixed") ? "opacity-60 cursor-not-allowed" : ""}`}
                                value={p.anchor || "cc"}
                                onChange={(e) => updatePreset(p.id, { anchor: e.target.value })}
                                disabled={!!p.tableFree || p.layout === "center-fixed"}
                              >
                                <option value="tl">상좌</option>
                                <option value="tc">상중</option>
                                <option value="tr">상우</option>
                                <option value="cl">중좌</option>
                                <option value="cc">중앙</option>
                                <option value="cr">중우</option>
                                <option value="bl">하좌</option>
                                <option value="bc">하중</option>
                                <option value="br">하우</option>
                              </select>
                              <label className={`text-xs ${p.tableFree ? "text-neutral-600" : "text-neutral-400"}`}>표 여백(px)</label>
                              <div className={`grid grid-cols-2 gap-2 ${p.tableFree ? "opacity-60 pointer-events-none" : ""}`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-neutral-500 w-6">상</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginTop || "0"} onChange={(e) => updatePreset(p.id, { tableMarginTop: e.target.value.replace(/[^\d-]/g, "") })} />
                                  <span className="text-[11px] text-neutral-500 w-6">하</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginBottom || "0"} onChange={(e) => updatePreset(p.id, { tableMarginBottom: e.target.value.replace(/[^\d-]/g, "") })} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-neutral-500 w-6">좌</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginLeft || "0"} onChange={(e) => updatePreset(p.id, { tableMarginLeft: e.target.value.replace(/[^\d-]/g, "") })} />
                                  <span className="text-[11px] text-neutral-500 w-6">우</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginRight || "0"} onChange={(e) => updatePreset(p.id, { tableMarginRight: e.target.value.replace(/[^\d-]/g, "") })} />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {[
                                  { label: "상단바(중앙)", anchor: "tc" },
                                  { label: "상단바(좌)", anchor: "tl" },
                                  { label: "상단바(우)", anchor: "tr" },
                                ].map(({ label, anchor }) => (
                                  <button
                                    key={label}
                                    type="button"
                                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                    onClick={() => updatePreset(p.id, { tableFree: false, anchor, compact: true, tight: true })}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                              <label className="text-xs text-neutral-400">표 자유 위치</label>
                              <div className={`flex items-center gap-2 ${p.layout === "center-fixed" ? "opacity-60 pointer-events-none" : ""}`}>
                                <button
                                  className={`px-2 py-0.5 rounded border text-xs ${p.tableFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`}
                                  onClick={() => updatePreset(p.id, { tableFree: !p.tableFree })}
                                  type="button"
                                >
                                  {p.tableFree ? "자유 위치 ON" : "자유 위치 OFF"}
                                </button>
                                <span className="text-[10px] text-neutral-500">(X/Y 비율로 중앙점 지정)</span>
                              </div>
                              {p.tableFree && (
                                <>
                                  <label className="text-xs text-neutral-400">표 X%</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range" min="0" max="100"
                                      value={p.tableX || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableX: String(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10)))) })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      value={p.tableX || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableX: e.target.value.replace(/[^\\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">표 Y%</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range" min="0" max="100"
                                      value={p.tableY || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableY: String(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10)))) })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      value={p.tableY || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableY: e.target.value.replace(/[^\\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                </>
                              )}
                              <label className="text-xs text-neutral-400">배율</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="0.5"
                                  max="4"
                                  step="0.05"
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
                              <label className="text-xs text-neutral-400">Prism 맞춤</label>
                              <select
                                className={`px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm ${p.layout === "center-fixed" ? "opacity-60 cursor-not-allowed" : ""}`}
                                value={p.autoFit || "none"}
                                onChange={(e) => updatePreset(p.id, { autoFit: e.target.value as any })}
                                disabled={p.layout === "center-fixed"}
                              >
                                <option value="none">사용 안 함</option>
                                <option value="width">가로 맞춤</option>
                                <option value="height">세로 맞춤</option>
                                <option value="contain">화면 맞춤(여백)</option>
                                <option value="cover">꽉 채움(자름)</option>
                              </select>
                              <label className="text-xs text-neutral-400">맞춤 기준(핀)</label>
                              <select
                                className={`px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm ${p.layout === "center-fixed" ? "opacity-60 cursor-not-allowed" : ""}`}
                                value={p.autoFitPin || "cc"}
                                onChange={(e) => updatePreset(p.id, { autoFitPin: e.target.value as any })}
                                disabled={p.layout === "center-fixed"}
                              >
                                <option value="cc">중앙</option>
                                <option value="tl">좌상</option>
                                <option value="tc">상단</option>
                                <option value="tr">우상</option>
                                <option value="cl">좌</option>
                                <option value="cr">우</option>
                                <option value="bl">좌하</option>
                                <option value="bc">하단</option>
                                <option value="br">우하</option>
                              </select>
                              <label className="text-xs text-neutral-400">자동 글자 크기</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.autoFont ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { autoFont: !p.autoFont })}>
                                {p.autoFont ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">컴팩트 모드</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.compact ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { compact: !p.compact })}>
                                {p.compact ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">촘촘 간격(+티커 간격)</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.tight ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { tight: !p.tight })}>
                                {p.tight ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">표 폭 고정</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.lockWidth ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { lockWidth: !p.lockWidth })}>
                                {p.lockWidth ? "ON" : "OFF"}
                              </button>
                              <label className={`text-xs ${p.lockWidth ? "text-neutral-600" : "text-neutral-400"}`}>이름 칸 확장</label>
                              <button
                                className={`px-2 py-0.5 rounded border text-xs ${p.lockWidth ? "opacity-60 cursor-not-allowed" : (p.nameGrow !== false ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500")}`}
                                onClick={() => !p.lockWidth && updatePreset(p.id, { nameGrow: !(p.nameGrow !== false) })}
                                disabled={!!p.lockWidth}
                              >
                                {p.nameGrow !== false ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">이름 너비(ch)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="(기본 자동)" value={p.nameCh || ""} onChange={(e) => updatePreset(p.id, { nameCh: e.target.value.replace(/[^\d]/g, "") })} />
                              <label className="text-xs text-neutral-400">계좌 글자 색상</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  className="h-9 w-14 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                  value={toColorPickerValue(p.accountColor, "#ffffff")}
                                  onChange={(e) => updatePreset(p.id, { accountColor: e.target.value })}
                                />
                                <span className="text-xs text-neutral-400 font-mono">{p.accountColor || "테마 기본"}</span>
                                <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { accountColor: "" })}>자동</button>
                              </div>
                              <label className="text-xs text-neutral-400">투네 글자 색상</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  className="h-9 w-14 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                  value={toColorPickerValue(p.toonColor, "#ffffff")}
                                  onChange={(e) => updatePreset(p.id, { toonColor: e.target.value })}
                                />
                                <span className="text-xs text-neutral-400 font-mono">{p.toonColor || "테마 기본"}</span>
                                <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { toonColor: "" })}>자동</button>
                              </div>
                              {managePositionInPrism && (
                                <>
                                  <label className="text-xs text-neutral-400">위치 설정(Prism에서)</label>
                                  <div className="text-xs text-neutral-500">위치/크기 조정은 Prism에서 진행합니다.</div>
                                </>
                              )}
                            </div>

                            <div className="h-px bg-white/10 my-1" />
                            <details className="rounded border border-white/10 bg-neutral-900/40" open>
                              <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">표 옵션</summary>
                              <div className="p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-neutral-400">표만 모드</label>
                                  <button className={`px-2 py-0.5 rounded border text-xs ${p.tableOnly ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { tableOnly: !p.tableOnly })}>
                                    {p.tableOnly ? "표만 ON" : "표만 OFF"}
                                  </button>
                                  <span className="text-[10px] text-neutral-500">(표만: 목록·총합만, 나머지 숨김)</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                  <label className="text-xs text-neutral-400">표 배경 투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={p.tableBgOpacity ?? "100"}
                                      onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-14 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={p.tableBgOpacity ?? "100"}
                                      onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                    />
                                    <span className="text-xs text-neutral-500">% (100=불투명)</span>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                  <label className="text-xs text-neutral-400">폭죽(매 N만원)</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                      placeholder="0=비활성"
                                      type="number"
                                      min="0"
                                      max="1000"
                                      value={p.confettiMilestone ?? ""}
                                      onChange={(e) => updatePreset(p.id, { confettiMilestone: e.target.value.replace(/[^\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">만원마다 누적매출 돌파 시 폭죽</span>
                                    <button
                                      className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-xs text-white"
                                      onClick={async () => {
                                        const { default: confetti } = await import("canvas-confetti");
                                        const count = 150;
                                        const defaults = { origin: { y: 0.6 }, zIndex: 9999 };
                                        function fire(particleRatio: number, opts: Record<string, unknown>) {
                                          confetti({ ...defaults, ...opts, particleCount: Math.floor(count * particleRatio) });
                                        }
                                        fire(0.25, { spread: 26, startVelocity: 55 });
                                        fire(0.2, { spread: 60 });
                                        fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
                                        fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
                                        fire(0.1, { spread: 120, startVelocity: 45 });
                                      }}
                                    >
                                      폭죽 데모
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </details>
                            <details className="rounded border border-white/10 bg-neutral-900/40">
                              <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">표시 요소</summary>
                              <div className="p-3 flex flex-wrap gap-1">
                                {([["멤버 목록", "showMembers"], ["총합", "showTotal"], ["목표바", "showGoal"], ["개인 골", "showPersonalGoal"], ["타이머", "showTimer"], ["미션 전광판", "showMission"]] as [string, keyof OverlayPreset][]).map(([label, key]) => (
                                  <button key={key} className={`px-2 py-0.5 rounded border text-xs ${p[key] ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { [key]: !p[key] })}>{label} {p[key] ? "ON" : "OFF"}</button>
                                ))}
                              </div>
                            </details>

                            <div className="h-px bg-white/10 my-1" />
                            <details className="rounded border border-white/10 bg-neutral-900/40">
                              <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">빠른 실행</summary>
                              <div className="p-3 flex flex-wrap gap-1">
                              {[
                                { label: "폭죽 데모(오버레이)", patch: { showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false, confettiMilestone: "10" } },
                                { label: "엑셀표만", patch: { theme: "excel", showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false, tableOnly: true } },
                                { label: "표만", patch: { theme: "excel", showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false, tableOnly: true } },
                                { label: "멤버 보드", patch: { showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false } },
                                { label: "총합", patch: { showMembers: false, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false } },
                                { label: "목표바", patch: { showMembers: false, showTotal: false, showGoal: true, showTicker: false, showTimer: false, showMission: false } },
                                { label: "타이머", patch: { showMembers: false, showTotal: false, showGoal: false, showTicker: false, showTimer: true, showMission: false, timerStart: Date.now() } },
                                { label: "미션 전광판", patch: { showMembers: false, showTotal: false, showGoal: false, showTicker: false, showTimer: false, showMission: true } },
                              ].map(({ label, patch }) => (
                                <button
                                  key={label}
                                  className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                  onClick={() => {
                                    if (typeof window === "undefined") return;
                                    const base = buildOverlayUrl({ ...p, ...patch });
                                    const u = new URL(base);
                                    if (patch.tableOnly) u.searchParams.set("tableOnly", "true");
                                    if (patch.theme) u.searchParams.set("theme", patch.theme);
                                    if (patch.showMembers !== undefined) u.searchParams.set("showMembers", String(patch.showMembers));
                                    if (patch.showTotal !== undefined) u.searchParams.set("showTotal", String(patch.showTotal));
                                    if (patch.showGoal !== undefined) u.searchParams.set("showGoal", String(patch.showGoal));
                                    if (patch.showTicker !== undefined) u.searchParams.set("showTicker", String(patch.showTicker));
                                    if (patch.showTimer !== undefined) u.searchParams.set("showTimer", String(patch.showTimer));
                                    if (patch.showMission !== undefined) u.searchParams.set("showMission", String(patch.showMission));
                                    if (patch.timerStart) u.searchParams.set("timerStart", String(patch.timerStart));
                                    if (patch.confettiMilestone) u.searchParams.set("confettiMilestone", patch.confettiMilestone);
                                    if ("tableBgOpacity" in patch && patch.tableBgOpacity) u.searchParams.set("tableBgOpacity", String(patch.tableBgOpacity));
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
                            </details>

                            {(p.showMembers || p.showPersonalGoal) && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">후원 리스트 옵션</div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
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
                                  <div className="col-span-1 sm:col-span-2">
                                    <details className="rounded border border-white/10 bg-neutral-900/40">
                                      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">고급 옵션</summary>
                                      <div className="p-3 grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                        <label className="text-xs text-neutral-400">티커 텍스트 색상</label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            className="h-9 w-14 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                            value={toColorPickerValue(p.donorsColor, "#a0e9ff")}
                                            onChange={(e) => updatePreset(p.id, { donorsColor: e.target.value })}
                                          />
                                          <span className="text-xs text-neutral-400 font-mono">{p.donorsColor || "자동(테마 따름)"}</span>
                                          <button
                                            type="button"
                                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                            onClick={() => updatePreset(p.id, { donorsColor: "" })}
                                          >
                                            자동
                                          </button>
                                        </div>
                                        <label className="text-xs text-neutral-400">티커 배경 색상</label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            className="h-9 w-14 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                            value={toColorPickerValue(p.donorsBgColor, "#000000")}
                                            onChange={(e) => updatePreset(p.id, { donorsBgColor: e.target.value })}
                                          />
                                          <span className="text-xs text-neutral-400 font-mono">{p.donorsBgColor || "자동(배경 미사용)"}</span>
                                          <button
                                            type="button"
                                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                            onClick={() => updatePreset(p.id, { donorsBgColor: "" })}
                                          >
                                            자동
                                          </button>
                                        </div>
                                        <label className="text-xs text-neutral-400">배경 투명도</label>
                                        <div className="flex items-center gap-1">
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={p.donorsBgOpacity || "0"}
                                            onChange={(e) => updatePreset(p.id, { donorsBgOpacity: e.target.value })}
                                            className="flex-1 accent-emerald-500"
                                          />
                                          <span className="text-xs w-10 text-center">{p.donorsBgOpacity || "0"}%</span>
                                        </div>
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
                                    </details>
                                  </div>
                                </div>
                              </>
                            )}

                            {p.showGoal && (
                              <details className="rounded border border-white/10 bg-neutral-900/40">
                                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">목표</summary>
                                <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                  <label className="text-xs text-neutral-400">목표(원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" type="number" value={p.goal} onChange={(e) => updatePreset(p.id, { goal: e.target.value })} />
                                  <label className="text-xs text-neutral-400">라벨</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalLabel} onChange={(e) => updatePreset(p.id, { goalLabel: e.target.value })} />
                                  <label className="text-xs text-neutral-400">데모 현재액(원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="미지정 시 자동" value={p.goalCurrent || ""} onChange={(e) => updatePreset(p.id, { goalCurrent: e.target.value })} />
                                  <div className="col-span-1 sm:col-span-2">
                                    <details className="rounded border border-white/10 bg-neutral-900/40">
                                      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">고급 옵션</summary>
                                      <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                        <label className="text-xs text-neutral-400">너비(px)</label>
                                        <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalWidth} onChange={(e) => updatePreset(p.id, { goalWidth: e.target.value })} />
                                      </div>
                                    </details>
                                  </div>
                                  {managePositionInPrism && (
                                    <>
                                      <label className="text-xs text-neutral-400">위치 설정(Prism에서)</label>
                                      <div className="text-xs text-neutral-500">위치/크기 조정은 Prism에서 진행합니다.</div>
                                    </>
                                  )}
                                </div>
                              </details>
                            )}

                            {p.showPersonalGoal && (
                              <details className="rounded border border-white/10 bg-neutral-900/40">
                                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">개인골</summary>
                                <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                  <label className="text-xs text-neutral-400">테마</label>
                                  <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.personalGoalTheme || "goalClassic"} onChange={(e) => updatePreset(p.id, { personalGoalTheme: e.target.value })}>
                                    <option value="goalClassic">개인골 클래식</option>
                                    <option value="goalNeon">개인골 네온</option>
                                  </select>
                                  {managePositionInPrism && (
                                    <>
                                      <label className="text-xs text-neutral-400">위치 설정(Prism에서)</label>
                                      <div className="text-xs text-neutral-500">위치/크기 조정은 Prism에서 진행합니다.</div>
                                    </>
                                  )}
                                  <label className="text-xs text-neutral-400">표시 개수</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.personalGoalLimit || "3"} onChange={(e) => updatePreset(p.id, { personalGoalLimit: e.target.value.replace(/[^\d]/g, "") })} />
                                  <div className="sm:col-span-2 text-[11px] text-neutral-500">
                                    멤버의 목표(원)를 설정해야 개인골 카드가 표시됩니다. 상단의 ‘멤버 정산 보드’에서 각 멤버의 목표를 입력하세요.
                                  </div>
                                  <div className="sm:col-span-2">
                                    <button
                                      type="button"
                                      className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                      onClick={() => {
                                        const u = new URL(buildStablePreviewUrl(p));
                                        u.searchParams.set("demo", "true");
                                        window.open(u.toString(), "_blank");
                                      }}
                                    >
                                      데모 미리보기(개인골)
                                    </button>
                                  </div>
                                </div>
                              </details>
                            )}

                            {/* 후원 티커 섹션 제거: 데모 실행 버튼만 유지 */}

                            {p.showTimer && (
                              <details className="rounded border border-white/10 bg-neutral-900/40">
                                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">방송 타이머</summary>
                                <div className="p-3 flex flex-wrap gap-2 items-center">
                                  <button className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: Date.now() })}>{p.timerStart ? "재시작" : "시작"}</button>
                                  {p.timerStart && <button className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: null })}>정지</button>}
                                  <span className="text-xs text-neutral-500">위치 설정(Prism에서)</span>
                                </div>
                              </details>
                            )}

                            {p.showMission && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">미션 전광판</div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2 mt-1">
                                  <label className="text-xs text-neutral-400">표시</label>
                                  <div>
                                    <button className={`px-2 py-1 rounded text-xs ${p.showMission ? "bg-emerald-700" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={() => updatePreset(p.id, { showMission: !p.showMission })}>{p.showMission ? "ON" : "OFF"}</button>
                                    <span className="ml-2 text-xs text-neutral-500">프리뷰/OBS에서 즉시 반영</span>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-3 mt-2">
                                  <label className="text-xs text-neutral-400">배경 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={(p.missionBgColor as any) || "#0b0b0b"} onChange={(e) => updatePreset(p.id, { missionBgColor: e.target.value })} />
                                  <label className="text-xs text-neutral-400">배경 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="0" max="100" value={p.missionBgOpacity || "85"} onChange={(e) => updatePreset(p.id, { missionBgOpacity: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                    <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionBgOpacity || "85"} onChange={(e) => updatePreset(p.id, { missionBgOpacity: e.target.value.replace(/[^\\d]/g, "") })} />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">텍스트 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={(p.missionItemColor as any) || "#fde68a"} onChange={(e) => updatePreset(p.id, { missionItemColor: e.target.value })} />
                                  <label className="text-xs text-neutral-400">강조 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={(p.missionTitleColor as any) || "#fcd34d"} onChange={(e) => updatePreset(p.id, { missionTitleColor: e.target.value })} />
                              <label className="text-xs text-neutral-400">제목 텍스트</label>
                              <input
                                className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                placeholder="MISSION"
                                value={(p as any).missionTitleText || ""}
                                onChange={(e) => updatePreset(p.id, { missionTitleText: e.target.value })}
                              />
                                  <label className="text-xs text-neutral-400">글씨 크기</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="10" max="80" value={p.missionFontSize || "18"} onChange={(e) => updatePreset(p.id, { missionFontSize: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                    <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionFontSize || "18"} onChange={(e) => updatePreset(p.id, { missionFontSize: e.target.value.replace(/[^\\d]/g, "") })} />
                                    <span className="text-xs text-neutral-500">px</span>
                                  </div>
                                <label className="text-xs text-neutral-400">효과</label>
                                <select
                                  className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                  value={p.missionEffect || "none"}
                                  onChange={(e) => updatePreset(p.id, { missionEffect: e.target.value })}
                                >
                                  <option value="none">없음</option>
                                  <option value="blink">깜빡임</option>
                                  <option value="pulse">펄스</option>
                                  <option value="glow">글로우</option>
                                </select>
                                <div className="flex items-center gap-2">
                                  <input id={`hotOnly-${p.id}`} type="checkbox" className="w-4 h-4 accent-emerald-500" checked={(p.missionEffectHotOnly as any) === "true"} onChange={(e) => updatePreset(p.id, { missionEffectHotOnly: e.target.checked ? "true" : "false" })} />
                                  <label htmlFor={`hotOnly-${p.id}`} className="text-xs text-neutral-400">핫 항목만 적용</label>
                                </div>
                                <label className="text-xs text-neutral-400">디스플레이 모드</label>
                                <select
                                  className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                  value={p.missionDisplayMode || "horizontal"}
                                  onChange={(e) => updatePreset(p.id, { missionDisplayMode: e.target.value })}
                                >
                                  <option value="horizontal">가로 흐름</option>
                                  <option value="vertical-slot">슬롯형(세로)</option>
                                </select>
                                {p.missionDisplayMode === "vertical-slot" && (
                                  <>
                                    <label className="text-xs text-neutral-400">노출 개수</label>
                                    <div className="flex items-center gap-2">
                                      <input type="range" min="1" max="6" value={p.missionVisibleCount || "3"} onChange={(e) => updatePreset(p.id, { missionVisibleCount: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                      <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionVisibleCount || "3"} onChange={(e) => updatePreset(p.id, { missionVisibleCount: e.target.value.replace(/[^\\d]/g, "") })} />
                                    </div>
                                  </>
                                )}
                                <label className="text-xs text-neutral-400">애니메이션 속도(초)</label>
                                <div className="flex items-center gap-2">
                                  <input type="range" min="1" max="120" value={p.missionSpeed || (p.missionDisplayMode === "vertical-slot" ? "2" : "25")} onChange={(e) => updatePreset(p.id, { missionSpeed: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                  <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionSpeed || (p.missionDisplayMode === "vertical-slot" ? "2" : "25")} onChange={(e) => updatePreset(p.id, { missionSpeed: e.target.value.replace(/[^\\d.]/g, "") })} />
                                </div>
                                <label className="text-xs text-neutral-400">아이템 간격(px)</label>
                                <div className="flex items-center gap-2">
                                  <input type="range" min="0" max="48" value={p.missionGapSize || "8"} onChange={(e) => updatePreset(p.id, { missionGapSize: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                  <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionGapSize || "8"} onChange={(e) => updatePreset(p.id, { missionGapSize: e.target.value.replace(/[^\\d]/g, "") })} />
                                </div>
                                </div>
                                {/* Palette view removed; keep compact select */}
                                {!(p.showMission && !p.showMembers && !p.showTotal && !p.showGoal && !p.showPersonalGoal && !p.showTicker && !p.showTimer) && (
                                  <div className="mt-2 rounded border border-white/10 bg-neutral-950/60 p-2">
                                    <div className="text-xs text-neutral-400 mb-1">미션 전광판 미리보기</div>
                                    <div className="overflow-hidden">
                                      {(p.missionDisplayMode === "vertical-slot") ? (
                                        <MissionBoardSlot
                                          missions={(state.missions && state.missions.length > 0) ? state.missions : [
                                            { id: "mis_demo_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
                                            { id: "mis_demo_2", title: "즉흥 노래 한 곡", price: "3만" },
                                            { id: "mis_demo_3", title: "게임 미션 클리어 도전", price: "5만" },
                                          ]}
                                          fontSize={parseInt(p.missionFontSize || "18", 10)}
                                          themeVariant={(() => {
                                            const id = p.theme || "default";
                                            const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                            if (excelThemes.includes(id)) return "excel";
                                            if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                            return (id as any);
                                          })()}
                                        titleText={(p as any).missionTitleText || undefined}
                                          visibleCount={parseInt(p.missionVisibleCount || "3", 10)}
                                          speed={parseFloat(p.missionSpeed || "2")}
                                          gapSize={parseInt(p.missionGapSize || "8", 10)}
                                          bgColor={(p as any).missionBgColor || undefined}
                                          bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                          itemColor={(p as any).missionItemColor || undefined}
                                          titleColor={(p as any).missionTitleColor || undefined}
                                        />
                                      ) : (
                                        <MissionBoard
                                          missions={(state.missions && state.missions.length > 0) ? state.missions : [
                                            { id: "mis_demo_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
                                            { id: "mis_demo_2", title: "즉흥 노래 한 곡", price: "3만" },
                                            { id: "mis_demo_3", title: "게임 미션 클리어 도전", price: "5만" },
                                          ]}
                                          fontSize={parseInt(p.missionFontSize || "18", 10)}
                                          themeVariant={(() => {
                                            const id = p.theme || "default";
                                            const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                            if (excelThemes.includes(id)) return "excel";
                                            if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                            return (id as any);
                                          })()}
                                        titleText={(p as any).missionTitleText || undefined}
                                          duration={parseFloat(p.missionSpeed || "25")}
                                          bgColor={(p as any).missionBgColor || undefined}
                                          bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                          itemColor={(p as any).missionItemColor || undefined}
                                          titleColor={(p as any).missionTitleColor || undefined}
                                        />
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div className="text-xs text-neutral-500">위치 설정(Prism에서), 고급 위치는 포지션 탭에서 조정</div>
                              </>
                            )}

                            <div className="h-px bg-white/10 my-1" />
                            <div className="flex items-center gap-2">
                              <input className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 font-mono text-xs" readOnly value={url} />
                              <button className={`px-2 py-1 rounded text-xs whitespace-nowrap ${copiedId === p.id ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={() => copyUrl(url, p.id)}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                              <button
                                className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs whitespace-nowrap"
                                onClick={() => {
                                  const snapUrl = buildEmergencySnapshotUrl(p);
                                  copyUrl(snapUrl, p.id);
                                }}
                                title="서버 연결 장애 시 멤버/금액 스냅샷을 URL에 포함해 바로 표시"
                              >
                                긴급 링크(오프라인)
                              </button>
                            </div>
                          </div>

                          <div className="lg:order-1">
                            {(p.showMission && !p.showMembers && !p.showTotal && !p.showGoal && !p.showPersonalGoal && !p.showTicker && !p.showTimer) ? (
                              <div className="rounded border border-white/10 bg-neutral-950/60 p-3">
                                <div className="text-xs text-neutral-400 mb-2">미션 전광판 미리보기</div>
                                {(p.missionDisplayMode === "vertical-slot") ? (
                                  <MissionBoardSlot
                                    missions={(state.missions && state.missions.length > 0) ? state.missions : [
                                      { id: "mis_demo_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
                                      { id: "mis_demo_2", title: "즉흥 노래 한 곡", price: "3만" },
                                      { id: "mis_demo_3", title: "게임 미션 클리어 도전", price: "5만" },
                                    ]}
                                    fontSize={parseInt(p.missionFontSize || "24", 10)}
                                    themeVariant={(() => {
                                      const id = p.theme || "default";
                                      const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                      if (excelThemes.includes(id)) return "excel";
                                      if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                      return (id as any);
                                    })()}
                                    titleText={(p as any).missionTitleText || undefined}
                                    visibleCount={parseInt(p.missionVisibleCount || "3", 10)}
                                    speed={parseFloat(p.missionSpeed || "2")}
                                    gapSize={parseInt(p.missionGapSize || "8", 10)}
                                    bgColor={(p as any).missionBgColor || undefined}
                                    bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                    itemColor={(p as any).missionItemColor || undefined}
                                    titleColor={(p as any).missionTitleColor || undefined}
                                  />
                                ) : (
                                  <MissionBoard
                                    missions={(state.missions && state.missions.length > 0) ? state.missions : [
                                      { id: "mis_demo_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
                                      { id: "mis_demo_2", title: "즉흥 노래 한 곡", price: "3만" },
                                      { id: "mis_demo_3", title: "게임 미션 클리어 도전", price: "5만" },
                                    ]}
                                    fontSize={parseInt(p.missionFontSize || "24", 10)}
                                    themeVariant={(() => {
                                      const id = p.theme || "default";
                                      const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                      if (excelThemes.includes(id)) return "excel";
                                      if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                      return (id as any);
                                    })()}
                                    titleText={(p as any).missionTitleText || undefined}
                                    duration={parseFloat(p.missionSpeed || "25")}
                                    bgColor={(p as any).missionBgColor || undefined}
                                    bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                    itemColor={(p as any).missionItemColor || undefined}
                                    titleColor={(p as any).missionTitleColor || undefined}
                                    effect={(p as any).missionEffect || "none"}
                                    effectHotOnly={(p as any).missionEffectHotOnly === "true"}
                                  />
                                )}
                              </div>
                            ) : (
                              <VerticalPreview url={buildStablePreviewUrl(p)} />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className={`${panelCardClass} p-4 md:p-6`}>
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
                  className="px-4 py-2 rounded bg-[#22c55e] hover:bg-[#16a34a] font-semibold text-white whitespace-nowrap shrink-0"
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

            <section id="logs-data" className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">데이터</h2>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-2 rounded bg-[#ef4444] hover:bg-[#dc2626] text-white"
                    onClick={() => setResetSheetOpen(true)}
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
      </div>
      {actionSheet.open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-black/55" onClick={closeActionSheet} aria-label="액션 시트 닫기" />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-2xl border-t border-white/10 bg-[#202020] p-4">
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-3" />
            <div className="text-sm font-semibold text-white">{actionSheet.title}</div>
            {actionSheet.desc && <div className="text-xs text-neutral-400 mt-1 whitespace-pre-line">{actionSheet.desc}</div>}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="px-3 py-2 rounded-lg bg-neutral-700 text-sm" onClick={closeActionSheet}>취소</button>
              <button
                className={`px-3 py-2 rounded-lg text-sm font-semibold ${actionSheet.danger ? "bg-[#ef4444] text-white" : "bg-[#22c55e] text-white"}`}
                onClick={() => {
                  const fn = actionConfirmRef.current;
                  closeActionSheet();
                  fn?.();
                }}
              >
                {actionSheet.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
      {resetSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
          <button className="absolute inset-0 bg-black/55" onClick={() => setResetSheetOpen(false)} aria-label="닫기" />
          <div className="relative w-full max-w-md lg:rounded-2xl rounded-t-2xl border-t lg:border border-white/10 bg-[#202020] p-4 lg:mx-4">
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-3 lg:hidden" />
            <div className="text-sm font-semibold text-white">정산 리셋 (로그 기록)</div>
            <div className="text-xs text-neutral-400 mt-1">멤버 초기화 여부를 선택하세요.</div>
            <div className="space-y-2 mt-4">
              <button
                className="w-full px-3 py-2.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm text-left"
                onClick={onResetKeepMembers}
              >
                <span className="font-medium text-white">멤버 유지</span>
                <span className="block text-xs text-neutral-400 mt-0.5">이전 멤버·운영비 그대로 유지. 후원 내역·금액만 초기화</span>
              </button>
              <button
                className="w-full px-3 py-2.5 rounded-lg bg-[#ef4444] hover:bg-[#dc2626] text-sm text-left"
                onClick={onResetInitMembers}
              >
                <span className="font-medium text-white">멤버 초기화</span>
                <span className="block text-xs text-white/80 mt-0.5">멤버를 기본 3명으로 초기화</span>
              </button>
              <button
                className="w-full px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm"
                onClick={() => setResetSheetOpen(false)}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      <footer className="mt-8 text-center text-xs text-neutral-500">
        © 2026 Final Entertainment. All rights reserved.
      </footer>
      <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-white/10 bg-[#202020]/95 backdrop-blur">
        <div className="grid grid-cols-4 gap-1 p-2">
          <button
            onClick={() => moveToSection("dashboard", "dashboard-summary")}
            className={`rounded-md py-2 text-xs ${activeNav === "dashboard" ? "bg-[#6366f1] text-white" : "text-neutral-300"}`}
          >
            홈
          </button>
          <button
            onClick={() => moveToSection("settlement", "settlement-member-board")}
            className={`rounded-md py-2 text-xs ${activeNav === "settlement" ? "bg-[#6366f1] text-white" : "text-neutral-300"}`}
          >
            정산
          </button>
          <button
            onClick={() => moveToSection("donor", "donor-management")}
            className={`rounded-md py-2 text-xs ${activeNav === "donor" ? "bg-[#6366f1] text-white" : "text-neutral-300"}`}
          >
            후원자
          </button>
          <button
            onClick={() => moveToSection("overlay", "overlay-settings")}
            className={`rounded-md py-2 text-xs ${activeNav === "overlay" ? "bg-[#6366f1] text-white" : "text-neutral-300"}`}
          >
            설정
          </button>
        </div>
      </nav>
    </main>
  );
}

function VerticalPreview({ url }: { url: string }) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [showFrame, setShowFrame] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [w, h] = orientation === "portrait" ? [540, 960] : [960, 540];
  const previewUrl = useMemo(() => {
    try {
      const u = new URL(url);
      u.searchParams.set("previewGuide", "true");
      return u.toString();
    } catch {
      return url;
    }
  }, [url]);
  const onLoad = useCallback((e: any) => {
    try {
      const doc = e?.target?.contentDocument;
      if (!doc) { setErr("미리보기 로드 실패"); return; }
      const title = (doc.title || "").toLowerCase();
      const text = (doc.body?.innerText || "").toLowerCase();
      if (title.includes("404") || text.includes("not found")) setErr("프리뷰 경로 404");
      else setErr(null);
    } catch {
      setErr(null);
    }
  }, []);
  const onError = useCallback(() => setErr("미리보기 네트워크 오류"), []);
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
      <div className="relative mx-auto rounded-xl overflow-hidden shrink-0"
           style={{
             width: "min(84vw, 1100px)",
             maxWidth: "100%",
             height: "auto",
             maxHeight: "82vh",
             aspectRatio: `${w} / ${h}`,
             border: "1px solid rgba(255,255,255,0.1)",
             background: "#0b0b0b",
             boxShadow: showFrame ? "0 6px 24px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 8px 24px rgba(255,255,255,0.04)" : "none",
           }}>
        <iframe key={previewUrl} src={previewUrl} title="vertical-preview" className="absolute inset-0 w-full h-full" style={{ background: "transparent" }} scrolling="no" onLoad={onLoad} onError={onError} />
        {err && (
          <div className="absolute top-2 right-2 z-[10000] px-2 py-1 rounded bg-rose-700 text-white text-xs">
            {err}
          </div>
        )}
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
