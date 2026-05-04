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
  saveMissionsBackup,
  loadMissionsBackup,
  isDefaultLikeState,
  ensureMissionItems,
  appendDailyLog,
  loadDailyLogFromApi,
  parseAmount,
  formatChatLine,
  storageKey,
  dailyLogStorageKey,
  DAILY_LOG_KEY,
  loadDailyLog,
  DailyLogEntry,
  formatManThousand,
  formatWonFull,
  confirmHighAmount,
  MissionItem,
  totalCombined,
  TimerState,
  normalizeDonorRankingsOverlayConfig,
  normalizeSigMatchPools,
  normalizeSigMatchParticipantIds,
  normalizeDonationListsOverlayConfig,
  type OverlayConfig,
} from "@/lib/state";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { appendSettlementRecordAndSync, appendSigMatchIncentiveSettlementAndSync, SettlementMemberRatioOverrides } from "@/lib/settlement";
import { formatSigMatchStat, getSigMatchRankings } from "@/lib/settlement-utils";
import { getEffectiveRemainingTime, pauseTimer, resumeTimer } from "@/lib/timer-utils";
import { presetToParams, type OverlayPresetLike } from "@/lib/overlay-params";
import { DEFAULT_SIG_SOLD_STAMP_URL } from "@/lib/constants";
import { applyMealBattleDonationToParticipants } from "@/lib/meal-battle-donation";
import { getVisibleAdminNavItems, isAdminNavSectionVisible, type AdminNavKey } from "@/app/admin/admin-nav-config";

/** 후원 계열 오버레이 배경 GIF 프리셋 — 외부 URL은 방송망에서 차단될 수 있음 */
const DONATION_LISTS_BG_GIF_PRESETS: { label: string; url: string }[] = [
  { label: "— 프리셋 —", url: "" },
  { label: "파스텔 반짝 (Giphy)", url: "https://media.giphy.com/media/26BRuo6sLetdllPAQ/giphy.gif" },
  { label: "하트 파티클 (Giphy)", url: "https://media2.giphy.com/media/l0MYC0LajbaPoEADu/giphy.gif" },
];
import MissionBoard from "@/components/MissionBoard";
import MissionBoardSlot from "@/components/MissionBoardSlot";

type OverlayPreset = {
  id: string; name: string; scale: string; memberSize: string; totalSize: string;
  layout?: "center-fixed" | "center";
  zoomMode?: "follow" | "invert" | "neutral";
  dense: boolean; anchor: string; tableFree?: boolean; tableX?: string; tableY?: string; autoFont?: boolean; compact?: boolean; tight?: boolean; lockWidth?: boolean; nameGrow?: boolean; nameCh?: string; tableMarginTop?: string; tableMarginRight?: string; tableMarginBottom?: string; tableMarginLeft?: string; autoFit?: "none" | "width" | "height" | "contain" | "cover"; autoFitPin?: "cc" | "tl" | "tr" | "bl" | "br" | "tc" | "bc" | "cl" | "cr"; box?: "full" | "tight"; noCrop?: boolean; sumAnchor: string; sumFree: boolean; sumX: string; sumY: string;
  theme: string;
  membersTheme?: string; totalTheme?: string; goalTheme?: string; tickerBaseTheme?: string; timerTheme?: string; missionTheme?: string;
  missionWidth?: string; missionDuration?: string; missionBgOpacity?: string; missionBgColor?: string; missionItemColor?: string; missionTitleColor?: string; missionTitleText?: string; missionTitleEffect?: string; missionFontSize?: string; missionEffect?: string; missionEffectHotOnly?: string; missionDisplayMode?: string; missionVisibleCount?: string; missionSpeed?: string; missionGapSize?: string;
  showMembers: boolean; showTotal: boolean;
  totalMode?: "total";
  showGoal: boolean; goal: string; goalLabel: string; goalWidth: string; goalAnchor: string; goalCurrent?: string; goalOpacity?: string; goalOpacityText?: boolean;
  showPersonalGoal?: boolean; personalGoalTheme?: string; personalGoalAnchor?: string; personalGoalLimit?: string; personalGoalFree?: boolean; personalGoalX?: string; personalGoalY?: string;
  tickerInMembers?: boolean; tickerInGoal?: boolean; tickerInPersonalGoal?: boolean;
  showTicker: boolean; tickerAnchor?: string; tickerWidth?: string; tickerFree?: boolean; tickerX?: string; tickerY?: string; showTimer: boolean; timerStart: number | null; timerAnchor: string; timerShowHours?: boolean; timerFontColor?: string; timerBgColor?: string; timerBorderColor?: string; timerBgOpacity?: string; timerScale?: string;
  showMission: boolean; missionAnchor: string;
  showBottomDonors?: boolean; donorsSize?: string; donorsGap?: string; donorsSpeed?: string; donorsLimit?: string; donorsFormat?: string; donorsUnit?: string; donorsColor?: string; donorsBgColor?: string; donorsBgOpacity?: string; tickerTheme?: string; tickerGlow?: string; tickerShadow?: string; currencyLocale?: string; tableOnly?: boolean;
  confettiMilestone?: string; tableBgOpacity?: string; tableBgGifUrl?: string; tableBgGifOpacity?: string; tableBgGifBrightness?: string; totalLineVisible?: boolean; vertical?: boolean; accountColor?: string; toonColor?: string; host?: string;
};

/** 미션 목록이 비었을 때 미션 전광판 UI 확인용 placeholder */
const PLACEHOLDER_MISSIONS: MissionItem[] = [
  { id: "mis_ph_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
  { id: "mis_ph_2", title: "즉흥 노래 한 곡", price: "3만" },
  { id: "mis_ph_3", title: "게임 미션 클리어 도전", price: "5만" },
];

const ONE_SHOT_SIG_ID = "sig_one_shot";
const ONE_SHOT_SIG_NAME = "한방 시그";
const MAX_SIG_UPLOAD_BYTES = 30 * 1024 * 1024;
const SIG_DUMMY_IMAGE = "/images/sigs/dummy-sig.svg";
const BROKEN_SIG_UID_PATTERN = /(_257b_2522id_2522|%257b%2522id%2522|%7b%22id%22)/i;

function clampSigSalesMenuCount(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw || "").replace(/[^\d]/g, "") || "10", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(5, Math.min(20, Math.floor(n)));
}

function clampSigSalesResultScalePct(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw || "").replace(/[^\d]/g, "") || "78", 10);
  if (!Number.isFinite(n)) return 78;
  return Math.max(50, Math.min(100, Math.floor(n)));
}

function isBrokenSigImageUrl(raw?: string): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return false;
  return BROKEN_SIG_UID_PATTERN.test(v);
}

function isLegacyLocalSigImageUrl(raw?: string): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return false;
  return (
    v.startsWith("/uploads/") ||
    v.startsWith("uploads/") ||
    v.includes(".onrender.com/uploads/")
  );
}

function resolveSigPreviewSrc(raw?: string): string {
  const v = String(raw || "").trim().replace(/\\/g, "/");
  if (!v) return SIG_DUMMY_IMAGE;
  if (isBrokenSigImageUrl(v)) return SIG_DUMMY_IMAGE;
  if (v.startsWith("/")) return v;
  if (v.startsWith("uploads/")) return `/${v}`;
  if (v.startsWith("images/")) return `/${v}`;
  if (v.startsWith("http://") || v.startsWith("https://")) return v;
  if (v.startsWith("data:image/") || v.startsWith("blob:")) return v;
  return SIG_DUMMY_IMAGE;
}

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
  const stateRef = useRef<AppState>(state);
  const lastLocalPersistAtRef = useRef<number>(0);
  const syncStatusRef = useRef<"loading" | "synced" | "local" | "error">("loading");
  const pendingUnsyncedRef = useRef<boolean>(false);
  const [dailyLog, setDailyLog] = useState<Record<string, DailyLogEntry[]>>({});
  const [donorName, setDonorName] = useState("");
  const [donorAmount, setDonorAmount] = useState("");
  const [donorMemberId, setDonorMemberId] = useState<string | null>(null);
  const [donorTarget, setDonorTarget] = useState<DonorTarget>("account");
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionMemberId, setContributionMemberId] = useState<string | null>(null);
  const [contributionDelta, setContributionDelta] = useState<1 | -1>(1);
  const [contributionNote, setContributionNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatDraftDirty, setChatDraftDirty] = useState(false);
  const [missionTitle, setMissionTitle] = useState("");
  const [missionPrice, setMissionPrice] = useState("");
  const [missionRestoreLoading, setMissionRestoreLoading] = useState(false);
  const [newSigName, setNewSigName] = useState("");
  const [newSigPrice, setNewSigPrice] = useState("77000");
  const [newSigMaxCount, setNewSigMaxCount] = useState("1");
  const [newSigMemberId, setNewSigMemberId] = useState<string>("");
  const [newSigImageUrl, setNewSigImageUrl] = useState("");
  const [newSigPreviewUrl, setNewSigPreviewUrl] = useState("");
  const [newSigImageUploading, setNewSigImageUploading] = useState(false);
  const [sigPreviewMap, setSigPreviewMap] = useState<Record<string, string>>({});
  const [sigExcelResult, setSigExcelResult] = useState("");
  const [sigPresetMemberId, setSigPresetMemberId] = useState("");
  /** 회차별 금액 범위(최소/최대). 빈칸이면 해당 회차는 금액 제한 없이 남은 시그 중 랜덤(중복 없음) */
  const [rouletteSpinCount, setRouletteSpinCount] = useState("5");
  const [roulettePriceRanges, setRoulettePriceRanges] = useState<Array<{ min: string; max: string }>>(() =>
    Array.from({ length: 5 }, () => ({ min: "", max: "" }))
  );
  const ROULETTE_ROUND_UI_CAP = 40;
  const [rouletteResetBusy, setRouletteResetBusy] = useState(false);
  /** 회전판 돌리기/초기화 결과 — sigExcelResult(엑셀)와 분리해 버튼 바로 아래에 표시 */
  const [rouletteActionMessage, setRouletteActionMessage] = useState("");
  const [rouletteSpinBusy, setRouletteSpinBusy] = useState(false);
  const [donorRankingPresetName, setDonorRankingPresetName] = useState("");
  const [settlementTitle, setSettlementTitle] = useState("");
  const [accountRatioInput, setAccountRatioInput] = useState("70");
  const [toonRatioInput, setToonRatioInput] = useState("60");
  const [taxRateInput, setTaxRateInput] = useState("3.3");
  const [useMemberRatioOverrides, setUseMemberRatioOverrides] = useState(false);
  const [memberRatioInputs, setMemberRatioInputs] = useState<Record<string, { account: string; toon: string }>>({});
  const PRESET_STORAGE_KEY = "excel-broadcast-overlay-presets";
  const SETTLEMENT_OPTIONS_KEY = "excel-broadcast-settlement-options-v1";
  const displayMissions = useMemo(() => {
    const v = ensureMissionItems(state.missions);
    return v.length > 0 ? v : PLACEHOLDER_MISSIONS;
  }, [state.missions]);
  const PRESET_TEMPLATES: { name: string; preset: Partial<OverlayPreset> }[] = [
    { name: "엑셀표만", preset: { theme: "excel", showMembers: true, showTotal: true, tableOnly: true } },
    { name: "전체 통합", preset: { showMembers: true, showTotal: true } },
    { name: "표만 (엑셀)", preset: { theme: "excel", showMembers: true, showTotal: true, tableOnly: true } },
    { name: "멤버 목록만", preset: { showMembers: true, showTotal: false, showBottomDonors: false, tickerInMembers: false } },
    { name: "총합만", preset: { showMembers: false, showTotal: true, totalSize: "60" } },
    { name: "목표 프로그레스바", preset: { showMembers: false, showTotal: false, showGoal: true, goal: "500000", goalLabel: "후원", goalWidth: "500" } },
    { name: "개인 골", preset: { showMembers: false, showTotal: false, showPersonalGoal: true, personalGoalAnchor: "tl" } },
    { name: "미션 전광판", preset: { showMembers: false, showTotal: false, showMission: true, missionAnchor: "bc" } },
  ];
  const managePositionInPrism = true;
  const defaultPreset = (name: string, overrides: Partial<OverlayPreset> = {}): OverlayPreset => ({
    id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name,
    scale: "1.1", memberSize: "24", totalSize: "56", dense: true, anchor: "cc",
    layout: "center-fixed", zoomMode: "follow",
    tableFree: false, tableX: "50", tableY: "50",
    sumAnchor: "bc", sumFree: false, sumX: "50", sumY: "90", theme: "default",
    showMembers: true, showTotal: true, totalMode: "total", showGoal: false, goal: "0", goalLabel: "후원", showPersonalGoal: false, personalGoalTheme: "goalClassic", personalGoalAnchor: "tl", personalGoalLimit: "3", personalGoalFree: false, personalGoalX: "78", personalGoalY: "82",
    tickerInMembers: false, tickerInGoal: false, tickerInPersonalGoal: false,
    goalWidth: "400", goalAnchor: "bc", goalCurrent: "", goalOpacity: "", goalOpacityText: false, showTicker: false, tickerAnchor: "bc", tickerWidth: "600", tickerFree: false, tickerX: "50", tickerY: "86", showTimer: false,
    timerStart: null, timerAnchor: "tr", timerShowHours: false, timerFontColor: "", timerBgColor: "", timerBorderColor: "", timerBgOpacity: "40", timerScale: "100", showMission: false, missionAnchor: "br",
    missionWidth: "800", missionDuration: "25",
    membersTheme: "auto", totalTheme: "auto", goalTheme: "auto", tickerBaseTheme: "auto", timerTheme: "auto", missionTheme: "auto",
    showBottomDonors: false, donorsSize: "", donorsGap: "16", donorsSpeed: "60", donorsLimit: "8", donorsFormat: "short", donorsUnit: "", donorsColor: "", donorsBgColor: "", donorsBgOpacity: "0", tickerTheme: "auto", tickerGlow: "45", tickerShadow: "35", currencyLocale: "ko-KR",
    confettiMilestone: "",
    tableBgOpacity: "",
    totalLineVisible: false,
    tableBgGifUrl: "",
    tableBgGifOpacity: "45",
    tableBgGifBrightness: "100",
    accountColor: "",
    toonColor: "",
    ...overrides,
  });
  const [presets, setPresets] = useState<OverlayPreset[]>([]);
  const [presetRev, setPresetRev] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [sigMatchPreviewIframeKey, setSigMatchPreviewIframeKey] = useState(0);
  const [battleScalePct, setBattleScalePct] = useState("100");
  /** 시그/식사 대전 오버레이 본문 max-width (%), URL contentWidthPct */
  const [battleContentWidthPct, setBattleContentWidthPct] = useState("100");
  const [sigSalesMenuCount, setSigSalesMenuCount] = useState("10");
  const [donorRankingsPreviewIframeKey, setDonorRankingsPreviewIframeKey] = useState(0);
  const [donorRankingsZoomPct, setDonorRankingsZoomPct] = useState("100");
  const [timerUiNow, setTimerUiNow] = useState(Date.now());
  const [timerMinuteInputs, setTimerMinuteInputs] = useState<Record<"generalTimer", string>>({
    generalTimer: "0",
  });
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
  const [activeNav, setActiveNav] = useState<AdminNavKey>("dashboard");
  const panelCardClass = "rounded-xl border border-white/10 bg-[#252525] shadow-[0_8px_24px_rgba(0,0,0,0.28)]";
  const simpleMode = false;

  const syncOneShotSigItem = useCallback((prev: AppState): AppState => {
    const inv = prev.sigInventory || [];
    const totalAmount = inv
      .filter((x) => x.id !== ONE_SHOT_SIG_ID && Boolean(x.isActive))
      .reduce((sum, x) => sum + Math.max(0, Number(x.price || 0)), 0);
    const oneShot = inv.find((x) => x.id === ONE_SHOT_SIG_ID);
    if (!oneShot) {
      return {
        ...prev,
        sigInventory: [
          ...inv,
          {
            id: ONE_SHOT_SIG_ID,
            name: ONE_SHOT_SIG_NAME,
            price: totalAmount,
            imageUrl: "",
            memberId: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: false,
            isActive: true,
          },
        ],
      };
    }
    const nextOneShot = {
      ...oneShot,
      name: ONE_SHOT_SIG_NAME,
      price: totalAmount,
      maxCount: 1,
      soldCount: 0,
    };
    const changed =
      oneShot.name !== nextOneShot.name ||
      oneShot.price !== nextOneShot.price ||
      oneShot.maxCount !== nextOneShot.maxCount ||
      oneShot.soldCount !== nextOneShot.soldCount;
    if (!changed) return prev;
    return {
      ...prev,
      sigInventory: inv.map((x) => (x.id === ONE_SHOT_SIG_ID ? nextOneShot : x)),
    };
  }, []);
  const navItems = useMemo(() => getVisibleAdminNavItems(), []);
  useEffect(() => {
    const keys = navItems.map((n) => n.key);
    if (keys.length === 0) return;
    setActiveNav((prev) => (keys.includes(prev) ? prev : keys[0]!));
  }, [navItems]);
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
  const persistState = useCallback((s: AppState) => {
    const now = Date.now();
    lastLocalPersistAtRef.current = now;
    stateUpdatedAtRef.current = now;
    pendingUnsyncedRef.current = true;
    setSyncStatus("loading");
    saveStateAsync(s, user?.id).then((ok) => {
      if (ok) {
        pendingUnsyncedRef.current = false;
        setSyncStatus("synced");
      } else {
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setSyncStatus(offline ? "local" : "error");
      }
    });
  }, [user?.id]);
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
  
  const moveToSection = (key: AdminNavKey, targetId: string) => {
    setActiveNav(key);
    if (typeof window === "undefined") return;
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  /** `<input type="color">`는 #rrggbb만 허용 — transparent 등은 fallback으로 표시 */
  const toColorPickerValue = (raw?: string, fallback = "#ffffff") => {
    const v = (raw || "").trim();
    const lower = v.toLowerCase();
    if (!v || lower === "transparent" || lower === "none") return fallback;
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
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    stateUpdatedAtRef.current = state.updatedAt || 0;
  }, [state.updatedAt]);
  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  const mergeIncomingStateSafely = useCallback((incoming: AppState, local: AppState): { merged: AppState; didPreserve: boolean } => {
    const incomingDefaultLike = isDefaultLikeState(incoming);
    const localHasData = !isDefaultLikeState(local);
    // 서버가 기본 데이터만 반환하면, 이미 로컬에 있는 기존 상태를 최대한 그대로 유지한다.
    if (incomingDefaultLike && localHasData) {
      return {
        merged: {
          ...incoming,
          ...local,
          updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
        },
        didPreserve: true,
      };
    }

    let merged = incoming;
    let didPreserve = false;
    if (!incoming.missions?.length && local.missions?.length) {
      merged = { ...merged, missions: local.missions };
      didPreserve = true;
    }
    if (!incoming.overlayPresets?.length && local.overlayPresets?.length) {
      merged = { ...merged, overlayPresets: local.overlayPresets };
      didPreserve = true;
    }
    const incomingOverlaySettingsEmpty =
      !incoming.overlaySettings || Object.keys(incoming.overlaySettings).length === 0;
    const localOverlaySettingsHasData =
      !!local.overlaySettings && Object.keys(local.overlaySettings).length > 0;
    if (incomingOverlaySettingsEmpty && localOverlaySettingsHasData) {
      merged = { ...merged, overlaySettings: local.overlaySettings };
      didPreserve = true;
    }
    return { merged, didPreserve };
  }, []);

  useEffect(() => {
    if (!user) return;
    // localStorage에서 즉시 복원 (서버 재시작/동기화 시 기본값 덮어쓰기 전에 로컬 데이터 확보)
    const hydrated = loadState(user.id);
    setState(hydrated);
    let localPresets: OverlayPreset[] = [];
    try {
      const raw = window.localStorage.getItem(PRESET_STORAGE_KEY);
      if (raw) localPresets = JSON.parse(raw) as OverlayPreset[];
    } catch {}
    if (Array.isArray(hydrated.overlayPresets) && hydrated.overlayPresets.length > 0) {
      setPresets(hydrated.overlayPresets as OverlayPreset[]);
    } else if (localPresets.length > 0) {
      setPresets(localPresets);
    }
    // 우선 서버의 일일 로그를 소스로 사용(장치 간 일관성)
    loadDailyLogFromApi(user?.id).then((serverLog) => {
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    }).catch(() => {
      setDailyLog(loadDailyLog(user?.id));
    });
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
      const local = loadState(user?.id);
      if (apiState) {
        const { merged: toApply, didPreserve } = mergeIncomingStateSafely(apiState, local);
        if (didPreserve) persistState(toApply);
        setState(toApply);
        if (Array.isArray(toApply.overlayPresets) && toApply.overlayPresets.length > 0) {
          setPresets(toApply.overlayPresets as OverlayPreset[]);
        } else if (localPresets.length > 0) {
          const next = { ...toApply, overlayPresets: localPresets };
          setState(next);
          persistState(next);
        } else {
          const first = defaultPreset("전체 통합", { showMembers: true, showTotal: true });
          const merged = { ...toApply, overlayPresets: [first] };
          setPresets([first]);
          setState(merged);
          persistState(merged);
          try { window.localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify([first])); } catch {}
        }
        setSyncStatus("synced");
        try { window.localStorage.setItem(storageKey(user?.id), JSON.stringify(toApply)); } catch {}
      } else {
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
  }, [user, persistState, mergeIncomingStateSafely]);

  useEffect(() => {
    const id = window.setInterval(() => setTimerUiNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
        // 구버전 원격 데이터로 최신 로컬 덮어쓰기 방지: 원격이 더 최신일 때만 적용
        const shouldApplyRemote = remoteUpdatedAt > stateUpdatedAtRef.current;
        if (shouldApplyRemote) {
          stateUpdatedAtRef.current = remoteUpdatedAt;
          const prev = stateRef.current;
          const { merged: toApply, didPreserve } = mergeIncomingStateSafely(remote, prev);
          if (didPreserve) persistState(toApply);
          setState(toApply);
          if (Array.isArray(toApply.overlayPresets)) {
            setPresets(toApply.overlayPresets as OverlayPreset[]);
          }
          pendingUnsyncedRef.current = false;
          try { window.localStorage.setItem(storageKey(user?.id), JSON.stringify(toApply)); } catch {}
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
  }, [user, persistState, mergeIncomingStateSafely]);

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
  /** 방송/OBS용: snap 없음 → 오버레이는 항상 `/api/state` 기준 실시간 반영 (스냅샷은 아래 프리뷰 iframe 전용) */
  const buildPrismOverlayUrl = (p: OverlayPreset, vertical: boolean): string => {
    if (typeof window === "undefined") return "";
    const isGoalOnlyPreset =
      Boolean(p.showGoal) &&
      !Boolean(p.showMembers) &&
      !Boolean(p.showTotal) &&
      !Boolean(p.showTimer) &&
      !Boolean(p.showMission) &&
      !Boolean(p.showPersonalGoal);
    if (isGoalOnlyPreset) {
      const goalOnly = new URL(`${window.location.origin}/overlay/goal`);
      goalOnly.searchParams.set("p", p.id);
      goalOnly.searchParams.set("u", user?.id || "finalent");
      goalOnly.searchParams.set("host", "prism");
      /** goal·goalCurrent 미포함: `/api/state` 프리셋과 동기·목표 자동 상향(useGoalPresetAutoEscalate)에 맞춤 */
      goalOnly.searchParams.set("goalLabel", (p.goalLabel || "후원").trim());
      goalOnly.searchParams.set("goalWidth", String(Math.max(260, Math.min(1200, parseInt((p.goalWidth || "560") as any, 10) || 560))));
      if (String(p.goalOpacity || "").trim()) {
        goalOnly.searchParams.set("goalOpacity", String(Math.max(0, Math.min(100, parseInt(String(p.goalOpacity), 10) || 100))));
      }
      if (p.goalOpacityText) {
        goalOnly.searchParams.set("goalOpacityText", "true");
      }
      return goalOnly.toString();
    }
    const base = `${window.location.origin}/overlay`;
    /** 목표 금액은 URL에 넣지 않음 → `/api/state` 프리셋·자동 목표 상향과 일치 */
    const q = new URLSearchParams();
    q.set("p", p.id);
    q.set("u", user?.id || "finalent");
    q.set("vertical", vertical ? "true" : "false");
    q.set("host", "prism");
    q.set(
      "tableBgOpacity",
      p.tableBgOpacity && String(p.tableBgOpacity).trim() ? String(p.tableBgOpacity).trim() : "100"
    );
    q.set("showGoal", p.showGoal ? "true" : "false");
    if (p.showGoal) {
      /** goal·goalCurrent 미포함 → 저장 프리셋·자동 목표 상향이 OBS와 일치 */
      q.set("goalLabel", (p.goalLabel || "후원").trim());
      q.set("goalWidth", String(Math.max(200, Math.min(800, parseInt((p.goalWidth || "400") as any, 10) || 400))));
      if (String(p.goalOpacity || "").trim()) {
        q.set("goalOpacity", String(Math.max(0, Math.min(100, parseInt(String(p.goalOpacity), 10) || 100))));
      }
      if (p.goalOpacityText) {
        q.set("goalOpacityText", "true");
      }
    }
    return `${base}?${q.toString()}`;
  };
  const buildPrismDemoOverlayUrl = (p: OverlayPreset, vertical: boolean): string => {
    const baseUrl = buildPrismOverlayUrl(p, vertical);
    if (!baseUrl) return "";
    const u = new URL(baseUrl);
    u.searchParams.set("demo", "true");
    return u.toString();
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
  const PREVIEW_SNAP_PREFIX = "excel-preview-snap-";
  const buildStablePreviewUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const isGoalOnlyPreset =
      Boolean(p.showGoal) &&
      !Boolean(p.showMembers) &&
      !Boolean(p.showTotal) &&
      !Boolean(p.showTimer) &&
      !Boolean(p.showMission) &&
      !Boolean(p.showPersonalGoal);
    if (isGoalOnlyPreset) {
      const goalOnly = new URL(`${window.location.origin}/overlay/goal`);
      goalOnly.searchParams.set("u", user?.id || "finalent");
      if (p.id) goalOnly.searchParams.set("p", p.id);
      goalOnly.searchParams.set("goal", String(Math.max(0, parseInt((p.goal || "0") as any, 10) || 0)));
      goalOnly.searchParams.set("goalLabel", (p.goalLabel || "후원").trim());
      goalOnly.searchParams.set("goalWidth", String(Math.max(260, Math.min(1200, parseInt((p.goalWidth || "560") as any, 10) || 560))));
      if (String(p.goalOpacity || "").trim()) {
        goalOnly.searchParams.set("goalOpacity", String(Math.max(0, Math.min(100, parseInt(String(p.goalOpacity), 10) || 100))));
      }
      if (p.goalOpacityText) {
        goalOnly.searchParams.set("goalOpacityText", "true");
      }
      if (String(p.goalCurrent || "").trim()) {
        goalOnly.searchParams.set("goalCurrent", String(Math.max(0, parseInt(String(p.goalCurrent), 10) || 0)));
      }
      goalOnly.searchParams.set("previewGuide", "true");
      return goalOnly.toString();
    }
    const base = `${window.location.origin}/overlay`;
    const q = new URLSearchParams(presetToParams(p));
    q.set("p", p.id);
    q.set("u", user?.id || "finalent");
    q.set("previewGuide", "true");
    const isVertical = !!p.vertical;
    q.set("renderWidth", isVertical ? "1080" : "1920");
    q.set("renderHeight", isVertical ? "1920" : "1080");
    const hasMembersWithGoal = state.members.some((m) => (m.goal || 0) > 0);
    if (hasMembersWithGoal) q.set("showPersonalGoal", "true");
    const snapUpdatedAt = Number(state.updatedAt || 0) > 0 ? Number(state.updatedAt) : Date.now();
    try {
      const snapObj = {
        members: state.members.map(m => ({ id: m.id, name: m.name, account: m.account, toon: m.toon, contribution: m.contribution || 0, goal: m.goal, operating: m.operating })),
        memberPositions: state.memberPositions || {},
        donors: state.donors || [],
        missions: (state as any).missions || [],
        forbiddenWords: state.forbiddenWords || [],
        goal: (() => { const n = parseInt((p.goal || "0") as any, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; })(),
        goalCurrent: (() => {
          const raw = (p.goalCurrent || "") as any;
          const n = raw === "" || raw === null || raw === undefined ? null : parseInt(String(raw), 10);
          return n === null || Number.isNaN(n) ? null : Math.max(0, n);
        })(),
        updatedAt: snapUpdatedAt,
      };
      const json = JSON.stringify(snapObj);
      const b64 = btoa(encodeURIComponent(json));
      q.set("snap", b64);
      const urlWithSnap = `${base}?${q.toString()}`;
      if (urlWithSnap.length <= 1900) {
        return urlWithSnap;
      }
      q.delete("snap");
      // Stable key per saved state version to prevent iframe reload loops.
      const snapKey = PREVIEW_SNAP_PREFIX + snapUpdatedAt + "-" + p.id;
      localStorage.setItem(snapKey, JSON.stringify(snapObj));
      q.set("snapKey", snapKey);
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(PREVIEW_SNAP_PREFIX)) {
            const age = Date.now() - parseInt(k.replace(PREVIEW_SNAP_PREFIX, "").split("-")[0] || "0", 10);
            if (age > 600000) keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch {}
    } catch {}
    return `${base}?${q.toString()}`;
  };

  const getBattleScalePct = (): number => {
    const raw = battleScalePct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(50, Math.min(300, n));
  };
  const getBattleContentWidthPct = useCallback((): number => {
    const raw = battleContentWidthPct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(40, Math.min(100, n));
  }, [battleContentWidthPct]);
  const buildSigMatchLiveUrl = useCallback((): string => {
    if (typeof window === "undefined") return "";
    const uid = user?.id || "finalent";
    const raw = battleScalePct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    const scalePct = Number.isFinite(n) ? Math.max(50, Math.min(300, n)) : 100;
    const q = new URLSearchParams();
    q.set("u", uid);
    q.set("scalePct", String(scalePct));
    q.set("contentWidthPct", String(getBattleContentWidthPct()));
    return `${window.location.origin}/overlay/sig-match?${q.toString()}`;
  }, [user?.id, battleScalePct, getBattleContentWidthPct]);
  const buildMealMatchLiveUrl = useCallback((): string => {
    if (typeof window === "undefined") return "";
    const uid = user?.id || "finalent";
    const raw = battleScalePct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    const scalePct = Number.isFinite(n) ? Math.max(50, Math.min(300, n)) : 100;
    const q = new URLSearchParams();
    q.set("u", uid);
    q.set("scalePct", String(scalePct));
    q.set("contentWidthPct", String(getBattleContentWidthPct()));
    return `${window.location.origin}/overlay/meal-match?${q.toString()}`;
  }, [user?.id, battleScalePct, getBattleContentWidthPct]);

  const sigMatchPreviewUrlRef = useRef("");
  const [sigMatchPreviewIframeSrc, setSigMatchPreviewIframeSrc] = useState("");
  /** 대전 배율·유저 변경 시 미리보기 iframe URL을 즉시 동기화(기존: 최초 1회만 세팅되어 배율 미반영) */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = buildSigMatchLiveUrl();
    sigMatchPreviewUrlRef.current = url;
    setSigMatchPreviewIframeSrc(url);
  }, [buildSigMatchLiveUrl]);

  const copyUrl = async (url: string, id: string) => {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(url); }
      else { const ta = document.createElement("textarea"); ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };
  const rouletteUserId = user?.id || "finalent";
  const getSigSalesMenuCount = useCallback((): number => {
    return clampSigSalesMenuCount(sigSalesMenuCount);
  }, [sigSalesMenuCount]);
  useEffect(() => {
    const persisted = clampSigSalesMenuCount(state.rouletteState?.menuCount);
    const asText = String(persisted);
    if (sigSalesMenuCount !== asText) setSigSalesMenuCount(asText);
  }, [state.rouletteState?.menuCount, sigSalesMenuCount]);
  const rouletteQuickUrls = useMemo(() => {
    /** 서버 selectedSigs를 프론트에서 항상 순차 연출하므로 단일휠 강제 파라미터는 붙이지 않는다. */
    const rsScale = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
    const bundleLayoutQs = `&sigResultScalePct=${rsScale}`;
    const baseProgressPath = `/overlay/sig-sales?u=${rouletteUserId}&menuCount=${getSigSalesMenuCount()}${bundleLayoutQs}`;
    const progressPath = selectedMemberId
      ? `${baseProgressPath}&memberId=${encodeURIComponent(selectedMemberId)}`
      : baseProgressPath;
    const progressDemoPath = `${progressPath}&rouletteDemo=1`;
    const memberProgressPath = selectedMemberId
      ? progressPath
      : "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return {
      progressPath,
      progressDemoPath,
      memberProgressPath,
      progressAbs: origin ? `${origin}${progressPath}` : "",
      progressDemoAbs: origin ? `${origin}${progressDemoPath}` : "",
      memberProgressAbs: origin && memberProgressPath ? `${origin}${memberProgressPath}` : "",
    };
  }, [rouletteUserId, selectedMemberId, getSigSalesMenuCount, state.rouletteState?.sigResultScalePct]);
  const rouletteQuickSummaryText = useMemo(() => {
    const lines = [
      `[통합 오버레이] ${rouletteQuickUrls.progressAbs}`,
      `[통합 데모] ${rouletteQuickUrls.progressDemoAbs}`,
    ];
    return lines.join("\n");
  }, [rouletteQuickUrls]);
  const rouletteServerStatus = useMemo(() => {
    const rs = state.rouletteState;
    if (!rs) {
      return {
        phase: "IDLE",
        isRolling: false,
        sessionShort: "—",
        startedLabel: "—",
        nWin: 0,
        hasOneShot: false,
      };
    }
    const sid = (rs.sessionId || "").trim();
    const sessionShort = sid.length > 24 ? `${sid.slice(0, 22)}…` : sid || "—";
    const st = Number(rs.startedAt || 0);
    const startedLabel =
      st > 0
        ? new Date(st).toLocaleString("ko-KR", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
        : "—";
    return {
      phase: rs.phase || "IDLE",
      isRolling: Boolean(rs.isRolling),
      sessionShort,
      startedLabel,
      nWin: (rs.selectedSigs || []).length,
      hasOneShot: Boolean(rs.oneShotResult),
    };
  }, [state.rouletteState]);
  const getDonorRankingsZoomPct = (): number => {
    const raw = donorRankingsZoomPct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(30, Math.min(300, n));
  };
  const buildDonorRankingsUrl = (opts?: { test?: boolean }): string => {
    if (typeof window === "undefined") return "";
    const q = new URLSearchParams();
    q.set("u", user?.id || "finalent");
    q.set("zoomPct", String(getDonorRankingsZoomPct()));
    if (opts?.test) q.set("test", "true");
    return `${window.location.origin}/overlay/donor-rankings?${q.toString()}`;
  };
  const buildEmergencySnapshotUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const snapObj = {
      members: state.members.map(m => ({ id: m.id, name: m.name, account: m.account, toon: m.toon, contribution: m.contribution || 0, goal: m.goal, operating: m.operating })),
      memberPositions: state.memberPositions || {},
      donors: state.donors || [],
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

  useEffect(() => {
    setChatDraft(formatChatLine(state));
    setChatDraftDirty(false);
  }, [state, persistState]);

  useEffect(() => {
    const hasOneShot = (state.sigInventory || []).some((x) => x.id === ONE_SHOT_SIG_ID);
    const hasMultiCountItem = (state.sigInventory || []).some((x) => x.id !== ONE_SHOT_SIG_ID && Number(x.maxCount || 1) !== 1);
    const totalAmount = (state.sigInventory || [])
      .filter((x) => x.id !== ONE_SHOT_SIG_ID && Boolean(x.isActive))
      .reduce((sum, x) => sum + Math.max(0, Number(x.price || 0)), 0);
    const oneShot = (state.sigInventory || []).find((x) => x.id === ONE_SHOT_SIG_ID);
    const needsSync =
      !hasOneShot ||
      hasMultiCountItem ||
      !oneShot ||
      oneShot.name !== ONE_SHOT_SIG_NAME ||
      oneShot.price !== totalAmount ||
      oneShot.maxCount !== 1 ||
      oneShot.soldCount !== 0 ||
      oneShot.isRolling !== false ||
      oneShot.isActive !== true;
    if (!needsSync) return;
    setState((prev: AppState) => {
      const clampedInventory = (prev.sigInventory || []).map((x) => {
        if (x.id === ONE_SHOT_SIG_ID) return x;
        return { ...x, maxCount: 1, soldCount: Math.max(0, Math.min(1, Number(x.soldCount || 0))) };
      });
      const draft = { ...prev, sigInventory: clampedInventory };
      const next = syncOneShotSigItem(draft);
      if (next === prev) return prev;
      persistState(next);
      return next;
    });
  }, [state.sigInventory, persistState, syncOneShotSigItem]);

  useEffect(() => {
    // Retry unsynced writes quickly to minimize cross-device drift.
    const id = setInterval(() => {
      if (pendingUnsyncedRef.current || syncStatusRef.current === "error") {
        persistState(state);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [state, persistState]);

  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const key = storageKey(user.id);
    const dailyKey = dailyLogStorageKey(user.id);
    const handler = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          const incoming = JSON.parse(e.newValue) as AppState;
          const incomingUpdatedAt = incoming.updatedAt || 0;
          if (incomingUpdatedAt <= stateUpdatedAtRef.current) return;
          stateUpdatedAtRef.current = incomingUpdatedAt;
          setState((prev) => {
            const { merged, didPreserve } = mergeIncomingStateSafely(incoming, prev);
            if (didPreserve) queueMicrotask(() => persistState(merged));
            return merged;
          });
        } catch {
          // ignore
        }
      } else if (e.key === dailyKey) {
        setDailyLog(loadDailyLog(user.id));
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [user?.id, persistState, mergeIncomingStateSafely]);

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
        members: prev.members.map((x: Member) => (x.id === id ? { ...x, account: 0, toon: 0, contribution: 0 } : x)),
      };
      persistState(next);
      return next;
    });
  };

  const resetAllMembersAmounts = () => {
    requestConfirm("모든 멤버 금액 리셋", "모든 멤버의 계좌/투네/기여도를 0으로 리셋할까요?", () => {
      setState((prev: AppState) => {
        const next: AppState = {
          ...prev,
          members: prev.members.map((x: Member) => ({ ...x, account: 0, toon: 0, contribution: 0 })),
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
      `계좌: ${target?.account ?? 0}, 투네: ${target?.toon ?? 0}, 기여도: ${target?.contribution ?? 0}\n` +
      `연결된 후원 기록: ${donorsCount}건\n\n` +
      `삭제 후에는 되돌릴 수 없습니다. 계속할까요?`;
    requestConfirm("멤버 삭제", warn, () => {
      setState((prev: AppState) => {
        const members = prev.members.filter((m) => m.id !== id);
        const donors = prev.donors.filter((d) => d.memberId !== id);
        const nextSigMatch = { ...(prev.sigMatch || {}) };
        const nextMealMatch = { ...(prev.mealMatch || {}) };
        delete nextSigMatch[id];
        delete nextMealMatch[id];
        const next: AppState = {
          ...prev,
          members,
          memberPositions: Object.fromEntries(
            Object.entries(prev.memberPositions || {}).filter(([k]) => k !== id)
          ),
          donors,
          sigMatch: nextSigMatch,
          mealMatch: nextMealMatch,
          mealBattle: {
            ...prev.mealBattle,
            participants: (prev.mealBattle?.participants || []).filter((p) => p.memberId !== id),
            memberGaugeColors: Object.fromEntries(
              Object.entries(prev.mealBattle?.memberGaugeColors || {}).filter(([k]) => k !== id)
            ),
            teamAMemberIds: (prev.mealBattle?.teamAMemberIds || []).filter((x) => x !== id),
            teamBMemberIds: (prev.mealBattle?.teamBMemberIds || []).filter((x) => x !== id),
          },
          mealMatchSettings: {
            ...prev.mealMatchSettings,
            teamAMemberIds: (prev.mealMatchSettings?.teamAMemberIds || []).filter((x) => x !== id),
            teamBMemberIds: (prev.mealMatchSettings?.teamBMemberIds || []).filter((x) => x !== id),
          },
        };
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
      const next: AppState = {
        ...prev,
        members: [...prev.members, { id, name: base, account: 0, toon: 0, contribution: 0 }],
        memberPositions: { ...(prev.memberPositions || {}) },
        sigMatch: { ...(prev.sigMatch || {}), [id]: 0 },
        mealMatch: { ...(prev.mealMatch || {}), [id]: 0 },
        mealBattle: {
          ...prev.mealBattle,
          participants: [...(prev.mealBattle?.participants || [])],
        },
      };
      persistState(next);
      return next;
    });
    setNewMemberName("");
  };

  const updateMemberPosition = (memberId: string, position: string) => {
    setState((prev: AppState) => {
      const cleaned = (position || "").trim();
      const nextMap = { ...(prev.memberPositions || {}) };
      if (cleaned) nextMap[memberId] = cleaned;
      else delete nextMap[memberId];
      const next: AppState = { ...prev, memberPositions: nextMap };
      persistState(next);
      return next;
    });
  };

  const updateMemberPositionMode = (mode: AppState["memberPositionMode"]) => {
    setState((prev: AppState) => {
      const next: AppState = { ...prev, memberPositionMode: mode };
      persistState(next);
      return next;
    });
  };

  const updateRepresentativeMember = (memberId: string) => {
    setState((prev: AppState) => {
      const nextMap = { ...(prev.memberPositions || {}) };
      for (const m of prev.members) {
        if (nextMap[m.id] === "대표") delete nextMap[m.id];
      }
      if (memberId) nextMap[memberId] = "대표";
      const next: AppState = { ...prev, memberPositions: nextMap };
      persistState(next);
      return next;
    });
  };

  const updateRankPositionLabel = (index: number, value: string) => {
    setState((prev: AppState) => {
      const labels = [...(prev.rankPositionLabels || ["대표", "이사", "부장", "과장", "대리", "사원"])];
      while (labels.length <= index) labels.push("");
      labels[index] = value;
      const next: AppState = { ...prev, rankPositionLabels: labels };
      persistState(next);
      return next;
    });
  };

  const updateSigMatchSettings = (patch: Partial<AppState["sigMatchSettings"]>) => {
    setState((prev: AppState) => {
      const valid = new Set(prev.members.map((mm) => mm.id));
      const merged: AppState["sigMatchSettings"] = {
        ...prev.sigMatchSettings,
        sigMatchPools: prev.sigMatchSettings.sigMatchPools ?? [],
        ...patch,
      };
      const next: AppState = {
        ...prev,
        sigMatchSettings: {
          ...merged,
          sigMatchPools: normalizeSigMatchPools(merged.sigMatchPools, valid),
          participantMemberIds: normalizeSigMatchParticipantIds(merged.participantMemberIds, valid),
        },
      };
      persistState(next);
      return next;
    });
  };

  const updateMealMatchSettings = (patch: Partial<AppState["mealMatchSettings"]>) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        mealMatchSettings: {
          ...prev.mealMatchSettings,
          ...patch,
        },
      };
      persistState(next);
      return next;
    });
  };

  const updateDonorRankingsTheme = (patch: Partial<AppState["donorRankingsTheme"]>) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        donorRankingsTheme: {
          ...(prev.donorRankingsTheme || defaultState().donorRankingsTheme),
          ...patch,
        },
      };
      persistState(next);
      return next;
    });
  };

  const updateDonationListsOverlayConfig = (patch: Partial<OverlayConfig>) => {
    setState((prev: AppState) => {
      const base = normalizeDonationListsOverlayConfig(prev.donationListsOverlayConfig);
      const next: AppState = {
        ...prev,
        donationListsOverlayConfig: { ...base, ...patch },
      };
      persistState(next);
      return next;
    });
  };

  const updateDonorRankingsOverlayConfig = (patch: Partial<OverlayConfig>) => {
    setState((prev: AppState) => {
      const base = normalizeDonorRankingsOverlayConfig(prev.donorRankingsOverlayConfig);
      const next: AppState = {
        ...prev,
        donorRankingsOverlayConfig: { ...base, ...patch },
      };
      persistState(next);
      return next;
    });
  };

  const applyDonorRankingsPreset = (id: string) => {
    setState((prev: AppState) => {
      const preset = (prev.donorRankingsPresets || []).find((x) => x.id === id);
      if (!preset) return prev;
      const next: AppState = {
        ...prev,
        donorRankingsPresetId: id,
        donorRankingsTheme: { ...preset.theme },
      };
      persistState(next);
      return next;
    });
  };

  const saveDonorRankingsPreset = () => {
    const name = (donorRankingPresetName || "").trim() || `후원순위 프리셋 ${(state.donorRankingsPresets?.length || 0) + 1}`;
    setState((prev: AppState) => {
      const preset = {
        id: `drp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        theme: { ...(prev.donorRankingsTheme || defaultState().donorRankingsTheme) },
      };
      const next: AppState = {
        ...prev,
        donorRankingsPresets: [...(prev.donorRankingsPresets || []), preset],
        donorRankingsPresetId: preset.id,
      };
      persistState(next);
      return next;
    });
    setDonorRankingPresetName("");
  };

  const deleteDonorRankingsPreset = (id: string) => {
    setState((prev: AppState) => {
      const presets = (prev.donorRankingsPresets || []).filter((x) => x.id !== id);
      const next: AppState = {
        ...prev,
        donorRankingsPresets: presets,
        donorRankingsPresetId: prev.donorRankingsPresetId === id ? presets[0]?.id : prev.donorRankingsPresetId,
      };
      persistState(next);
      return next;
    });
  };

  const MEAL_PARTICIPANT_COLORS = ["#60a5fa", "#f59e0b", "#22c55e", "#ef4444", "#a78bfa", "#06b6d4", "#f472b6"];

  const updateMealBattle = (patch: Partial<AppState["mealBattle"]>) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          ...patch,
        },
      };
      persistState(next);
      return next;
    });
  };

  const toggleMealParticipant = (memberId: string, checked: boolean) => {
    setState((prev: AppState) => {
      const member = prev.members.find((m) => m.id === memberId);
      if (!member) return prev;
      const existing = prev.mealBattle?.participants || [];
      const exists = existing.some((p) => p.memberId === memberId);
      let participants = existing;
      if (checked && !exists) {
        participants = [
          ...existing,
          {
            memberId,
            name: member.name,
            score: 0,
            goal: Math.max(1, Math.floor(prev.mealBattle?.totalGoal || 100)),
            color:
              prev.mealBattle?.memberGaugeColors?.[memberId] ||
              MEAL_PARTICIPANT_COLORS[existing.length % MEAL_PARTICIPANT_COLORS.length],
            donationLinkActive: false,
            donationLinkStartedAt: undefined,
          },
        ];
      } else if (!checked && exists) {
        participants = existing.filter((p) => p.memberId !== memberId);
      }
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          participants,
        },
      };
      persistState(next);
      return next;
    });
  };

  const updateMealParticipant = (
    memberId: string,
    updater: (participant: AppState["mealBattle"]["participants"][number]) => AppState["mealBattle"]["participants"][number]
  ) => {
    setState((prev: AppState) => {
      const participants = (prev.mealBattle?.participants || []).map((p) => (p.memberId === memberId ? updater(p) : p));
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          participants,
        },
      };
      persistState(next);
      return next;
    });
  };

  const mergeMealMemberGaugeColor = (memberId: string, color: string) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          memberGaugeColors: { ...(prev.mealBattle?.memberGaugeColors || {}), [memberId]: color },
        },
      };
      persistState(next);
      return next;
    });
  };

  const patchMealParticipantColor = (memberId: string, color: string) => {
    setState((prev: AppState) => {
      const participants = (prev.mealBattle?.participants || []).map((p) =>
        p.memberId === memberId ? { ...p, color } : p
      );
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          participants,
          memberGaugeColors: { ...(prev.mealBattle?.memberGaugeColors || {}), [memberId]: color },
        },
      };
      persistState(next);
      return next;
    });
  };

  const setMealBattleMemberTeam = (memberId: string, team: "" | "A" | "B") => {
    setState((prev: AppState) => {
      const a = (prev.mealBattle?.teamAMemberIds || []).filter((id) => id !== memberId);
      const b = (prev.mealBattle?.teamBMemberIds || []).filter((id) => id !== memberId);
      const nextA = team === "A" ? [...a, memberId] : a;
      const nextB = team === "B" ? [...b, memberId] : b;
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          teamAMemberIds: nextA,
          teamBMemberIds: nextB,
        },
      };
      persistState(next);
      return next;
    });
  };

  const resetMealMatchScores = () => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          participants: (prev.mealBattle?.participants || []).map((p) => ({ ...p, score: 0 })),
        },
      };
      persistState(next);
      return next;
    });
  };

  const adjustSigMatchScore = (memberId: string, delta: number) => {
    setState((prev: AppState) => {
      const current = prev.sigMatch?.[memberId] || 0;
      const nextScore = Math.max(0, current + delta);
      const next: AppState = {
        ...prev,
        sigMatch: {
          ...(prev.sigMatch || {}),
          [memberId]: nextScore,
        },
      };
      persistState(next);
      return next;
    });
  };

  const toggleSigRollingItem = (id: string, checked: boolean) => {
    if (id === ONE_SHOT_SIG_ID) return;
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, isRolling: checked } : x)),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
  };

  const toggleSigActiveItem = (id: string, checked: boolean) => {
    if (id === ONE_SHOT_SIG_ID) return;
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, isActive: checked } : x)),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
  };

  const spinSigRoulette = async () => {
    /** 오버레이 URL의 `u=` 와 동일해야 폴링 상태가 맞음 (`user` 미로드 시 finalent 등) */
    const uid = rouletteUserId;
    setRouletteSpinBusy(true);
    setRouletteActionMessage("");
    try {
      const rs = state.rouletteState;
      if (rs) {
        const idle = (rs.phase || "IDLE") === "IDLE";
        const blockedUntilReset =
          !idle ||
          rs.isRolling ||
          (rs.selectedSigs || []).length > 0 ||
          Boolean(rs.oneShotResult);
        if (blockedUntilReset) {
          setRouletteActionMessage("이전 회전 결과를 초기화한 뒤 회전을 시작합니다…");
          try {
            const resetRes = await fetch(`/api/roulette/reset?user=${encodeURIComponent(uid)}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const resetJ = (await resetRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
            if (!resetRes.ok) {
              setRouletteActionMessage(
                `회전판 초기화 실패: ${resetJ.error || resetRes.status}. 아래「회전판 초기화 (IDLE)」를 누른 뒤 다시 시도하세요.`
              );
              return;
            }
            const remoteAfterReset = await loadStateFromApi(uid);
            if (remoteAfterReset) {
              setState(remoteAfterReset);
              try {
                window.localStorage.setItem(storageKey(uid), JSON.stringify(remoteAfterReset));
              } catch {}
            }
          } catch (e) {
            setRouletteActionMessage(`회전판 초기화 오류: ${String(e)}`);
            return;
          }
        }
      }
      const n = Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5));
      const cap = Math.min(n, ROULETTE_ROUND_UI_CAP);
      let parts = roulettePriceRanges.slice(0, cap);
      while (parts.length < cap) parts.push({ min: "", max: "" });
      const toRange = (v: { min: string; max: string }): { min: number | null; max: number | null } | null => {
        const minRaw = String(v?.min || "").replace(/[^\d]/g, "");
        const maxRaw = String(v?.max || "").replace(/[^\d]/g, "");
        const minNum = minRaw ? Math.floor(Number.parseInt(minRaw, 10) || 0) : 0;
        const maxNum = maxRaw ? Math.floor(Number.parseInt(maxRaw, 10) || 0) : 0;
        const hasMin = minNum > 0;
        const hasMax = maxNum > 0;
        if (!hasMin && !hasMax) return null;
        const min = hasMin ? minNum : null;
        const max = hasMax ? maxNum : null;
        if (min != null && max != null && min > max) {
          return { min: max, max: min };
        }
        return { min, max };
      };
      const priceRanges: Array<{ min: number | null; max: number | null } | null> = parts.map(toRange);
      const pad = priceRanges[priceRanges.length - 1] ?? null;
      while (priceRanges.length < n) priceRanges.push(pad);
      const res = await fetch(`/api/roulette/spin?user=${encodeURIComponent(uid)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spinCount: n, priceRanges }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        round?: number;
        need?: number;
        have?: number;
      };
      if (!res.ok) {
        setRouletteActionMessage(
          res.status === 401 || j.error === "unauthorized"
            ? "로그인 세션이 없거나 만료되었습니다. 새로고침 후 다시 로그인해 주세요."
            : j.error === "empty_inventory"
              ? "시그 인벤토리가 비어 있습니다."
              : j.error === "empty_price_tier"
                ? typeof j.round === "number"
                  ? `${j.round}회차: 선택한 금액대에 뽑을 시그가 없습니다.`
                  : "선택한 금액대에 남은 시그가 없습니다."
                : j.error === "empty_price_range"
                  ? typeof j.round === "number"
                    ? `${j.round}회차: 설정한 최소/최대 범위에 뽑을 시그가 없습니다.`
                    : "설정한 최소/최대 범위에 남은 시그가 없습니다."
                  : j.error === "not_enough_unique_sigs"
                    ? typeof j.need === "number" && typeof j.have === "number"
                      ? `서로 다른 시그가 부족합니다(필요 ${j.need}개 · 후보 ${j.have}개). 인벤토리를 늘리거나 뽑기 개수를 줄이세요.`
                      : "서로 다른 시그 수가 부족합니다."
                    : `회전판 실패: ${j.error || res.status}`
        );
        return;
      }
      const remote = await loadStateFromApi(uid);
      if (remote) {
        setState(remote);
        try {
          window.localStorage.setItem(storageKey(uid), JSON.stringify(remote));
        } catch {}
      }
      const uniq = Array.from(
        new Set(
          priceRanges.map((x) => {
            if (!x) return "전체";
            const min = x.min != null ? x.min.toLocaleString("ko-KR") : "";
            const max = x.max != null ? x.max.toLocaleString("ko-KR") : "";
            if (min && max) return `${min}~${max}`;
            if (min) return `${min} 이상`;
            if (max) return `${max} 이하`;
            return "전체";
          })
        )
      );
      const priceLabel =
        uniq.length <= 1
          ? uniq[0] === "전체"
            ? " · 금액대 전체"
            : ` · 금액대 ${uniq[0]}원`
          : ` · 회차별 금액대 (${uniq.slice(0, 5).join(", ")}${uniq.length > 5 ? "…" : ""})`;
      setRouletteActionMessage(
        `회전 ${n}회 · 시그 ${n}개 당첨 확정(회전당 1개·중복 없음)${priceLabel}. 오버레이 /overlay/sig-sales (u=${uid}) 에서 확인하세요.`,
      );
    } catch (e) {
      setRouletteActionMessage(`회전판 요청 오류: ${String(e)}`);
    } finally {
      setRouletteSpinBusy(false);
    }
  };

  const resetRouletteIdle = async () => {
    const uid = rouletteUserId;
    setRouletteResetBusy(true);
    try {
      const res = await fetch(`/api/roulette/reset?user=${encodeURIComponent(uid)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setRouletteActionMessage(`회전판 초기화 실패: ${j.error || res.status}`);
        return;
      }
      const remote = await loadStateFromApi(uid);
      if (remote) {
        setState(remote);
        try {
          window.localStorage.setItem(storageKey(uid), JSON.stringify(remote));
        } catch {}
      }
      setRouletteActionMessage("회전판 상태를 IDLE로 초기화했습니다. 오버레이 유령 결과가 사라집니다.");
    } catch (e) {
      setRouletteActionMessage(`회전판 초기화 오류: ${String(e)}`);
    } finally {
      setRouletteResetBusy(false);
    }
  };

  const adjustSigSoldCount = (id: string, delta: number) => {
    if (id === ONE_SHOT_SIG_ID) {
      setState((prev: AppState) => {
        const markSoldOut = delta > 0;
        const draft: AppState = {
          ...prev,
          sigInventory: (prev.sigInventory || []).map((x) => {
            if (x.id === ONE_SHOT_SIG_ID) return x;
            return { ...x, soldCount: markSoldOut ? Math.max(0, x.maxCount) : 0 };
          }),
        };
        const next = syncOneShotSigItem(draft);
        persistState(next);
        return next;
      });
      return;
    }
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => {
          if (x.id !== id) return x;
          const soldCount = Math.max(0, Math.min(x.maxCount, (x.soldCount || 0) + delta));
          return { ...x, soldCount };
        }),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
  };

  const updateSigItem = (id: string, patch: Partial<AppState["sigInventory"][number]>) => {
    setState((prev: AppState) => {
      const sanitizedPatch =
        id === ONE_SHOT_SIG_ID
          ? {
              ...patch,
              name: ONE_SHOT_SIG_NAME,
              price: undefined,
              maxCount: undefined,
              soldCount: undefined,
              isRolling: undefined,
              isActive: undefined,
            }
          : patch;
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, ...sanitizedPatch } : x)),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
  };

  const removeSigItem = (id: string) => {
    if (id === ONE_SHOT_SIG_ID) return;
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).filter((x) => x.id !== id),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
  };

  const addSigItem = () => {
    const name = newSigName.trim();
    if (!name) return;
    if (newSigImageUploading) {
      setSigExcelResult("이미지 업로드 중입니다. 완료 후 시그를 추가해 주세요.");
      return;
    }
    const price = Math.max(0, Math.floor(Number(newSigPrice || 0) || 0));
    const normalizedName = name.replace(/\s+/g, "").toLowerCase();
    const hasDuplicate = (state.sigInventory || []).some((x) => (x.name || "").replace(/\s+/g, "").toLowerCase() === normalizedName);
    if (hasDuplicate) {
      setSigExcelResult(`중복 이름이라 추가하지 않았습니다: ${name}`);
      return;
    }
    let createdId = "";
    const previewSrcCandidate = (newSigPreviewUrl || resolveSigPreviewSrc(newSigImageUrl)).trim();
    setState((prev: AppState) => {
      createdId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const nextItem = {
        id: createdId,
        name,
        price,
        imageUrl: newSigImageUrl.trim(),
        memberId: newSigMemberId || prev.members[0]?.id || "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      };
      const draft: AppState = {
        ...prev,
        sigInventory: [...(prev.sigInventory || []), nextItem],
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
    if (createdId && previewSrcCandidate) {
      setSigPreviewMap((prev) => ({ ...prev, [createdId]: previewSrcCandidate }));
    }
    setNewSigName("");
    setNewSigPrice("77000");
    setNewSigMaxCount("1");
    setNewSigImageUrl("");
    setNewSigPreviewUrl("");
    setSigExcelResult("");
  };

  const downloadSigExcelTemplate = () => {
    const rows = [
      { name: "애교", price: 77000, maxCount: 1, memberName: "", imageUrl: "/images/sigs/애교.png", isRolling: "Y" },
      { name: "댄스", price: 100000, maxCount: 1, memberName: "", imageUrl: "/images/sigs/댄스.png", isRolling: "Y" },
    ];
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "sig_inventory");
    XLSX.writeFile(wb, "sig-inventory-template.xlsx");
  };

  const clearAllSigItems = () => {
    if (!confirm("시그 목록 전체를 삭제할까요?")) return;
    setState((prev: AppState) => {
      const draft: AppState = { ...prev, sigInventory: [] };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
    setSigExcelResult("시그 목록을 전체 삭제했습니다.");
  };

  const uploadSigExcel = async (file: File | null) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const first = wb.SheetNames[0];
    if (!first) {
      setSigExcelResult("엑셀 시트가 비어 있습니다.");
      return;
    }
    const sheet = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) {
      setSigExcelResult("엑셀에 데이터 행이 없습니다.");
      return;
    }
    let added = 0;
    let skipped = 0;
    setState((prev: AppState) => {
      const existing = new Set((prev.sigInventory || []).map((x) => (x.name || "").replace(/\s+/g, "").toLowerCase()));
      const memberMap = new Map((prev.members || []).map((m) => [m.name.trim(), m.id]));
      const nextItems = [...(prev.sigInventory || [])].filter((x) => x.id !== ONE_SHOT_SIG_ID);

      for (const row of rows) {
        const name = String(row.name ?? row["이름"] ?? "").trim();
        if (!name) {
          skipped += 1;
          continue;
        }
        const key = name.replace(/\s+/g, "").toLowerCase();
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }
        const price = Math.max(0, Math.floor(Number(row.price ?? row["가격"] ?? 0) || 0));
        const memberName = String(row.memberName ?? row["멤버"] ?? "").trim();
        const isRollingRaw = String(row.isRolling ?? row["노출"] ?? "Y").trim().toLowerCase();
        const imageUrl = String(row.imageUrl ?? row["이미지"] ?? "").trim();
        const rolling = isRollingRaw === "y" || isRollingRaw === "true" || isRollingRaw === "1";
        const activeCol = row.isActive ?? row["판매활성"];
        let isActive = rolling;
        if (activeCol !== undefined && activeCol !== null && String(activeCol).trim() !== "") {
          const isActiveRaw = String(activeCol).trim().toLowerCase();
          isActive = isActiveRaw === "y" || isActiveRaw === "true" || isActiveRaw === "1";
        }
        nextItems.push({
          id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          price,
          imageUrl,
          memberId: memberMap.get(memberName) || "",
          maxCount: 1,
          soldCount: 0,
          isRolling: rolling,
          isActive,
        });
        existing.add(key);
        added += 1;
      }

      const draft: AppState = { ...prev, sigInventory: nextItems };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
    setSigExcelResult(`엑셀 업로드 완료: ${added}개 추가, ${skipped}개 중복/무효로 건너뜀`);
  };

  const uploadSigImageFile = async (file: File | null): Promise<string | null> => {
    if (!file) return null;
    const mime = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    const isAllowedMime = /image\/(gif|png|jpe?g|webp)/i.test(mime);
    const isAllowedExt = /\.(gif|png|jpe?g|webp)$/i.test(name);
    const isAllowed = isAllowedMime || isAllowedExt;
    if (!isAllowed) {
      alert("gif, png, jpg(jpeg), webp 파일만 업로드 가능합니다.");
      return null;
    }
    if (file.size > MAX_SIG_UPLOAD_BYTES) {
      alert("이미지 용량은 최대 30MB까지 업로드 가능합니다.");
      return null;
    }
    const fd = new FormData();
    fd.append("file", file);
    let res: Response;
    try {
      res = await fetch("/api/upload/sig-image", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network_error";
      const normalized = String(msg || "").toLowerCase();
      const networkLike =
        normalized.includes("network") ||
        normalized.includes("failed to fetch") ||
        normalized.includes("load failed");
      alert(networkLike ? "이미지 업로드 실패: 네트워크 오류입니다. 인터넷 연결을 확인해 주세요." : `이미지 업로드 실패: ${msg}`);
      return null;
    }
    const j = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; error?: string };
    if (!res.ok || !j.ok || !j.url) {
      const rawError = typeof j.error === "string" && j.error.trim() ? j.error.trim() : String(res.status);
      const normalized = rawError.toLowerCase();
      const message =
        normalized === "unauthorized" || String(res.status) === "401"
          ? "로그인이 만료되었거나 권한이 없습니다. 새로고침 후 다시 로그인해 주세요."
          : normalized === "invalid_type"
            ? "지원하지 않는 파일 형식입니다. GIF/PNG/JPG/WEBP 파일만 업로드할 수 있습니다."
            : normalized === "file_too_large" || String(res.status) === "413"
              ? "파일 용량이 너무 큽니다. 30MB 이하 파일만 업로드할 수 있습니다."
              : normalized === "missing_file"
                ? "업로드할 파일을 찾지 못했습니다. 파일을 다시 선택해 주세요."
                : String(res.status).startsWith("5")
                  ? "서버 오류로 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요."
                  : `알 수 없는 오류(${rawError})가 발생했습니다.`;
      alert(`이미지 업로드 실패: ${message}`);
      return null;
    }
    if (isBrokenSigImageUrl(j.url)) {
      alert("이미지 업로드 실패: 사용자 경로 파싱 오류가 발생했습니다. 다시 로그인 후 재시도해 주세요.");
      return null;
    }
    return j.url;
  };

  const uploadSigImage = (id: string, file: File | null) => {
    if (!file) return;
    setSigPreviewMap((prev) => ({ ...prev, [id]: URL.createObjectURL(file) }));
    void (async () => {
      const url = await uploadSigImageFile(file);
      if (!url) return;
      updateSigItem(id, { imageUrl: url });
      setSigPreviewMap((prev) => ({ ...prev, [id]: "" }));
    })();
  };

  const uploadNewSigImage = (file: File | null) => {
    if (!file) return;
    setNewSigImageUploading(true);
    setNewSigPreviewUrl(URL.createObjectURL(file));
    void (async () => {
      const url = await uploadSigImageFile(file);
      if (url) {
        setNewSigImageUrl(url);
        setNewSigPreviewUrl("");
      }
      setNewSigImageUploading(false);
    })();
  };

  const updateSigSoldOutStampUrl = (url: string) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        sigSoldOutStampUrl: url,
      };
      persistState(next);
      return next;
    });
  };

  const uploadSigSoldOutStampImage = (file: File | null) => {
    void (async () => {
      const url = await uploadSigImageFile(file);
      if (!url) return;
      updateSigSoldOutStampUrl(url);
    })();
  };

  const uploadTableBgGifImage = (presetId: string, file: File | null) => {
    if (!file) return;
    void (async () => {
      const url = await uploadSigImageFile(file);
      if (!url) return;
      updatePreset(presetId, { tableBgGifUrl: url });
    })();
  };

  const toggleSigSalesExcluded = (id: string, excluded: boolean) => {
    setState((prev: AppState) => {
      const base = new Set((prev.sigSalesExcludedIds || []).map(String));
      if (excluded) base.add(id);
      else base.delete(id);
      const next: AppState = {
        ...prev,
        sigSalesExcludedIds: Array.from(base),
      };
      persistState(next);
      return next;
    });
  };

  const saveSigSalesPresetForMember = (memberId: string) => {
    if (!memberId) return;
    setState((prev: AppState) => {
      const memberSigIds = new Set(
        (prev.sigInventory || [])
          .filter((x) => x.id !== ONE_SHOT_SIG_ID && x.memberId === memberId)
          .map((x) => x.id)
      );
      const activeIds = (prev.sigInventory || [])
        .filter((x) => memberSigIds.has(x.id) && x.isActive)
        .map((x) => x.id);
      const next: AppState = {
        ...prev,
        sigSalesMemberPresets: {
          ...(prev.sigSalesMemberPresets || {}),
          [memberId]: activeIds,
        },
      };
      persistState(next);
      return next;
    });
    setSigExcelResult("멤버별 시그 판매 프리셋을 저장했습니다.");
  };

  const applySigSalesPresetForMember = (memberId: string) => {
    if (!memberId) return;
    if (!state.sigSalesMemberPresets?.[memberId]?.length) {
      setSigExcelResult("저장된 프리셋이 없습니다. 먼저 현재 설정을 저장해 주세요.");
      return;
    }
    setState((prev: AppState) => {
      const presetIds = new Set((prev.sigSalesMemberPresets?.[memberId] || []).map(String));
      const next: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => {
          if (x.id === ONE_SHOT_SIG_ID) return x;
          if (x.memberId !== memberId) return { ...x, isActive: false };
          return { ...x, isActive: presetIds.has(x.id) };
        }),
      };
      persistState(next);
      return next;
    });
    setSigExcelResult("선택 멤버의 시그 판매 프리셋을 적용했습니다.");
  };

  const clearSigSalesPresetForMember = (memberId: string) => {
    if (!memberId) return;
    setState((prev: AppState) => {
      const map = { ...(prev.sigSalesMemberPresets || {}) };
      delete map[memberId];
      const next: AppState = { ...prev, sigSalesMemberPresets: map };
      persistState(next);
      return next;
    });
    setSigExcelResult("선택 멤버의 시그 판매 프리셋을 삭제했습니다.");
  };

  const applyNextSigSalesPresetMember = () => {
    const presetMemberIds = state.members
      .map((m) => m.id)
      .filter((id) => (state.sigSalesMemberPresets?.[id]?.length || 0) > 0);
    if (presetMemberIds.length === 0) {
      setSigExcelResult("저장된 멤버별 판매 프리셋이 없습니다.");
      return;
    }
    const currentIdx = presetMemberIds.indexOf(sigPresetMemberId);
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % presetMemberIds.length;
    const nextMemberId = presetMemberIds[nextIdx]!;
    setSigPresetMemberId(nextMemberId);
    applySigSalesPresetForMember(nextMemberId);
  };

  const updateMatchTimer = (
    key: "generalTimer",
    updater: (timer: TimerState) => TimerState
  ) => {
    setState((prev: AppState) => {
      const current = prev[key];
      const nextTimer = updater(current);
      const next: AppState = { ...prev, [key]: nextTimer };
      persistState(next);
      return next;
    });
  };

  const adjustTimerSeconds = (key: "generalTimer", deltaSec: number) => {
    updateMatchTimer(key, (timer) => {
      const effective = getEffectiveRemainingTime(timer);
      const next = Math.max(0, effective + deltaSec);
      return {
        remainingTime: next,
        isActive: timer.isActive,
        lastUpdated: Date.now(),
      };
    });
  };

  const setTimerMinutes = (key: "generalTimer", minutes: number) => {
    const safeMin = Math.max(0, Math.floor(minutes));
    updateMatchTimer(key, (timer) => ({
      remainingTime: safeMin * 60,
      isActive: timer.isActive,
      lastUpdated: Date.now(),
    }));
  };

  const updateMatchTimerEnabled = (patch: Partial<AppState["matchTimerEnabled"]>) => {
    setState((prev: AppState) => {
      const base = prev.matchTimerEnabled || { general: true };
      const next: AppState = {
        ...prev,
        matchTimerEnabled: { ...base, ...patch },
      };
      persistState(next);
      return next;
    });
  };

  /** 시그 대전 오버레이 타이머는 식사대전과 동일하게 generalTimer로 동기화 */
  const stopSigMatchOverlayTimerSynced = () => {
    setState((prev: AppState) => {
      const valid = new Set(prev.members.map((mm) => mm.id));
      const mergedSettings = { ...prev.sigMatchSettings, overlayTimerEndAt: null as number | null };
      const next: AppState = {
        ...prev,
        generalTimer: pauseTimer(prev.generalTimer),
        sigMatchSettings: {
          ...mergedSettings,
          sigMatchPools: normalizeSigMatchPools(mergedSettings.sigMatchPools || [], valid),
          participantMemberIds: normalizeSigMatchParticipantIds(mergedSettings.participantMemberIds || [], valid),
        },
      };
      persistState(next);
      return next;
    });
  };

  const startSigMatchOverlayTimerSynced = () => {
    const sec = Math.max(0, Number(state.sigMatchSettings?.overlayTimerDurationSec || 0));
    if (sec <= 0) {
      alert("먼저 타이머 시간을 1초 이상 입력해 주세요.");
      return;
    }
    setState((prev: AppState) => {
      const valid = new Set(prev.members.map((mm) => mm.id));
      const mergedSettings = { ...prev.sigMatchSettings, overlayTimerEndAt: null as number | null };
      const next: AppState = {
        ...prev,
        generalTimer: {
          remainingTime: sec,
          isActive: true,
          lastUpdated: Date.now(),
        },
        sigMatchSettings: {
          ...mergedSettings,
          sigMatchPools: normalizeSigMatchPools(mergedSettings.sigMatchPools || [], valid),
          participantMemberIds: normalizeSigMatchParticipantIds(mergedSettings.participantMemberIds || [], valid),
        },
      };
      persistState(next);
      return next;
    });
  };

  const updateTimerDisplayStyle = (key: "general", patch: Partial<AppState["timerDisplayStyles"]["general"]>) => {
    setState((prev: AppState) => {
      const baseStyles = prev.timerDisplayStyles || {
        general: { showHours: false, fontColor: "", bgColor: "", borderColor: "", outlineColor: "", outlineWidth: 0.8, bgOpacity: 40, scalePercent: 100 },
      };
      const next: AppState = {
        ...prev,
        timerDisplayStyles: {
          ...baseStyles,
          [key]: {
            ...baseStyles[key],
            ...patch,
          },
        },
      };
      persistState(next);
      return next;
    });
  };

  const addDonor = () => {
    const amount = parseAmount(donorAmount);
    if (!donorMemberId) return;
    if (!confirmHighAmount(amount)) return;
    if (amount <= 0) return;
    const target = donorTarget;
    setState((prev: AppState) => {
      const syncMode = prev.donationSyncMode || "mealBattle";
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
        m.id === donorMemberId
          ? (() => {
              const nextAccount = field === "account" ? (m.account || 0) + amount : (m.account || 0);
              const nextToon = field === "toon" ? (m.toon || 0) + amount : (m.toon || 0);
              return { ...m, [field]: (m[field] || 0) + amount, contribution: nextAccount + nextToon };
            })()
          : m
      );
      const mealParticipants =
        syncMode === "mealBattle"
          ? applyMealBattleDonationToParticipants(
              prev.mealBattle?.participants || [],
              donorMemberId,
              amount,
              1,
              donor.at
            )
          : (prev.mealBattle?.participants || []);
      const next: AppState = {
        ...prev,
        members,
        donors,
        mealBattle: {
          ...prev.mealBattle,
          participants: mealParticipants,
        },
      };
      persistState(next);
      return next;
    });
    setDonorName("");
    setDonorAmount("");
  };

  const addContribution = () => {
    const amount = parseAmount(contributionAmount);
    if (!contributionMemberId) return;
    if (amount <= 0) return;
    setState((prev: AppState) => {
      const now = Date.now();
      const log = {
        id: `cl_${now}_${Math.random().toString(36).slice(2, 6)}`,
        memberId: contributionMemberId,
        amount,
        delta: contributionDelta,
        note: contributionNote.trim(),
        at: now,
      };
      const members = prev.members.map((m: Member) => {
        if (m.id !== contributionMemberId) return m;
        const curr = Math.max(0, m.contribution || 0);
        const nextContribution = contributionDelta > 0
          ? curr + amount
          : Math.max(0, curr - amount);
        return { ...m, contribution: nextContribution };
      });
      const next: AppState = {
        ...prev,
        members,
        contributionLogs: [...(prev.contributionLogs || []), log],
      };
      persistState(next);
      return next;
    });
    setContributionAmount("");
    setContributionNote("");
  };

  useEffect(() => {
    if (!state.members.length) return;
    if (!donorMemberId) setDonorMemberId(state.members[0].id);
  }, [state.members, donorMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    if (!contributionMemberId) setContributionMemberId(state.members[0].id);
  }, [state.members, contributionMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    const exists = state.members.some((m) => m.id === contributionMemberId);
    if (!exists) setContributionMemberId(state.members[0].id);
  }, [state.members, contributionMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    const exists = state.members.some((m) => m.id === sigPresetMemberId);
    if (!exists) setSigPresetMemberId(state.members[0].id);
  }, [state.members, sigPresetMemberId]);

  const isOperatingMember = useCallback((m: Member) => {
    const position = state.memberPositions?.[m.id] || "";
    return Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(position);
  }, [state.memberPositions]);
  const total = useMemo(
    () => state.members.reduce((sum, m) => sum + (m.account || 0) + (m.toon || 0), 0),
    [state.members]
  );
  const activeMemberCount = useMemo(
    () => state.members.filter((m) => !isOperatingMember(m)).length,
    [state.members, isOperatingMember]
  );
  const donationSyncMode = (state.donationSyncMode || "mealBattle") as "none" | "mealBattle" | "sigMatch" | "sigSales";
  const sigMatchDonors = useMemo(
    () => (donationSyncMode === "sigMatch" ? (state.donors || []) : []),
    [donationSyncMode, state.donors]
  );
  const sigMatchRanking = useMemo(
    () => getSigMatchRankings(
      sigMatchDonors,
      state.members || [],
      state.sigMatchSettings,
      state.sigMatch || {}
    ),
    [sigMatchDonors, state.members, state.sigMatchSettings, state.sigMatch]
  );
  const sigSignatureAmountsInput = useMemo(
    () => (state.sigMatchSettings?.signatureAmounts || []).join(", "),
    [state.sigMatchSettings?.signatureAmounts]
  );
  const mealParticipants = useMemo(() => state.mealBattle?.participants || [], [state.mealBattle?.participants]);

  const toggleSigMatchActive = async () => {
    const wasActive = Boolean(state.sigMatchSettings?.isActive);
    const nextActive = !wasActive;
    if (wasActive && !nextActive) {
      const rankings = getSigMatchRankings(
        sigMatchDonors,
        state.members || [],
        state.sigMatchSettings,
        state.sigMatch || {}
      );
      const title = `${state.sigMatchSettings?.title || "시그 대전"} 인센티브 정산`;
      await appendSigMatchIncentiveSettlementAndSync(
        title,
        rankings,
        state.sigMatchSettings?.incentivePerPoint || 1000,
        user?.id
      );
    }
    updateSigMatchSettings({ isActive: nextActive });
  };
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
    loadDailyLogFromApi(user?.id).then((serverLog) => {
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    }).catch(() => setDailyLog(loadDailyLog(user?.id)));
    const next: AppState = {
      ...state,
      members: state.members.map((m) => ({ ...m, account: 0, toon: 0, contribution: 0 })),
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
    loadDailyLogFromApi(user?.id).then((serverLog) => {
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    }).catch(() => setDailyLog(loadDailyLog(user?.id)));
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
    loadDailyLogFromApi(user?.id).then((serverLog) => {
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    }).catch(() => setDailyLog(loadDailyLog(user?.id)));
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
    try {
      const serverLog = await loadDailyLogFromApi(user?.id);
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    } catch {
      setDailyLog(loadDailyLog(user?.id));
    }
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
    await saveStateAsync(state, user?.id);
    appendDailyLog(state, user?.id);
    const rec = await appendSettlementRecordAndSync(title, state.members, accountRatio, toonRatio, taxRate, memberRatioOverrides, state.donors, user?.id);
    router.push(`/settlements/${rec.id}`);
  };
  const sigImageUrlIssues = (state.sigInventory || [])
    .map((item) => {
      const raw = String(item.imageUrl || "").trim();
      const isLegacyUploads = isLegacyLocalSigImageUrl(raw);
      const isBroken = isBrokenSigImageUrl(raw);
      const isEmpty = raw.length === 0;
      if (!isLegacyUploads && !isBroken && !isEmpty) return null;
      return {
        id: item.id,
        name: item.name || "(이름 없음)",
        raw,
        isLegacyUploads,
        isBroken,
        isEmpty,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    raw: string;
    isLegacyUploads: boolean;
    isBroken: boolean;
    isEmpty: boolean;
  }>;
  const legacyUploadsCount = sigImageUrlIssues.filter((x) => x.isLegacyUploads).length;
  const brokenImageUrlCount = sigImageUrlIssues.filter((x) => x.isBroken).length;
  const emptyImageUrlCount = sigImageUrlIssues.filter((x) => x.isEmpty).length;

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
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${syncStatus === "synced" ? "bg-emerald-900/60 text-emerald-300" : syncStatus === "loading" ? "bg-yellow-900/60 text-yellow-300" : syncStatus === "error" ? "bg-amber-900/60 text-amber-300" : "bg-neutral-800 text-neutral-400"}`}
              title={syncStatus === "error" ? "동기화 실패 시 개발자 도구에 401이 보이면 로그인 세션이 만료된 경우가 많습니다. 페이지를 새로고침한 뒤 다시 로그인해 보세요." : undefined}
            >
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
        {isAdminNavSectionVisible("dashboard") && (
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
        )}
        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-6">
            {isAdminNavSectionVisible("settlement") && (
            <section id="settlement-member-board" className={`${panelCardClass} p-4 md:p-6`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">멤버 정산 보드</h2>
            <div className="text-right">
              <div className="text-xs text-neutral-400">계좌 · 투네 · 기여도 · 전체</div>
              <div className="text-2xl font-bold">
                {formatManThousand(state.members.reduce((s,m)=>s+(m.account||0),0))}
                <span className="text-neutral-500 mx-1">·</span>
                {formatManThousand(state.members.reduce((s,m)=>s+(m.toon||0),0))}
                <span className="text-neutral-500 mx-1">·</span>
                {formatManThousand(state.members.reduce((s,m)=>s+((m.account||0)+(m.toon||0)),0))}
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
                  <MemberRow
                    key={m.id}
                    member={m}
                    onChange={updateMember}
                    onRename={renameMember}
                    onReset={resetMemberAmounts}
                    onDelete={deleteMember}
                    donationLinkActive={
                      mealParticipants.find((p) => p.memberId === m.id)?.donationLinkActive ?? null
                    }
                    onToggleDonationLink={() => {
                      const row = mealParticipants.find((p) => p.memberId === m.id);
                      if (!row) return;
                      updateMealParticipant(m.id, (p) => {
                        const nextActive = !p.donationLinkActive;
                        return {
                          ...p,
                          donationLinkActive: nextActive,
                          donationLinkStartedAt: nextActive ? Date.now() : undefined,
                        };
                      });
                    }}
                  />
                ))}
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-2">
                <div>
                  <h3 className="text-base font-semibold">직급 관리 (별도)</h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    직급은 멤버 정보와 분리 저장됩니다. 정렬/오버레이 표시는 아래 직급 맵을 기준으로 동작합니다.
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="text-xs text-neutral-400 mb-1">직급 모드</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs ${state.memberPositionMode !== "rankLinked" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => updateMemberPositionMode("fixed")}
                    >
                      멤버 고정 직급
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs ${state.memberPositionMode === "rankLinked" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => updateMemberPositionMode("rankLinked")}
                    >
                      순위 연동 직급
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    순위 연동 모드에서는 점수 순으로 정렬되며, 1위부터 직급 라벨이 이동하면서 붙습니다.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {state.members.map((m) => (
                    <label key={`pos-${m.id}`} className="grid grid-cols-[120px_1fr] items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
                      <span className="truncate text-sm text-neutral-300">{m.name}</span>
                      <input
                        className="w-full rounded bg-neutral-900/80 border border-white/10 px-2 py-1.5 text-sm"
                        placeholder={state.memberPositionMode === "rankLinked" ? "순위 연동 모드에서는 아래 대표 멤버만 지정" : "직급 (예: 대표, 이사, 부장)"}
                        value={state.memberPositions?.[m.id] || ""}
                        onChange={(e) => updateMemberPosition(m.id, e.target.value)}
                        disabled={state.memberPositionMode === "rankLinked"}
                      />
                    </label>
                  ))}
                </div>
                {state.memberPositionMode === "rankLinked" && (
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <div className="mb-2 grid grid-cols-1 md:grid-cols-[120px_1fr] items-center gap-2">
                      <label className="text-xs text-neutral-300">대표 멤버</label>
                      <select
                        className="w-full rounded bg-neutral-900/80 border border-white/10 px-2 py-1.5 text-sm"
                        value={state.members.find((m) => state.memberPositions?.[m.id] === "대표")?.id || ""}
                        onChange={(e) => updateRepresentativeMember(e.target.value)}
                      >
                        <option value="">미지정(순위 1위가 대표)</option>
                        {state.members.map((m) => (
                          <option key={`rep-${m.id}`} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-xs text-neutral-400 mb-2">
                      순위별 직급 라벨 (1위~12위). 대표 멤버를 지정하면 해당 멤버는 항상 대표로 고정됩니다.
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {Array.from({ length: 12 }).map((_, idx) => (
                        <label key={`rank-label-${idx}`} className="grid grid-cols-[46px_1fr] items-center gap-2 text-xs text-neutral-300">
                          <span>{idx + 1}위</span>
                          <input
                            className="w-full rounded bg-neutral-900/80 border border-white/10 px-2 py-1.5 text-sm"
                            value={state.rankPositionLabels?.[idx] || ""}
                            onChange={(e) => updateRankPositionLabel(idx, e.target.value)}
                            placeholder={idx === 0 ? "대표(고정)" : `직급 ${idx + 1}`}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 p-3 space-y-2">
                  <div className="text-sm font-semibold text-amber-200">후원 동기화 일괄 관리 (중복 방지)</div>
                  <p className="text-xs text-neutral-300">
                    후원 입력은 아래에서 선택한 대상에만 동기화됩니다. 동시에 여러 시스템에 중복 반영되지 않습니다.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["mealBattle", "식사대전 동기화"],
                      ["sigMatch", "시그대전 동기화"],
                      ["sigSales", "시그판매 동기화"],
                      ["none", "동기화 안 함"],
                    ] as Array<[AppState["donationSyncMode"], string]>).map(([mode, label]) => (
                      <button
                        key={`donation-sync-mode-${mode}`}
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${
                          donationSyncMode === mode
                            ? "bg-amber-600 text-white"
                            : "bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
                        }`}
                        onClick={() => {
                          setState((prev: AppState) => {
                            const next: AppState = { ...prev, donationSyncMode: mode || "none" };
                            persistState(next);
                            return next;
                          });
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    현재 모드: <span className="text-amber-200 font-semibold">{donationSyncMode}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">시그 대전 관리</h3>
                    <p className="text-xs text-neutral-400">Redis donors를 기준으로 점수를 실시간 집계하고, 긴급 보정값을 합산합니다.</p>
                  </div>
                  <button
                    onClick={() => { void toggleSigMatchActive(); }}
                    className={`px-3 py-1.5 rounded text-sm font-semibold ${
                      state.sigMatchSettings?.isActive ? "bg-emerald-600 hover:bg-emerald-500" : "bg-neutral-700 hover:bg-neutral-600"
                    }`}
                  >
                    {state.sigMatchSettings?.isActive ? "활성화됨" : "비활성화됨"}
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px] gap-2">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="대전 제목"
                    value={state.sigMatchSettings?.title || "시그 대전"}
                    onChange={(e) => updateSigMatchSettings({ title: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    type="number"
                    min={1}
                    value={state.sigMatchSettings?.targetCount || 100}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value || "100", 10);
                      updateSigMatchSettings({ targetCount: Number.isFinite(n) ? Math.max(1, n) : 100 });
                    }}
                  />
                  <select
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    value={state.sigMatchSettings?.scoringMode || "count"}
                    onChange={(e) => updateSigMatchSettings({ scoringMode: e.target.value as "count" | "amount" })}
                  >
                    <option value="count">점수 방식: 건수</option>
                    <option value="amount">점수 방식: 금액</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-2">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="시그 키워드 (예: 시그)"
                    value={state.sigMatchSettings?.keyword || "시그"}
                    onChange={(e) => updateSigMatchSettings({ keyword: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="시그 금액 목록 (예: 77,100,333)"
                    value={sigSignatureAmountsInput}
                    onChange={(e) => {
                      const arr = e.target.value
                        .split(",")
                        .map((x) => Number.parseInt(x.trim(), 10))
                        .filter((x) => Number.isFinite(x) && x > 0);
                      updateSigMatchSettings({ signatureAmounts: arr });
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-2 items-center">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    type="number"
                    min={0}
                    placeholder="포인트당 정산 단가"
                    value={state.sigMatchSettings?.incentivePerPoint ?? 1000}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value || "1000", 10);
                      updateSigMatchSettings({ incentivePerPoint: Number.isFinite(n) ? Math.max(0, n) : 1000 });
                    }}
                  />
                  <div className="text-xs text-neutral-400">세션 종료 시 &quot;시그 인센티브 정산&quot;이 자동 생성됩니다. (count 모드: 점수 x 단가, amount 모드: 점수=금액)</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-neutral-950/40 p-3 space-y-2">
                  <div className="text-sm font-semibold text-neutral-200">오버레이 타이머</div>
                  <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-2 items-center">
                    <input
                      className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      type="number"
                      min={0}
                      max={86400}
                      placeholder="초(0=숨김)"
                      value={state.sigMatchSettings?.overlayTimerDurationSec ?? 180}
                      onChange={(e) => {
                        const n = Number.parseInt(e.target.value || "0", 10);
                        updateSigMatchSettings({ overlayTimerDurationSec: Number.isFinite(n) ? Math.max(0, Math.min(86400, n)) : 0 });
                      }}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="rounded bg-emerald-700 px-2 py-1 text-xs hover:bg-emerald-600"
                        onClick={() => startSigMatchOverlayTimerSynced()}
                      >
                        시작
                      </button>
                      <button
                        type="button"
                        className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                        onClick={() => stopSigMatchOverlayTimerSynced()}
                      >
                        정지
                      </button>
                      <span className="text-xs text-neutral-400">
                        상태:{" "}
                        {state.generalTimer?.isActive && getEffectiveRemainingTime(state.generalTimer) > 0
                          ? "진행중"
                          : "대기"}
                      </span>
                    </div>
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    「타이머 제어」의 일반 타이머(generalTimer)와 동일 소스입니다. 시그/식사 오버레이·OBS 여러 소스가 같은 남은 시간을 보게 됩니다. 중앙 VS 위에 표시됩니다.
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-neutral-950/30 p-3 space-y-2">
                  <div>
                    <h4 className="text-sm font-semibold text-neutral-200">랭킹 표시 멤버 (참가자)</h4>
                    <p className="mt-1 text-xs text-neutral-500">
                      체크가 전부 켜져 있으면 전원이 랭킹에 나갑니다. 일부만 남기면 그 멤버만 표시·집계되며, 제외된 멤버에게 붙은 시그는 대전 점수에 포함되지 않습니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                      onClick={() => updateSigMatchSettings({ participantMemberIds: [] })}
                    >
                      전원 표시
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {state.members.map((m) => {
                      const ids = state.sigMatchSettings?.participantMemberIds ?? [];
                      const allMode = ids.length === 0;
                      const checked = allMode || ids.includes(m.id);
                      const allMemberIds = state.members.map((x) => x.id);
                      return (
                        <label key={`sig-part-${m.id}`} className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300">
                          <input
                            type="checkbox"
                            className="rounded border-white/20"
                            checked={checked}
                            onChange={() => {
                              const valid = new Set(state.members.map((mm) => mm.id));
                              if (allMode) {
                                const next = allMemberIds.filter((id) => id !== m.id);
                                updateSigMatchSettings({
                                  participantMemberIds: normalizeSigMatchParticipantIds(next, valid),
                                });
                              } else {
                                const set = new Set(ids);
                                let next: string[];
                                if (set.has(m.id)) {
                                  next = ids.filter((id) => id !== m.id);
                                } else {
                                  next = [...ids, m.id];
                                }
                                if (next.length === 0 || next.length >= allMemberIds.length) {
                                  updateSigMatchSettings({ participantMemberIds: [] });
                                } else {
                                  updateSigMatchSettings({
                                    participantMemberIds: normalizeSigMatchParticipantIds(next, valid),
                                  });
                                }
                              }
                            }}
                          />
                          <span className="truncate max-w-[120px]">{m.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-neutral-950/40 p-3 space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-neutral-200">1:1 / n:n 규칙 (시그 풀)</h4>
                    <p className="mt-1 text-xs text-neutral-500">
                      풀이 없으면 후원 멤버별 1:1 집계입니다. 풀에 넣은 멤버는 시그 1건을 풀 인원 수로 나눠 동일 반영(n:n)합니다. 멤버는 한 풀에만 속할 수 있습니다. 풀 2개 → 오버레이 좌·우(1:2·2:1 등), 풀 3개 → 삼자 막대. 풀 없이 참가자만 3명이면 오버레이는 1:1:1(삼각)로 표시됩니다. 풀을 4개 이상 만들면 시그 오버레이 막대는 <span className="text-amber-400/90">앞선 3개 풀만</span> 사용합니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                      onClick={() => {
                        const pools = [...(state.sigMatchSettings.sigMatchPools || [])];
                        pools.push({ id: `pool_${Date.now()}`, memberIds: [] });
                        const valid = new Set(state.members.map((m) => m.id));
                        updateSigMatchSettings({ sigMatchPools: normalizeSigMatchPools(pools, valid) });
                      }}
                    >
                      + 풀 추가
                    </button>
                  </div>
                  {(state.sigMatchSettings.sigMatchPools || []).length === 0 ? (
                    <p className="text-xs text-neutral-500">등록된 풀이 없습니다. 전원 1:1 방식입니다.</p>
                  ) : (
                    <div className="space-y-3">
                      {(state.sigMatchSettings.sigMatchPools || []).map((pool, pi) => (
                        <div key={pool.id} className="rounded border border-white/10 bg-neutral-900/60 p-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-neutral-300">풀 {pi + 1}</span>
                            <button
                              type="button"
                              className="rounded bg-red-900/60 px-2 py-0.5 text-[11px] hover:bg-red-800/80"
                              onClick={() => {
                                const next = (state.sigMatchSettings.sigMatchPools || []).filter((p) => p.id !== pool.id);
                                const valid = new Set(state.members.map((m) => m.id));
                                updateSigMatchSettings({ sigMatchPools: normalizeSigMatchPools(next, valid) });
                              }}
                            >
                              풀 삭제
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {state.members.map((m) => (
                              <label key={`${pool.id}-${m.id}`} className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300">
                                <input
                                  type="checkbox"
                                  className="rounded border-white/20"
                                  checked={pool.memberIds.includes(m.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    let pools = [...(state.sigMatchSettings.sigMatchPools || [])].map((p) => ({
                                      ...p,
                                      memberIds: [...p.memberIds],
                                    }));
                                    if (checked) {
                                      pools = pools.map((p) => {
                                        if (p.id === pool.id) return { ...p, memberIds: [...new Set([...p.memberIds, m.id])] };
                                        return { ...p, memberIds: p.memberIds.filter((id) => id !== m.id) };
                                      });
                                    } else {
                                      pools = pools.map((p) =>
                                        p.id === pool.id ? { ...p, memberIds: p.memberIds.filter((id) => id !== m.id) } : p
                                      );
                                    }
                                    const valid = new Set(state.members.map((mm) => mm.id));
                                    updateSigMatchSettings({ sigMatchPools: normalizeSigMatchPools(pools, valid) });
                                  }}
                                />
                                <span className="truncate max-w-[120px]">{m.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  {sigMatchRanking.map((row) => (
                    <div key={row.memberId} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#1f1f1f] px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{row.name}</div>
                        <div className="text-xs text-neutral-400">
                          점수 {formatSigMatchStat(row.score)} · 매칭 {formatSigMatchStat(row.matchedCount)}건 · 합계{" "}
                          {formatSigMatchStat(row.matchedAmount)} · 보정 {row.manualAdjust >= 0 ? "+" : ""}
                          {row.manualAdjust}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs" onClick={() => adjustSigMatchScore(row.memberId, -1)}>긴급 -1</button>
                        <button className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs" onClick={() => adjustSigMatchScore(row.memberId, 1)}>긴급 +1</button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>대전 배율(%):</span>
                  <input
                    className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    value={battleScalePct}
                    onChange={(e) => {
                      const n = Math.max(50, Math.min(300, parseInt(e.target.value.replace(/[^\d]/g, "") || "100", 10) || 100));
                      setBattleScalePct(String(n));
                    }}
                  />
                  <input
                    type="range"
                    min={50}
                    max={300}
                    step={1}
                    value={String(getBattleScalePct())}
                    onChange={(e) => setBattleScalePct(String(parseInt(e.target.value, 10) || 100))}
                  />
                  <span className="text-neutral-300">{getBattleScalePct()}%</span>
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>가로 폭(%):</span>
                  <input
                    className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    value={battleContentWidthPct}
                    onChange={(e) => {
                      const n = Math.max(40, Math.min(100, parseInt(e.target.value.replace(/[^\d]/g, "") || "100", 10) || 100));
                      setBattleContentWidthPct(String(n));
                    }}
                  />
                  <input
                    type="range"
                    min={40}
                    max={100}
                    step={1}
                    value={String(getBattleContentWidthPct())}
                    onChange={(e) => setBattleContentWidthPct(String(parseInt(e.target.value, 10) || 100))}
                  />
                  <span className="text-neutral-300">{getBattleContentWidthPct()}%</span>
                  <span className="text-[10px] text-neutral-600">(본문 너비 · 식사대전 URL 동일)</span>
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>오버레이 URL:</span>
                  <code className="text-neutral-300 break-all">
                    /overlay/sig-match?u={user?.id || "finalent"}&scalePct={getBattleScalePct()}&contentWidthPct=
                    {getBattleContentWidthPct()}
                  </code>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-sig-match" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                    onClick={() => {
                      const u = buildSigMatchLiveUrl();
                      void copyUrl(u, "dash-sig-match");
                    }}
                  >
                    {copiedId === "dash-sig-match" ? "복사됨!" : "URL 복사"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded text-xs shrink-0 bg-amber-800/90 hover:bg-amber-700"
                    onClick={() => {
                      const u = buildSigMatchLiveUrl();
                      window.open(u, "_blank", "noopener,noreferrer");
                    }}
                  >
                    실시간 오버레이 열기
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500">
                  아래 오버레이 UI는 스냅샷이 아닌 실시간 URL을 그대로 표시합니다. 관리자 변경사항이 즉시 반영됩니다.
                </p>
                <div className="mt-3 rounded-lg border border-white/10 bg-black/50 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-neutral-300">오버레이 UI 미리보기</span>
                      <span className="text-[10px] text-neutral-500">
                        scalePct={getBattleScalePct()} · contentWidthPct={getBattleContentWidthPct()} 반영 · 변경 시 자동 갱신
                      </span>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                      onClick={() => {
                        sigMatchPreviewUrlRef.current = `${buildSigMatchLiveUrl()}&_t=${Date.now()}`;
                        setSigMatchPreviewIframeSrc(sigMatchPreviewUrlRef.current);
                        setSigMatchPreviewIframeKey((k) => k + 1);
                      }}
                    >
                      새로고침
                    </button>
                  </div>
                  <div
                    className="relative w-full overflow-auto bg-black/40"
                    style={{
                      height: `${Math.min(720, Math.max(280, Math.round(280 * (getBattleScalePct() / 100))))}px`,
                    }}
                  >
                    {sigMatchPreviewIframeSrc ? (
                      <iframe
                        key={`sig-match-${sigMatchPreviewIframeKey}-${sigMatchPreviewIframeSrc.slice(0, 120)}`}
                        src={sigMatchPreviewIframeSrc}
                        title="시그 대전 오버레이 미리보기"
                        className="absolute inset-0 h-full w-full border-0"
                        style={{ background: "transparent" }}
                      />
                    ) : (
                      <div className="flex h-[280px] items-center justify-center text-xs text-neutral-500">미리보기 URL 생성 중…</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">식사 대전 관리</h3>
                    <p className="text-xs text-neutral-400">
                      참여 멤버별 게이지 색·점수·개인 목표, 상단 제목·미션 말풍선, 오버레이 색상을 실시간 제어합니다. &quot;팀대전&quot;을 켜고 멤버를 A/B에 넣으면 팀 합산 막대로 표시됩니다(팀 모드: 2분할, 개인 모드: 채움 안 색 분할). 식사 매치「개인」이면 (총점 ÷ 참가자 목표 합) 채움 막대입니다. 멤버 행에서 색을 먼저 고른 뒤 참가 체크하면 그 색이 적용됩니다.
                      &quot;후원 연동 ON&quot;인 멤버에게만 후원 입력 시 식대전 점수가 오르고(만 원 단위 환산), 다른 멤버 후원은 멤버 금액·엑셀에만 반영됩니다.
                    </p>
                  </div>
                  <button
                    className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs"
                    onClick={() => window.open(buildMealMatchLiveUrl(), "_blank", "noopener,noreferrer")}
                  >
                    식사대전 오버레이 열기
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-400">상단 큰 제목</span>
                    <input
                      className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      placeholder="예: 식사 대전"
                      value={state.mealBattle?.overlayTitle || ""}
                      onChange={(e) => updateMealBattle({ overlayTitle: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-400">미션 말풍선 (비우면 숨김)</span>
                    <input
                      className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      placeholder="예: 개똥이 사료값"
                      value={state.mealBattle?.currentMission || ""}
                      onChange={(e) => updateMealBattle({ currentMission: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block space-y-1 max-w-xl">
                  <span className="text-xs text-neutral-400">식사 매치 모드 → 오버레이 게이지 형태</span>
                  <select
                    className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    value={state.mealMatchSettings?.mode || "team"}
                    onChange={(e) => updateMealMatchSettings({ mode: e.target.value as "team" | "individual" })}
                  >
                    <option value="team">팀 — 분할/채움 형태(아래 팀대전·개인 설정과 조합)</option>
                    <option value="individual">개인(1인) — 총점÷목표합 채움 막대</option>
                  </select>
                </label>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-neutral-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(state.mealBattle?.teamBattleEnabled)}
                      onChange={(e) => updateMealBattle({ teamBattleEnabled: e.target.checked })}
                    />
                    팀대전 (A/B에 멤버를 넣으면 막대가 팀 합산 기준으로 표시)
                  </label>
                  {state.mealBattle?.teamBattleEnabled ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">A팀 이름</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            value={state.mealBattle?.teamAName || "A팀"}
                            onChange={(e) => updateMealBattle({ teamAName: e.target.value })}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">B팀 이름</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            value={state.mealBattle?.teamBName || "B팀"}
                            onChange={(e) => updateMealBattle({ teamBName: e.target.value })}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">A팀 목표 (0=자동)</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            type="number"
                            min={0}
                            value={state.mealBattle?.teamAGoal ?? 0}
                            onChange={(e) => updateMealBattle({ teamAGoal: Math.max(0, Number.parseInt(e.target.value || "0", 10) || 0) })}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">B팀 목표 (0=자동)</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            type="number"
                            min={0}
                            value={state.mealBattle?.teamBGoal ?? 0}
                            onChange={(e) => updateMealBattle({ teamBGoal: Math.max(0, Number.parseInt(e.target.value || "0", 10) || 0) })}
                          />
                        </label>
                      </div>
                      <div className="text-xs text-neutral-400">전체 멤버를 A팀·B팀·미배정 중 하나로 지정합니다. 식대전 참가자만 점수가 합산됩니다.</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto pr-1">
                        {state.members.map((m) => {
                          const inA = (state.mealBattle?.teamAMemberIds || []).includes(m.id);
                          const inB = (state.mealBattle?.teamBMemberIds || []).includes(m.id);
                          const val = inA ? "A" : inB ? "B" : "";
                          return (
                            <div key={m.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#1f1f1f] px-2 py-1.5">
                              <span className="text-sm truncate">{m.name}</span>
                              <select
                                className="text-xs px-2 py-1 rounded bg-neutral-900 border border-white/10 shrink-0"
                                value={val}
                                onChange={(e) => setMealBattleMemberTeam(m.id, e.target.value as "" | "A" | "B")}
                              >
                                <option value="">미배정</option>
                                <option value="A">{state.mealBattle?.teamAName || "A팀"}</option>
                                <option value="B">{state.mealBattle?.teamBName || "B팀"}</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2 items-end">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">말풍선 배경</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.missionBubbleBg, "#9333ea")}
                        onChange={(e) => updateMealBattle({ missionBubbleBg: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">말풍선 글자</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.missionBubbleTextColor, "#ffffff")}
                        onChange={(e) => updateMealBattle({ missionBubbleTextColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">게이지 트랙</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.gaugeTrackBg, "#171717")}
                        title="단색만 피커로 고를 수 있습니다. 알파는 아래 입력란에 hex/rgba로 입력하세요."
                        onChange={(e) => updateMealBattle({ gaugeTrackBg: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">채움 막대(개인)</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.gaugeFillColor, "#22c55e")}
                        onChange={(e) => updateMealBattle({ gaugeFillColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">A팀 막대</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.teamAColor, "#2563eb")}
                        onChange={(e) => updateMealBattle({ teamAColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">B팀 막대</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.teamBColor, "#dc2626")}
                        onChange={(e) => updateMealBattle({ teamBColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">점수·요약 글자</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.scoreTextColor, "#ffffff")}
                        onChange={(e) => updateMealBattle({ scoreTextColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">이름 태그 배경</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.nameTagBg, "#facc15")}
                        onChange={(e) => updateMealBattle({ nameTagBg: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">이름 태그 글자</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.nameTagTextColor, "#000000")}
                        onChange={(e) => updateMealBattle({ nameTagTextColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="block space-y-1">
                      <span className="text-xs text-neutral-400">신규 참가 기본 목표</span>
                      <input
                        className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                        type="number"
                        min={1}
                        value={state.mealBattle?.totalGoal || 100}
                        onChange={(e) => updateMealBattle({ totalGoal: Math.max(1, Number.parseInt(e.target.value || "100", 10) || 100) })}
                      />
                    </label>
                    <div className="space-y-2 rounded border border-white/10 bg-black/20 p-2">
                      <div className="text-[11px] text-neutral-500">오버레이 테두리 (기본 끔)</div>
                      <label className="flex items-center gap-2 text-xs text-neutral-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(state.mealBattle?.showPanelBorder)}
                          onChange={(e) => updateMealBattle({ showPanelBorder: e.target.checked })}
                        />
                        메인 패널 테두리
                      </label>
                      <label className="flex items-center gap-2 text-xs text-neutral-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(state.mealBattle?.showGaugeTrackBorder)}
                          onChange={(e) => updateMealBattle({ showGaugeTrackBorder: e.target.checked })}
                        />
                        게이지 트랙 테두리
                      </label>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="게이지 트랙 배경 (rgba/hex, 예: rgba(23,23,23,0.85))"
                    value={state.mealBattle?.gaugeTrackBg || ""}
                    onChange={(e) => updateMealBattle({ gaugeTrackBg: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="채움 막대 색 (개인 모드, rgba/hex)"
                    value={state.mealBattle?.gaugeFillColor || ""}
                    onChange={(e) => updateMealBattle({ gaugeFillColor: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="패널 테두리 색 (rgba/hex)"
                    value={state.mealBattle?.panelBorderColor || ""}
                    onChange={(e) => updateMealBattle({ panelBorderColor: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="게이지 트랙 테두리 색 (rgba/hex)"
                    value={state.mealBattle?.gaugeTrackBorderColor || ""}
                    onChange={(e) => updateMealBattle({ gaugeTrackBorderColor: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[180px_120px_1fr] gap-2 items-center">
                  <select
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    value={state.mealBattle?.timerTheme || "default"}
                    onChange={(e) => updateMealBattle({ timerTheme: e.target.value as "default" | "neon" | "minimal" | "danger" })}
                  >
                    <option value="default">타이머 테마: 기본</option>
                    <option value="neon">타이머 테마: 네온</option>
                    <option value="minimal">타이머 테마: 미니멀</option>
                    <option value="danger">타이머 테마: 경고</option>
                  </select>
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    type="number"
                    min={16}
                    max={120}
                    value={state.mealBattle?.timerSize || 36}
                    onChange={(e) =>
                      updateMealBattle({
                        timerSize: Math.max(16, Math.min(120, Number.parseInt(e.target.value || "36", 10) || 36)),
                      })
                    }
                  />
                  <div className="text-xs text-neutral-400">타이머 크기: 16~120px, 테마/사이즈는 오버레이에 실시간 반영됩니다.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm" onClick={resetMealMatchScores}>
                    점수 초기화
                  </button>
                  <span className="text-xs text-neutral-400">패널·게이지 테두리는 위 옵션을 켠 경우에만 오버레이에 표시됩니다.</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {state.members.map((m, idx) => {
                    const p = mealParticipants.find((x) => x.memberId === m.id);
                    const draft =
                      state.mealBattle?.memberGaugeColors?.[m.id] ||
                      MEAL_PARTICIPANT_COLORS[idx % MEAL_PARTICIPANT_COLORS.length];
                    const swatch = p?.color || draft;
                    const pickerVal = toColorPickerValue(typeof swatch === "string" ? swatch : "", "#60a5fa");
                    return (
                      <div
                        key={m.id}
                        className="rounded border border-white/10 bg-[#1f1f1f] px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <span className="text-sm truncate min-w-0">{m.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="color"
                            value={pickerVal}
                            title="게이지 색"
                            onChange={(e) => {
                              const c = e.target.value;
                              if (p) patchMealParticipantColor(m.id, c);
                              else mergeMealMemberGaugeColor(m.id, c);
                            }}
                            className="h-8 w-10 rounded border border-white/20 bg-transparent cursor-pointer"
                          />
                          <label className="flex items-center gap-1 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(p)}
                              onChange={(e) => toggleMealParticipant(m.id, e.target.checked)}
                            />
                            참가
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-2">
                  {mealParticipants.map((row) => (
                    <div key={row.memberId} className="rounded border border-white/10 bg-[#1f1f1f] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm">{row.name}</div>
                        <div className="text-xs text-neutral-400">
                          점수 {(Number(row.score) || 0).toLocaleString("ko-KR")} / 목표 {(Number(row.goal ?? state.mealBattle?.totalGoal ?? 100) || 100).toLocaleString("ko-KR")}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <label className="flex items-center gap-1 text-xs text-neutral-400">
                          표시 이름
                          <input
                            className="w-28 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-neutral-100"
                            value={row.name || ""}
                            onChange={(e) =>
                              updateMealParticipant(row.memberId, (p) => ({
                                ...p,
                                name: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-neutral-400">
                          개인 목표
                          <input
                            className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-right text-neutral-100"
                            type="number"
                            min={1}
                            value={row.goal ?? state.mealBattle?.totalGoal ?? 100}
                            onChange={(e) =>
                              updateMealParticipant(row.memberId, (p) => ({
                                ...p,
                                goal: Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            row.donationLinkActive ? "bg-amber-700 hover:bg-amber-600 text-white" : "bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
                          }`}
                          onClick={() =>
                            updateMealParticipant(row.memberId, (p) => {
                              const nextActive = !p.donationLinkActive;
                              return {
                                ...p,
                                donationLinkActive: nextActive,
                                donationLinkStartedAt: nextActive ? Date.now() : undefined,
                              };
                            })
                          }
                        >
                          후원 연동 {row.donationLinkActive ? "ON" : "OFF"}
                        </button>
                        <input
                          type="color"
                          value={toColorPickerValue(row.color, "#60a5fa")}
                          onChange={(e) => patchMealParticipantColor(row.memberId, e.target.value)}
                          className="h-8 w-10 rounded border border-white/20 bg-transparent"
                        />
                        <button
                          className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs"
                          onClick={() => updateMealParticipant(row.memberId, (p) => ({ ...p, score: Math.max(0, p.score + 1) }))}
                        >
                          +1
                        </button>
                        <button
                          className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs"
                          onClick={() => updateMealParticipant(row.memberId, (p) => ({ ...p, score: Math.max(0, p.score + 10) }))}
                        >
                          +10
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>오버레이 URL:</span>
                  <code className="text-neutral-300 break-all">
                    /overlay/meal-match?u={user?.id || "finalent"}&scalePct={getBattleScalePct()}&contentWidthPct=
                    {getBattleContentWidthPct()}
                  </code>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-meal-match" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                    onClick={() => {
                      const u = buildMealMatchLiveUrl();
                      void copyUrl(u, "dash-meal-match");
                    }}
                  >
                    {copiedId === "dash-meal-match" ? "복사됨!" : "URL 복사"}
                  </button>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                  <div>
                    <h4 className="text-sm font-semibold">후원 순위 오버레이 (계좌/투네 분리)</h4>
                    <p className="text-xs text-neutral-400 mt-1">
                      계좌/투네 후원 순위를 각각 표시합니다. 아래 슬라이더/컬러피커로 조정한 뒤 프리셋으로 저장할 수 있습니다.
                    </p>
                  </div>
                  <div className="rounded border border-white/10 bg-neutral-900/40 p-2 space-y-2">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                      <label className="text-[11px] text-neutral-400">
                        표시 개수
                        <div className="mt-2 rounded border border-white/10 bg-black/20 px-2 py-2 text-xs text-neutral-300">
                          전체 표시 (고정)
                        </div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        제목 폰트
                        <input
                          type="range"
                          min={14}
                          max={80}
                          value={state.donorRankingsTheme.titleSize}
                          onChange={(e) => updateDonorRankingsTheme({ titleSize: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.titleSize}px</div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        행 폰트
                        <input
                          type="range"
                          min={12}
                          max={64}
                          value={state.donorRankingsTheme.rowSize}
                          onChange={(e) => updateDonorRankingsTheme({ rowSize: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.rowSize}px</div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        순위 폰트
                        <input
                          type="range"
                          min={12}
                          max={72}
                          value={state.donorRankingsTheme.rankSize}
                          onChange={(e) => updateDonorRankingsTheme({ rankSize: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.rankSize}px</div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        오버레이 투명도(헤더·순위 목록 배경 공통, 색상은 유지)
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={state.donorRankingsTheme.overlayOpacity}
                          onChange={(e) => updateDonorRankingsTheme({ overlayOpacity: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.overlayOpacity}%</div>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                      {[
                        ["headerAccountBg", "계좌 헤더"],
                        ["headerToonBg", "투네 헤더"],
                        ["rankColor", "순위 색"],
                        ["nameColor", "닉네임 색"],
                        ["amountColor", "금액 색"],
                      ].map(([key, label]) => (
                        <label key={key} className="text-[11px] text-neutral-400 flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                          <span>{label}</span>
                          <input
                            type="color"
                            value={toColorPickerValue(String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] ?? ""), "#ffffff")}
                            onChange={(e) => updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)}
                            className="h-7 w-9 rounded border border-white/20 bg-transparent p-0.5"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {[
                        ["bg", "배경"],
                        ["panelBg", "패널 배경"],
                        ["borderColor", "테두리"],
                        ["rowEvenBg", "짝수 행"],
                        ["rowOddBg", "홀수 행"],
                        ["outlineColor", "텍스트 외곽선"],
                      ].map(([key, label]) => (
                        <label key={key} className="text-[11px] text-neutral-400 flex items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                          <span className="w-24 shrink-0">{label}</span>
                          <input
                            type="text"
                            value={String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] || "")}
                            onChange={(e) => updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)}
                            className="h-7 w-full rounded border border-white/10 bg-neutral-900/80 px-2 text-xs"
                            placeholder="transparent / #fff / rgba(...)"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      반투명/rgba 값이 필요하면 아래 URL 파라미터로 덮어쓸 수 있습니다. 기본은 관리자 저장값이 사용됩니다.
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        className="h-8 w-56 rounded border border-white/10 bg-neutral-900/80 px-2 text-xs"
                        value={donorRankingPresetName}
                        onChange={(e) => setDonorRankingPresetName(e.target.value)}
                        placeholder="프리셋 이름 (예: 방송 기본)"
                      />
                      <button type="button" className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs" onClick={saveDonorRankingsPreset}>
                        현재값 프리셋 저장
                      </button>
                    </div>
                    <div className="space-y-1">
                      {(state.donorRankingsPresets || []).length === 0 ? (
                        <p className="text-[11px] text-neutral-500">저장된 프리셋이 없습니다.</p>
                      ) : (
                        (state.donorRankingsPresets || []).map((preset) => (
                          <div key={preset.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                            <span className="text-xs text-neutral-200 truncate">{preset.name}</span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                className={`px-2 py-0.5 rounded text-xs ${state.donorRankingsPresetId === preset.id ? "bg-emerald-700" : "bg-neutral-700 hover:bg-neutral-600"}`}
                                onClick={() => applyDonorRankingsPreset(preset.id)}
                              >
                                {state.donorRankingsPresetId === preset.id ? "적용중" : "적용"}
                              </button>
                              <button
                                type="button"
                                className="px-2 py-0.5 rounded text-xs bg-red-900/80 hover:bg-red-800"
                                onClick={() => deleteDonorRankingsPreset(preset.id)}
                              >
                                삭제
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                    <span>실시간 URL:</span>
                    <code className="text-neutral-300 break-all">
                      /overlay/donor-rankings?u={user?.id || "finalent"}&zoomPct={getDonorRankingsZoomPct()}
                    </code>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl();
                        void copyUrl(u, "dash-donor-rankings");
                      }}
                    >
                      {copiedId === "dash-donor-rankings" ? "복사됨!" : "URL 복사"}
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                    <span>테스트 URL:</span>
                    <code className="text-neutral-300 break-all">
                      /overlay/donor-rankings?u={user?.id || "finalent"}&zoomPct={getDonorRankingsZoomPct()}&test=true
                    </code>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings-test" ? "bg-emerald-600" : "bg-amber-800/90 hover:bg-amber-700"}`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl({ test: true });
                        void copyUrl(u, "dash-donor-rankings-test");
                      }}
                    >
                      {copiedId === "dash-donor-rankings-test" ? "복사됨!" : "테스트 URL 복사"}
                    </button>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-xs text-neutral-300 mb-1">
                      후원 리스트 패널 배경 투명도(실시간 · 계좌/투네 헤더·목록 공통)
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={state.donorRankingsTheme.overlayOpacity}
                        onChange={(e) => updateDonorRankingsTheme({ overlayOpacity: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <div className="w-14 text-right text-xs text-neutral-200">{state.donorRankingsTheme.overlayOpacity}%</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <span>OBS 크기(%)</span>
                    <input
                      className="w-20 rounded bg-neutral-900/80 border border-white/10 px-2 py-1 text-sm text-right"
                      value={donorRankingsZoomPct}
                      onChange={(e) => setDonorRankingsZoomPct(e.target.value.replace(/[^\d]/g, ""))}
                    />
                    <span className="text-neutral-500">30~300 (기본 100)</span>
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    필요 시 URL 파라미터로 임시 오버라이드 가능: <code>top</code>, <code>test</code>, <code>zoomPct</code>, <code>overlayOpacity</code>, <code>titleSize</code>, <code>rowSize</code>, <code>rankSize</code>, <code>headerAccountBg</code>, <code>headerToonBg</code>, <code>rowEvenBg</code>, <code>rowOddBg</code>, <code>nameColor</code>, <code>amountColor</code>, <code>rankColor</code>, <code>panelBg</code>, <code>border</code>, <code>outline</code>, <code>bg</code>
                  </div>
                </div>
              </div>
              <div className="mt-3 rounded-2xl border border-fuchsia-400/35 bg-gradient-to-br from-fuchsia-950/55 via-rose-950/45 to-pink-950/40 p-4 shadow-[0_10px_36px_rgba(236,72,153,0.22)] backdrop-blur-md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-pink-100">후원 랭킹 · 배경 GIF</h4>
                    <p className="mt-1 max-w-xl text-xs text-pink-100/75">
                      후원 랭킹(<code className="text-pink-50/90">/overlay/donor-rankings</code>) 전용 배경입니다. 엑셀표 배경과 분리되어 독립 저장됩니다.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <code className="max-w-[min(100%,420px)] break-all text-[11px] text-fuchsia-100/90">
                      /overlay/donor-rankings?u={user?.id || "finalent"}&zoomPct={getDonorRankingsZoomPct()}
                    </code>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${copiedId === "dash-donor-rankings-bg" ? "bg-emerald-600" : "bg-white/15 text-pink-50 hover:bg-white/25"}`}
                        onClick={() => {
                          const u = buildDonorRankingsUrl();
                          void copyUrl(u, "dash-donor-rankings-bg");
                        }}
                      >
                        {copiedId === "dash-donor-rankings-bg" ? "복사됨!" : "URL 복사"}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-gradient-to-r from-fuchsia-600 to-pink-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:from-fuchsia-500 hover:to-pink-500"
                        onClick={() => window.open(buildDonorRankingsUrl(), "_blank", "noopener,noreferrer")}
                      >
                        오버레이 열기
                      </button>
                    </div>
                  </div>
                </div>
                {(() => {
                  const drCfg = normalizeDonorRankingsOverlayConfig(state.donorRankingsOverlayConfig);
                  const presetSelectValue = DONATION_LISTS_BG_GIF_PRESETS.some((p) => p.url && p.url === drCfg.bgGifUrl)
                    ? drCfg.bgGifUrl
                    : drCfg.bgGifUrl.trim()
                      ? "__custom__"
                      : "";
                  return (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF 프리셋
                        <select
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 shadow-inner outline-none focus:border-fuchsia-400/70"
                          value={presetSelectValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") return;
                            updateDonorRankingsOverlayConfig({
                              bgGifUrl: v,
                              isBgEnabled: Boolean(String(v || "").trim()),
                            });
                          }}
                        >
                          {DONATION_LISTS_BG_GIF_PRESETS.map((p) => (
                            <option key={p.label} value={p.url}>
                              {p.label}
                            </option>
                          ))}
                          <option value="__custom__">직접 URL 입력</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF URL (https… 또는 /public 경로)
                        <input
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 placeholder:text-pink-200/40 outline-none focus:border-fuchsia-400/70"
                          placeholder="예: https://media.giphy.com/... 또는 /images/bg/my.gif"
                          value={drCfg.bgGifUrl}
                          onChange={(e) =>
                            updateDonorRankingsOverlayConfig({
                              bgGifUrl: e.target.value,
                              isBgEnabled: Boolean(String(e.target.value || "").trim()),
                            })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90 md:col-span-2">
                        배경 투명도 ({drCfg.bgOpacity}%)
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={drCfg.bgOpacity}
                          onChange={(e) => updateDonorRankingsOverlayConfig({ bgOpacity: Number(e.target.value) })}
                          className="w-full accent-fuchsia-400"
                        />
                      </label>
                      <label className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5 md:col-span-2 cursor-pointer">
                        <span className="text-xs font-semibold text-pink-50">배경 사용</span>
                        <span className="flex items-center gap-2 text-[11px] text-pink-100/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/30 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-400"
                            checked={drCfg.isBgEnabled}
                            onChange={(e) => updateDonorRankingsOverlayConfig({ isBgEnabled: e.target.checked })}
                          />
                          ON / OFF
                        </span>
                      </label>
                    </div>
                  );
                })()}
              </div>
              <div className="mt-3 rounded-2xl border border-fuchsia-400/35 bg-gradient-to-br from-fuchsia-950/55 via-rose-950/45 to-pink-950/40 p-4 shadow-[0_10px_36px_rgba(236,72,153,0.22)] backdrop-blur-md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-pink-100">후원 엑셀표 · 배경 GIF</h4>
                    <p className="mt-1 max-w-xl text-xs text-pink-100/75">
                      멤버 랭킹 표(<code className="text-pink-50/90">/overlay/donation-lists</code>) 배경입니다. Giphy <span className="text-pink-50/90">페이지</span> 주소(
                      <code className="break-all">giphy.com/gifs/…</code>)도 오버레이에서 자동으로 직접 GIF로 바뀝니다. 저장이 막히면(콘솔 401) 로그인을 다시 하면 서버·OBS에 반영됩니다.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <code className="max-w-[min(100%,420px)] break-all text-[11px] text-fuchsia-100/90">
                      /overlay/donation-lists?u={user?.id || "finalent"}
                    </code>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${copiedId === "dash-donation-lists" ? "bg-emerald-600" : "bg-white/15 text-pink-50 hover:bg-white/25"}`}
                        onClick={() => {
                          const u = `${window.location.origin}/overlay/donation-lists?u=${user?.id || "finalent"}`;
                          void copyUrl(u, "dash-donation-lists");
                        }}
                      >
                        {copiedId === "dash-donation-lists" ? "복사됨!" : "URL 복사"}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-gradient-to-r from-fuchsia-600 to-pink-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:from-fuchsia-500 hover:to-pink-500"
                        onClick={() => window.open(`/overlay/donation-lists?u=${user?.id || "finalent"}`, "_blank", "noopener,noreferrer")}
                      >
                        오버레이 열기
                      </button>
                    </div>
                  </div>
                </div>
                {(() => {
                  const dlCfg = normalizeDonationListsOverlayConfig(state.donationListsOverlayConfig);
                  const presetSelectValue = DONATION_LISTS_BG_GIF_PRESETS.some((p) => p.url && p.url === dlCfg.bgGifUrl)
                    ? dlCfg.bgGifUrl
                    : dlCfg.bgGifUrl.trim()
                      ? "__custom__"
                      : "";
                  return (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF 프리셋
                        <select
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 shadow-inner outline-none focus:border-fuchsia-400/70"
                          value={presetSelectValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") return;
                            updateDonationListsOverlayConfig({ bgGifUrl: v, isBgEnabled: Boolean(String(v || "").trim()) });
                          }}
                        >
                          {DONATION_LISTS_BG_GIF_PRESETS.map((p) => (
                            <option key={p.label} value={p.url}>
                              {p.label}
                            </option>
                          ))}
                          <option value="__custom__">직접 URL 입력</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF URL (https… 또는 /public 경로)
                        <input
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 placeholder:text-pink-200/40 outline-none focus:border-fuchsia-400/70"
                          placeholder="https://i.giphy.com/xxxxx.gif 또는 giphy.com/gifs/… 페이지"
                          value={dlCfg.bgGifUrl}
                          onChange={(e) =>
                            updateDonationListsOverlayConfig({
                              bgGifUrl: e.target.value,
                              isBgEnabled: Boolean(String(e.target.value || "").trim()),
                            })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90 md:col-span-2">
                        배경 투명도 ({dlCfg.bgOpacity}%)
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={dlCfg.bgOpacity}
                          onChange={(e) => updateDonationListsOverlayConfig({ bgOpacity: Number(e.target.value) })}
                          className="w-full accent-fuchsia-400"
                        />
                      </label>
                      <label className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5 md:col-span-2 cursor-pointer">
                        <span className="text-xs font-semibold text-pink-50">배경 사용</span>
                        <span className="flex items-center gap-2 text-[11px] text-pink-100/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/30 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-400"
                            checked={dlCfg.isBgEnabled}
                            onChange={(e) => updateDonationListsOverlayConfig({ isBgEnabled: e.target.checked })}
                          />
                          ON / OFF
                        </span>
                      </label>
                    </div>
                  );
                })()}
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="rounded-xl border border-yellow-300/40 bg-gradient-to-r from-yellow-500/10 to-fuchsia-500/10 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-yellow-200">시그 판매 회전판 (신규)</div>
                      <div className="text-xs text-neutral-300">시네마틱 단일 플로우 관리 페이지</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-white/10 px-2 py-1 text-[11px] text-neutral-200">
                        현재 상태: {rouletteServerStatus.phase}
                      </span>
                      <Link href="/admin/sig-sales" className="rounded bg-yellow-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-yellow-400">
                        페이지 열기
                      </Link>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">시그 판매 및 회전판 추첨 관리</h3>
                    <p className="text-xs text-neutral-400">
                      회전판 당첨은 서버(<code className="text-neutral-300">/api/roulette/spin</code>)에서만 결정되어 Redis에 저장됩니다. 판매 ±는 기존과 동일하게 전체 상태로 동기화되며 후원(donors) 병합 로직과 충돌하지 않습니다.
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-amber-200/90">
                      아래 숫자는 <strong className="text-amber-100">회전 횟수이며 곧 당첨 시그 개수</strong>입니다(회전 1회당 시그 1개). 예: 5면 휠이 5번 돌아가고 시그 5개가 나옵니다. 금액 칸을 비우면 해당 회차는{" "}
                      <strong className="text-amber-100">전체 풀에서 무작위</strong>이며, 같은 버튼 한 번 안에서는{" "}
                      <strong className="text-amber-100">시그가 서로 중복되지 않습니다</strong>. 서로 다른 시그 수가 부족하면 오류가 납니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col text-[11px] text-neutral-400">
                      회전 수 (= 시그 당첨 수)
                      <input
                        type="number"
                        min={1}
                        max={999}
                        className="mt-0.5 w-24 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                        value={rouletteSpinCount}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setRouletteSpinCount(raw);
                          const nn = Math.max(1, Math.min(999, parseInt(String(raw || "5"), 10) || 5));
                          const capRows = Math.min(nn, ROULETTE_ROUND_UI_CAP);
                          setRoulettePriceRanges((prev) => {
                            const next = prev.slice(0, capRows);
                            while (next.length < capRows) next.push({ min: "", max: "" });
                            return next;
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={rouletteSpinBusy}
                      className="rounded bg-fuchsia-700 px-3 py-2 text-sm font-semibold hover:bg-fuchsia-600 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        void spinSigRoulette();
                      }}
                    >
                      {rouletteSpinBusy ? "회전 요청 중…" : "회전판 돌리기"}
                    </button>
                  </div>
                </div>
                {rouletteActionMessage ? (
                  <div className="rounded border border-fuchsia-500/35 bg-fuchsia-950/40 px-3 py-2 text-xs leading-snug text-fuchsia-50/95">
                    {rouletteActionMessage}
                  </div>
                ) : null}
                {(() => {
                  const n = Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5));
                  const rows = Math.min(n, ROULETTE_ROUND_UI_CAP);
                  return (
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
                        <span className="font-medium text-neutral-300">시그별 최소/최대 금액 (원)</span>
                        <span>
                          나올 시그 <span className="text-fuchsia-300">{n}</span>개 중 앞{" "}
                          <span className="text-fuchsia-300">{rows}</span>개까지 개별 설정 · 빈칸=해당 줄은 전체 랜덤
                          {n > ROULETTE_ROUND_UI_CAP ? (
                            <span className="text-amber-300/90">
                              {" "}
                              ({ROULETTE_ROUND_UI_CAP + 1}번째~는 {ROULETTE_ROUND_UI_CAP}번째와 동일 조건)
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                        {Array.from({ length: rows }, (_, i) => (
                          <div key={`roulette-tier-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="w-14 shrink-0 text-neutral-500">{i + 1}번째</span>
                            <input
                              className="w-28 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                              placeholder="최소(빈칸=없음)"
                              inputMode="numeric"
                              value={roulettePriceRanges[i]?.min ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, "");
                                setRoulettePriceRanges((prev) => {
                                  const cap = Math.min(
                                    Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5)),
                                    ROULETTE_ROUND_UI_CAP
                                  );
                                  const next = prev.slice(0, cap);
                                  while (next.length < cap) next.push({ min: "", max: "" });
                                  next[i] = { ...(next[i] || { min: "", max: "" }), min: v };
                                  return next;
                                });
                              }}
                            />
                            <span className="text-neutral-500">~</span>
                            <input
                              className="w-28 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                              placeholder="최대(빈칸=없음)"
                              inputMode="numeric"
                              value={roulettePriceRanges[i]?.max ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, "");
                                setRoulettePriceRanges((prev) => {
                                  const cap = Math.min(
                                    Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5)),
                                    ROULETTE_ROUND_UI_CAP
                                  );
                                  const next = prev.slice(0, cap);
                                  while (next.length < cap) next.push({ min: "", max: "" });
                                  next[i] = { ...(next[i] || { min: "", max: "" }), max: v };
                                  return next;
                                });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <div className="rounded-xl border border-sky-300/30 bg-sky-500/5 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-sky-200">회전판 빠른 점검</div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
                      <span className="rounded bg-white/10 px-2 py-1">phase: {rouletteServerStatus.phase}</span>
                      <span className="rounded bg-white/10 px-2 py-1">
                        rolling: {rouletteServerStatus.isRolling ? "예" : "아니오"}
                      </span>
                      <span className="rounded bg-white/10 px-2 py-1">당첨 시그: {rouletteServerStatus.nWin}개</span>
                      <span className="rounded bg-white/10 px-2 py-1">
                        한방(데이터): {rouletteServerStatus.hasOneShot ? "있음" : "없음"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-neutral-400">
                    <span className="rounded bg-black/25 px-2 py-1 font-mono text-neutral-200">
                      session: {rouletteServerStatus.sessionShort}
                    </span>
                    <span className="rounded bg-black/25 px-2 py-1">
                      시작 시각: {rouletteServerStatus.startedLabel}
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug text-sky-100/90">
                    방송 오버레이는 당첨 시그만 한 줄로 표시합니다(합산 한방 카드 없음). 아래쪽 인벤 롤링 보드를 같이 쓰려면 URL에{" "}
                    <code className="rounded bg-black/30 px-1 text-emerald-200">sigBoardWithResults=1</code> 를 붙이세요.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={rouletteResetBusy}
                      className="rounded bg-amber-800 px-2 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void resetRouletteIdle();
                      }}
                    >
                      {rouletteResetBusy ? "초기화 중…" : "회전판 초기화 (IDLE)"}
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs ${copiedId === "dash-sig-quick-all" ? "bg-emerald-600" : "bg-sky-700 hover:bg-sky-600"}`}
                      onClick={() => {
                        if (!rouletteQuickSummaryText.trim()) return;
                        void copyUrl(rouletteQuickSummaryText, "dash-sig-quick-all");
                      }}
                    >
                      {copiedId === "dash-sig-quick-all" ? "복사됨!" : "점검 URL 전체 복사"}
                    </button>
                    <button type="button" className="rounded bg-[#6366f1] px-2 py-1 text-xs hover:bg-[#4f46e5]" onClick={() => window.open(rouletteQuickUrls.progressPath, "_blank", "noopener,noreferrer")}>
                      통합 열기
                    </button>
                    <button type="button" className="rounded bg-fuchsia-700 px-2 py-1 text-xs hover:bg-fuchsia-600" onClick={() => window.open(rouletteQuickUrls.progressDemoPath, "_blank", "noopener,noreferrer")}>
                      통합 데모
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    점검 순서: <span className="text-neutral-200">통합 데모</span> → <span className="text-neutral-200">실제 통합</span>
                    {selectedMemberId ? (
                      <>
                        {" "}(멤버 필터는 아래 드롭다운으로 선택된 상태가 URL에 포함됩니다)
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                  <span>통합 오버레이 URL</span>
                  <span className="text-neutral-500">(메뉴 수 · 멤버)</span>
                  <span>메뉴 수</span>
                  <input
                    className="w-16 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs"
                    value={sigSalesMenuCount}
                    onChange={(e) => {
                      const n = clampSigSalesMenuCount(e.target.value);
                      const nextText = String(n);
                      setSigSalesMenuCount(nextText);
                      setState((prev) => {
                        const prevCount = clampSigSalesMenuCount(prev.rouletteState?.menuCount);
                        if (prevCount === n) return prev;
                        const next = {
                          ...prev,
                          rouletteState: {
                            ...prev.rouletteState,
                            menuCount: n,
                          },
                        };
                        persistState(next);
                        return next;
                      });
                    }}
                  />
                  <label className="ml-2 inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-neutral-300">
                    <input
                      type="checkbox"
                      checked={state.rouletteState?.menuFillFromAllActive === true}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setState((prev) => {
                          const prevVal = prev.rouletteState?.menuFillFromAllActive === true;
                          if (prevVal === checked) return prev;
                          const next = {
                            ...prev,
                            rouletteState: {
                              ...prev.rouletteState,
                              menuFillFromAllActive: checked,
                            },
                          };
                          persistState(next);
                          return next;
                        });
                      }}
                    />
                    전체 활성 시그 보충
                  </label>
                  <label className="inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-neutral-300">
                    <input
                      type="checkbox"
                      checked={state.rouletteState?.menuFillFromDemo === true}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setState((prev) => {
                          const prevVal = prev.rouletteState?.menuFillFromDemo === true;
                          if (prevVal === checked) return prev;
                          const next = {
                            ...prev,
                            rouletteState: {
                              ...prev.rouletteState,
                              menuFillFromDemo: checked,
                            },
                          };
                          persistState(next);
                          return next;
                        });
                      }}
                    />
                    데모 풀 보충
                  </label>
                  <div className="basis-full rounded border border-white/10 bg-black/20 px-3 py-2 max-w-xl">
                    <div className="text-xs text-neutral-300 mb-1">확정 결과 카드 크기 (%)</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={50}
                        max={100}
                        step={1}
                        value={clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct)}
                        onChange={(e) => {
                          const n = clampSigSalesResultScalePct(Number(e.target.value));
                          setState((prev) => {
                            const prevN = clampSigSalesResultScalePct(prev.rouletteState?.sigResultScalePct);
                            if (prevN === n) return prev;
                            const next: AppState = {
                              ...prev,
                              rouletteState: {
                                ...prev.rouletteState,
                                sigResultScalePct: n,
                              },
                            };
                            persistState(next);
                            return next;
                          });
                        }}
                        className="flex-1 min-w-[120px]"
                      />
                      <div className="w-14 text-right text-xs text-neutral-200">
                        {clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct)}%
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500 leading-snug">
                      OBS에서 결과만 과하게 크면 슬라이더를 내리세요. 저장값은 URL 없이도 오버레이에 적용되며, 필요 시{" "}
                      <code className="rounded bg-black/30 px-1 text-neutral-400">sigResultScalePct</code>로 한 번 더 덮어쓸 수
                      있습니다.
                    </p>
                  </div>
                  <span className="text-neutral-500">멤버</span>
                  <select
                    className="rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs"
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                  >
                    <option value="">전체(필터 없음)</option>
                    {(state.members || []).map((m) => (
                      <option key={`sig-progress-member-${m.id}`} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <code className="text-neutral-300 break-all">
                    /overlay/sig-sales?u={user?.id || "finalent"}&scalePct={getBattleScalePct()}&wheelScalePct=85&menuCount={getSigSalesMenuCount()}
                    {selectedMemberId ? `&memberId=${selectedMemberId}` : ""}&sigResultScalePct=
                    {clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct)}
                  </code>
                  <button
                    type="button"
                    className={`rounded px-2 py-1 text-xs shrink-0 ${copiedId === "dash-sig-sales" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                    onClick={() => {
                      const rs = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
                      const u = `${window.location.origin}/overlay/sig-sales?u=${user?.id || "finalent"}&scalePct=${getBattleScalePct()}&wheelScalePct=85&menuCount=${getSigSalesMenuCount()}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}&sigResultScalePct=${rs}`;
                      void copyUrl(u, "dash-sig-sales");
                    }}
                  >
                    {copiedId === "dash-sig-sales" ? "복사됨!" : "URL 복사"}
                  </button>
                  <button
                    type="button"
                    className="rounded bg-[#6366f1] px-2 py-1 text-xs hover:bg-[#4f46e5]"
                    onClick={() => {
                      const rs = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
                      window.open(
                        `/overlay/sig-sales?u=${user?.id || "finalent"}&scalePct=${getBattleScalePct()}&wheelScalePct=85&menuCount=${getSigSalesMenuCount()}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}&sigResultScalePct=${rs}`,
                        "_blank",
                        "noopener,noreferrer"
                      );
                    }}
                  >
                    미리보기 열기
                  </button>
                  <button
                    type="button"
                    className={`rounded px-2 py-1 text-xs shrink-0 ${copiedId === "dash-sig-sales-demo" ? "bg-emerald-600" : "bg-fuchsia-700 hover:bg-fuchsia-600"}`}
                    onClick={() => {
                      const rs = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
                      const u = `${window.location.origin}/overlay/sig-sales?u=${user?.id || "finalent"}&rouletteDemo=1&scalePct=${getBattleScalePct()}&wheelScalePct=85&menuCount=${getSigSalesMenuCount()}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}&sigResultScalePct=${rs}`;
                      void copyUrl(u, "dash-sig-sales-demo");
                    }}
                  >
                    {copiedId === "dash-sig-sales-demo" ? "복사됨!" : "데모 URL"}
                  </button>
                  <button
                    type="button"
                    className="rounded bg-fuchsia-700 px-2 py-1 text-xs hover:bg-fuchsia-600"
                    onClick={() => {
                      const rs = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
                      window.open(
                        `/overlay/sig-sales?u=${user?.id || "finalent"}&rouletteDemo=1&scalePct=${getBattleScalePct()}&wheelScalePct=85&menuCount=${getSigSalesMenuCount()}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}&sigResultScalePct=${rs}`,
                        "_blank",
                        "noopener,noreferrer"
                      );
                    }}
                  >
                    데모 열기
                  </button>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <p className="text-xs text-neutral-300">
                    회전판 실제 미리보기는 <code>/admin/sig-sales</code>에서 확인하고, 방송 장면에서는 통합 오버레이(<code>/overlay/sig-sales</code>) 한 개만 사용하세요.
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="text-xs font-semibold text-neutral-300 mb-2">판매 활성 시그 (빠른 조절)</div>
                  <div className="flex flex-col gap-2">
                    {(state.sigInventory || [])
                      .filter((x) => x.isActive)
                      .map((item) => (
                        <div key={`active-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-neutral-900/50 px-2 py-1">
                          <span className="text-sm font-medium truncate max-w-[200px]">{item.name}</span>
                          {item.maxCount <= 1 ? (
                            <span className="text-xs text-neutral-400">{item.soldCount >= 1 ? "완판" : "판매대기"}</span>
                          ) : null}
                          <div className="flex gap-1">
                            <button type="button" className="rounded bg-red-900/70 px-2 py-0.5 text-xs" onClick={() => adjustSigSoldCount(item.id, -1)}>
                              취소 -1
                            </button>
                            <button type="button" className="rounded bg-emerald-800 px-2 py-0.5 text-xs" onClick={() => adjustSigSoldCount(item.id, 1)}>
                              판매 +1
                            </button>
                          </div>
                        </div>
                      ))}
                    {(state.sigInventory || []).every((x) => !x.isActive) ? (
                      <p className="text-xs text-neutral-500">판매 활성 시그가 없습니다. 아래 목록에서 &quot;판매 활성&quot;을 켜 주세요.</p>
                    ) : null}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-neutral-300">시그판매 제외 설정 (그리드/회전판 공통)</div>
                    <button
                      type="button"
                      className="rounded bg-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-600"
                      onClick={() => {
                        setState((prev: AppState) => {
                          const next: AppState = { ...prev, sigSalesExcludedIds: [] };
                          persistState(next);
                          return next;
                        });
                      }}
                    >
                      전체 해제
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                    {(state.sigInventory || []).map((item) => {
                      const excluded = (state.sigSalesExcludedIds || []).includes(item.id);
                      return (
                        <label
                          key={`exclude-sig-sales-${item.id}`}
                          className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1 text-xs ${
                            excluded ? "border-rose-500/40 bg-rose-950/35 text-rose-100" : "border-white/10 bg-neutral-900/40 text-neutral-200"
                          }`}
                        >
                          <span className="truncate pr-2">{item.name}</span>
                          <input
                            type="checkbox"
                            checked={excluded}
                            onChange={(e) => toggleSigSalesExcluded(item.id, e.target.checked)}
                            className="h-4 w-4"
                          />
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    체크된 시그는 <code>/overlay/sig-sales</code> 화면 표시와 <code>/api/roulette/spin</code> 추첨 후보에서 제외됩니다.
                  </p>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">시그 판매 관리</h3>
                    <p className="text-xs text-neutral-400">
                      인벤토리에서 이번 방송 노출 시그를 선택하고 판매량을 실시간 조정합니다. 방송은 위 회전판 오버레이 URL(
                      <code>/overlay/sig-sales</code>)만 쓰면 되며, 「보드 노출」로
                      체크된 시그가 있으면 그 롤링 보드가 같은 화면 상단에 자동으로 붙습니다. 회전판만 보이게 하려면 URL에{" "}
                      <code className="text-neutral-300">hideSigBoard=1</code>만 추가하면 됩니다.
                    </p>
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/25 p-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-300">멤버별 판매 프리셋</span>
                  <select
                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    value={sigPresetMemberId}
                    onChange={(e) => setSigPresetMemberId(e.target.value)}
                  >
                    {state.members.map((m) => (
                      <option key={`sig-preset-${m.id}`} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-sky-800 hover:bg-sky-700 text-xs"
                    onClick={() => saveSigSalesPresetForMember(sigPresetMemberId)}
                  >
                    현재 설정 저장
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs"
                    onClick={() => applySigSalesPresetForMember(sigPresetMemberId)}
                  >
                    프리셋 적용
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-violet-800 hover:bg-violet-700 text-xs"
                    onClick={applyNextSigSalesPresetMember}
                  >
                    다음 멤버 적용
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs"
                    onClick={() => clearSigSalesPresetForMember(sigPresetMemberId)}
                  >
                    프리셋 삭제
                  </button>
                  <span className="text-[11px] text-neutral-500">
                    저장: 선택 멤버 시그의 현재 판매 활성 상태 / 적용: 해당 멤버 시그만 판매 활성
                  </span>
                </div>
                <div className="rounded border border-white/10 bg-black/25 p-2 flex flex-wrap items-center gap-2">
                  <button
                    className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-sm"
                    onClick={downloadSigExcelTemplate}
                  >
                    기본 엑셀 폼 다운로드
                  </button>
                  <label className="px-3 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-sm cursor-pointer">
                    엑셀 업로드
                    <input
                      className="hidden"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        uploadSigExcel(e.target.files?.[0] || null);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    className="px-3 py-1 rounded bg-red-900/80 hover:bg-red-800 text-sm"
                    onClick={clearAllSigItems}
                  >
                    전체 지우기
                  </button>
                  {sigExcelResult ? <span className="text-xs text-neutral-300">{sigExcelResult}</span> : null}
                </div>
                <div className="rounded border border-white/10 bg-black/25 p-2 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2 items-center">
                  <div className="text-xs text-neutral-300">판매 완료 오버레이 이미지</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs min-w-[240px]"
                      placeholder="이미지 URL 또는 경로 (gif/png/jpg)"
                      value={state.sigSoldOutStampUrl || ""}
                      onChange={(e) => updateSigSoldOutStampUrl(e.target.value)}
                    />
                    <input
                      className="text-xs"
                      type="file"
                      accept=".gif,.png,.jpg,.jpeg,image/gif,image/png,image/jpeg"
                      onChange={(e) => uploadSigSoldOutStampImage(e.target.files?.[0] || null)}
                    />
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                      onClick={() => updateSigSoldOutStampUrl("")}
                    >
                      기본 도장 사용
                    </button>
                  </div>
                  <div className="text-[11px] text-neutral-500">완판 시 시그 이미지 정중앙에 겹쳐 표시됩니다.</div>
                  <div className="flex items-center gap-2">
                    <div className="relative h-14 w-14 overflow-hidden rounded border border-white/10 bg-black/30">
                      <Image src={state.sigSoldOutStampUrl || DEFAULT_SIG_SOLD_STAMP_URL} alt="완판 오버레이 미리보기" fill unoptimized className="object-contain" />
                    </div>
                    <span className="text-xs text-neutral-400">{state.sigSoldOutStampUrl ? "커스텀 이미지 사용 중" : "기본 도장 사용 중"}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="rounded border border-white/10 bg-black/25 p-2 grid grid-cols-1 md:grid-cols-[1fr_120px_1fr_1fr_auto] gap-2">
                    <input
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                      placeholder="신규 시그 이름"
                      value={newSigName}
                      onChange={(e) => setNewSigName(e.target.value)}
                    />
                    <input
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                      type="number"
                      min={0}
                      placeholder="가격"
                      value={newSigPrice}
                      onChange={(e) => setNewSigPrice(e.target.value)}
                    />
                    <select
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                      value={newSigMemberId}
                      onChange={(e) => setNewSigMemberId(e.target.value)}
                    >
                      <option value="">공통(전체 멤버)</option>
                      {state.members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <div className="flex flex-col gap-1">
                      <input
                        className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                        placeholder="이미지 URL 또는 경로"
                        value={newSigImageUrl}
                        onChange={(e) => setNewSigImageUrl(e.target.value)}
                      />
                      <input
                        className="text-xs"
                        type="file"
                        accept=".gif,.png,.jpg,.jpeg,image/gif,image/png,image/jpeg"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          uploadNewSigImage(file);
                        }}
                      />
                    </div>
                    <button
                      className="px-3 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={addSigItem}
                      disabled={newSigImageUploading}
                    >
                      {newSigImageUploading ? "이미지 업로드 중..." : "시그 추가"}
                    </button>
                  </div>
                  {(newSigPreviewUrl || newSigImageUrl) ? (
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <div className="text-[11px] text-neutral-400 mb-2">신규 시그 이미지 미리보기</div>
                      <div className="relative h-20 w-20 overflow-hidden rounded border border-white/10 bg-black/30">
                        <Image
                          src={newSigPreviewUrl || resolveSigPreviewSrc(newSigImageUrl)}
                          alt="신규 시그 미리보기"
                          fill
                          unoptimized
                          sizes="80px"
                          className="object-cover"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                            e.currentTarget.src = SIG_DUMMY_IMAGE;
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className={`rounded border px-3 py-2 ${sigImageUrlIssues.length > 0 ? "border-rose-400/40 bg-rose-900/20" : "border-emerald-400/30 bg-emerald-900/20"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">
                        시그 이미지 URL 자동 탐지
                      </div>
                      <div className={`text-xs ${sigImageUrlIssues.length > 0 ? "text-rose-200" : "text-emerald-200"}`}>
                        {sigImageUrlIssues.length > 0 ? `문제 ${sigImageUrlIssues.length}건` : "문제 없음"}
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-neutral-300">
                      /uploads 경로, 깨진 URL, 빈 URL을 자동 감지합니다.
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded bg-black/35 px-2 py-1 text-neutral-200">legacy /uploads: {legacyUploadsCount}</span>
                      <span className="rounded bg-black/35 px-2 py-1 text-neutral-200">깨진 URL: {brokenImageUrlCount}</span>
                      <span className="rounded bg-black/35 px-2 py-1 text-neutral-200">빈 URL: {emptyImageUrlCount}</span>
                    </div>
                    {sigImageUrlIssues.length > 0 ? (
                      <div className="mt-2 max-h-28 overflow-auto rounded border border-white/10 bg-black/30 p-2 text-[11px] text-rose-100">
                        {sigImageUrlIssues.map((issue) => (
                          <div key={`sig-url-issue-${issue.id}`} className="mb-1 last:mb-0">
                            <span className="font-semibold">{issue.name}</span>
                            {" · "}
                            {issue.isLegacyUploads ? "[legacy /uploads] " : ""}
                            {issue.isBroken ? "[깨진 URL] " : ""}
                            {issue.isEmpty ? "[빈 URL] " : ""}
                            <span className="text-rose-200/80">{issue.raw || "(empty)"}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {(state.sigInventory || []).map((item) => {
                    const isOneShot = item.id === ONE_SHOT_SIG_ID;
                    const hasLegacyLocalUrl = isLegacyLocalSigImageUrl(item.imageUrl);
                    const hasBrokenUrl = isBrokenSigImageUrl(item.imageUrl);
                    return (
                    <div key={item.id} className="rounded border border-white/10 bg-[#1f1f1f] px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                        <div className="flex flex-wrap items-center gap-3 text-sm">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(item.isRolling)}
                              onChange={(e) => toggleSigRollingItem(item.id, e.target.checked)}
                            />
                            <span>보드 노출</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={Boolean(item.isActive)}
                              onChange={(e) => toggleSigActiveItem(item.id, e.target.checked)}
                            />
                            <span>판매 활성</span>
                          </label>
                          <span className="font-semibold">{item.name}</span>
                        </div>
                        <div className="text-xs text-neutral-400">가격 {item.price.toLocaleString("ko-KR")}</div>
                        <div className="flex items-center gap-1">
                          {item.maxCount <= 1 && item.soldCount >= 1 ? (
                            <Image
                              src={state.sigSoldOutStampUrl || DEFAULT_SIG_SOLD_STAMP_URL}
                              alt="완판 도장"
                              width={28}
                              height={28}
                              unoptimized
                              className="h-7 w-7 object-contain opacity-90"
                            />
                          ) : null}
                          {!isOneShot && (
                            <>
                              <button className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs" onClick={() => adjustSigSoldCount(item.id, -1)}>취소 -1</button>
                              <button className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs" onClick={() => adjustSigSoldCount(item.id, 1)}>판매 +1</button>
                              <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs" onClick={() => removeSigItem(item.id)}>삭제</button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_1fr_1.3fr] gap-2">
                        <input
                          className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          value={item.name}
                          disabled={isOneShot}
                          onChange={(e) => updateSigItem(item.id, { name: e.target.value })}
                        />
                        <input
                          className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          type="number"
                          min={0}
                          value={item.price}
                          disabled={isOneShot}
                          onChange={(e) => updateSigItem(item.id, { price: Math.max(0, Math.floor(Number(e.target.value || 0) || 0)) })}
                        />
                        <select
                          className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          value={item.memberId || ""}
                          disabled={isOneShot}
                          onChange={(e) => updateSigItem(item.id, { memberId: e.target.value })}
                        >
                          <option value="">공통(전체 멤버)</option>
                          {state.members.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <div className="flex flex-col gap-1">
                          <input
                            className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                            placeholder="이미지 URL 또는 경로"
                            value={item.imageUrl || ""}
                            onChange={(e) => updateSigItem(item.id, { imageUrl: e.target.value })}
                          />
                          <input
                            className="text-xs"
                            type="file"
                            accept=".gif,.png,.jpg,.jpeg,image/gif,image/png,image/jpeg"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              uploadSigImage(item.id, file);
                            }}
                          />
                        </div>
                      </div>
                      {(sigPreviewMap[item.id] || item.imageUrl) ? (
                        <div className="mt-2 flex items-start gap-2">
                          <div className="relative h-16 w-16 overflow-hidden rounded border border-white/10 bg-black/30">
                            <Image
                              src={sigPreviewMap[item.id] || resolveSigPreviewSrc(item.imageUrl)}
                              alt={`${item.name} 미리보기`}
                              fill
                              unoptimized
                              sizes="64px"
                              className="object-cover"
                              onError={(e) => {
                                e.currentTarget.onerror = null;
                                e.currentTarget.src = SIG_DUMMY_IMAGE;
                              }}
                            />
                          </div>
                          <div className="text-xs text-neutral-400 break-all">
                            이미지 설정됨: {item.imageUrl.startsWith("data:image/") ? "업로드 이미지(data URL)" : item.imageUrl}
                            {hasLegacyLocalUrl ? (
                              <div className="mt-1 text-rose-300">
                                경고: 구형 /uploads 경로입니다. 운영 환경에서 404가 날 수 있어 재업로드가 필요합니다.
                              </div>
                            ) : null}
                            {hasBrokenUrl ? (
                              <div className="mt-1 text-rose-300">
                                경고: 이미지 URL이 손상되었습니다. 파일을 다시 업로드해 주세요.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {isOneShot ? (
                        <div className="mt-2 text-[11px] text-fuchsia-300">
                          한방 시그 금액은 나온 시그 합계(판매량×가격)로 자동 계산됩니다.
                        </div>
                      ) : null}
                    </div>
                  );
                  })}
                </div>
                <div className="text-xs text-neutral-500">
                  「보드 노출」은 <code>/overlay/sig-sales</code> 상단 롤링 그리드,「판매 활성」은 회전판 메뉴 후보에 포함됩니다. 시그 추가/멤버 지정/판매량 조절은 즉시 `/api/state`를 통해 Redis에 반영됩니다.
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div>
                  <h3 className="text-base font-semibold">타이머 제어</h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    일반 타이머 하나만 사용합니다. 오버레이에서 숨기려면 &quot;오버레이 사용&quot;을 끄세요. (제어 버튼은 그대로 사용 가능)
                  </p>
                </div>
                {([{ key: "generalTimer", flag: "general" as const, label: "일반 타이머" }] as const).map((timerDef) => {
                  const timer = state[timerDef.key];
                  const timerStyle = state.timerDisplayStyles?.[timerDef.flag] || {
                    showHours: false,
                    fontColor: "",
                    bgColor: "",
                    borderColor: "",
                    outlineColor: "",
                    outlineWidth: 0.8,
                    bgOpacity: 40,
                    scalePercent: 100,
                  };
                  const effective = getEffectiveRemainingTime(timer, timerUiNow);
                  const mm = Math.floor(effective / 60);
                  const ss = effective % 60;
                  const overlayOn = state.matchTimerEnabled?.[timerDef.flag] !== false;
                  const timerOnlyUrl = `/overlay?u=${user?.id || "finalent"}&timerType=${timerDef.flag}`;
                  return (
                    <div key={timerDef.key} className="rounded border border-white/10 bg-[#1f1f1f] px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold">{timerDef.label}</div>
                          <div className="text-xs text-neutral-400">
                            남은 시간 {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
                          </div>
                          <label className="mt-1 flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={overlayOn}
                              onChange={() => updateMatchTimerEnabled({ [timerDef.flag]: !overlayOn })}
                            />
                            오버레이 사용
                          </label>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            className={`px-2 py-1 rounded text-xs ${timer.isActive ? "bg-amber-700 hover:bg-amber-600" : "bg-emerald-700 hover:bg-emerald-600"}`}
                            onClick={() =>
                              updateMatchTimer(timerDef.key, (t) => (t.isActive ? pauseTimer(t) : resumeTimer(t)))
                            }
                          >
                            {timer.isActive ? "⏸ 일시정지" : "▶ 시작"}
                          </button>
                          <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs" onClick={() => adjustTimerSeconds(timerDef.key, -60)}>-1분</button>
                          <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs" onClick={() => adjustTimerSeconds(timerDef.key, +60)}>+1분</button>
                          <button className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs" onClick={() => adjustTimerSeconds(timerDef.key, +10)}>+10초</button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-neutral-400">분 설정</span>
                        <input
                          className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          inputMode="numeric"
                          value={timerMinuteInputs[timerDef.key]}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^\d]/g, "");
                            setTimerMinuteInputs((prev) => ({ ...prev, [timerDef.key]: raw }));
                          }}
                        />
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs"
                          onClick={() => {
                            const mins = parseInt(timerMinuteInputs[timerDef.key] || "0", 10);
                            setTimerMinutes(timerDef.key, Number.isFinite(mins) ? mins : 0);
                          }}
                        >
                          분으로 설정
                        </button>
                      </div>
                      {timerDef.flag === "general" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                          <span>일반 타이머 오버레이:</span>
                          <code className="text-neutral-300 break-all">{timerOnlyUrl}</code>
                          <button
                            type="button"
                            className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-general-timer" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                            onClick={() => {
                              const u = `${window.location.origin}${timerOnlyUrl}`;
                              void copyUrl(u, "dash-general-timer");
                            }}
                          >
                            {copiedId === "dash-general-timer" ? "복사됨!" : "URL 복사"}
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white"
                            onClick={() => window.open(timerOnlyUrl, "_blank", "noopener,noreferrer")}
                          >
                            오버레이 열기
                          </button>
                        </div>
                      )}
                      <div className="mt-3 border-t border-white/10 pt-2 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-2">
                        <label className="text-xs text-neutral-400">표시 형식</label>
                        <button
                          type="button"
                          className={`w-fit px-2 py-1 rounded border text-xs ${timerStyle.showHours ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`}
                          onClick={() => updateTimerDisplayStyle(timerDef.flag, { showHours: !timerStyle.showHours })}
                        >
                          시:분:초 {timerStyle.showHours ? "ON" : "OFF"} (OFF=분:초)
                        </button>
                        <label className="text-xs text-neutral-400">글자 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(String(timerStyle.fontColor ?? ""), "#ffffff")}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { fontColor: e.target.value })}
                          />
                          <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updateTimerDisplayStyle(timerDef.flag, { fontColor: "" })}>기본</button>
                        </div>
                        <label className="text-xs text-neutral-400">배경 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(String(timerStyle.bgColor ?? ""), "#ffffff")}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { bgColor: e.target.value })}
                          />
                          <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updateTimerDisplayStyle(timerDef.flag, { bgColor: "" })}>기본</button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                            onClick={() => updateTimerDisplayStyle(timerDef.flag, { bgColor: "transparent", borderColor: "transparent", bgOpacity: 0 })}
                          >
                            배경 없음
                          </button>
                        </div>
                        <label className="text-xs text-neutral-400">테두리 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(String(timerStyle.borderColor ?? ""), "#ffffff")}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { borderColor: e.target.value })}
                          />
                          <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updateTimerDisplayStyle(timerDef.flag, { borderColor: "" })}>기본</button>
                        </div>
                        <label className="text-xs text-neutral-400">글자 외곽선 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(String(timerStyle.outlineColor ?? ""), "#000000")}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { outlineColor: e.target.value })}
                          />
                          <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updateTimerDisplayStyle(timerDef.flag, { outlineColor: "" })}>기본</button>
                        </div>
                        <label className="text-xs text-neutral-400">글자 외곽선 두께</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="3"
                            step="0.1"
                            value={String(timerStyle.outlineWidth ?? 0.8)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                outlineWidth: Math.max(0, Math.min(3, parseFloat(e.target.value || "0.8") || 0.8)),
                              })
                            }
                            className="flex-1 accent-violet-500"
                          />
                          <input
                            className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                            value={String(timerStyle.outlineWidth ?? 0.8)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                outlineWidth: Math.max(0, Math.min(3, parseFloat(e.target.value.replace(/[^\d.]/g, "") || "0.8") || 0.8)),
                              })
                            }
                          />
                          <span className="text-xs text-neutral-500">px</span>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                            onClick={() => updateTimerDisplayStyle(timerDef.flag, { outlineWidth: 0.8 })}
                          >
                            기본
                          </button>
                        </div>
                        <label className="text-xs text-neutral-400">배경 투명도</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={String(timerStyle.bgOpacity ?? 40)}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { bgOpacity: Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10) || 0)) })}
                            className="flex-1 accent-emerald-500"
                          />
                          <input
                            className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                            value={String(timerStyle.bgOpacity ?? 40)}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { bgOpacity: Math.max(0, Math.min(100, parseInt(e.target.value.replace(/[^\d]/g, "") || "0", 10) || 0)) })}
                          />
                          <span className="text-xs text-neutral-500">%</span>
                        </div>
                        <label className="text-xs text-neutral-400">타이머 크기</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="50"
                            max="250"
                            value={String(timerStyle.scalePercent ?? 100)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                scalePercent: Math.max(50, Math.min(250, parseInt(e.target.value || "100", 10) || 100)),
                              })
                            }
                            className="flex-1 accent-fuchsia-500"
                          />
                          <input
                            className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                            value={String(timerStyle.scalePercent ?? 100)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                scalePercent: Math.max(50, Math.min(250, parseInt(e.target.value.replace(/[^\d]/g, "") || "100", 10) || 100)),
                              })
                            }
                          />
                          <span className="text-xs text-neutral-500">%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            )}

            {isAdminNavSectionVisible("donor") && (
            <>
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
                  placeholder="입금액 (예: 35000)"
                  inputMode="numeric"
                  value={donorAmount}
                  onChange={(e) => setDonorAmount(e.target.value)}
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

            <section id="contribution-management" className={`${panelCardClass} p-4 md:p-6`}>
              <h2 className="text-lg font-semibold mb-3">기여도 기록부</h2>
              <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto_auto_auto] gap-3">
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={contributionDelta > 0 ? "plus" : "minus"}
                  onChange={(e) => setContributionDelta(e.target.value === "minus" ? -1 : 1)}
                >
                  <option value="plus">추가(+)</option>
                  <option value="minus">차감(-)</option>
                </select>
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="금액 (예: 35000)"
                  inputMode="numeric"
                  value={contributionAmount}
                  onChange={(e) => setContributionAmount(e.target.value)}
                />
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={contributionMemberId || ""}
                  onChange={(e) => setContributionMemberId(e.target.value)}
                >
                  {state.members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="메모(선택)"
                  value={contributionNote}
                  onChange={(e) => setContributionNote(e.target.value)}
                />
                <button
                  className={`px-4 py-2 rounded font-semibold ${contributionDelta > 0 ? "bg-cyan-600 hover:bg-cyan-500" : "bg-rose-600 hover:bg-rose-500"}`}
                  onClick={addContribution}
                >
                  기여도 반영
                </button>
              </div>
              <div className="text-sm text-neutral-400 mt-2">후원 입력과 동일하게 건별 로그를 남기며, 로그에서 되돌리기/삭제할 수 있습니다.</div>
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
                            <td className="p-1 text-right whitespace-nowrap">{formatWonFull(d.amount)}</td>
                            <td className="p-1 text-right">
                              <button
                                className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                                onClick={() => {
                                  requestConfirm("후원 기록 삭제", "해당 후원 기록을 삭제할까요?", () => {
                                    setState((prev: AppState) => {
                                      const syncMode = prev.donationSyncMode || "mealBattle";
                                      const donors = prev.donors.filter((x) => x.id !== d.id);
                                      const field = (d.target || "account") === "toon" ? "toon" : "account";
                                      const members = prev.members.map((mm: Member) =>
                                        mm.id === d.memberId ? { ...mm, [field]: Math.max(0, (mm[field] || 0) - d.amount) } : mm
                                      );
                                      const mealParticipants =
                                        syncMode === "mealBattle"
                                          ? applyMealBattleDonationToParticipants(
                                              prev.mealBattle?.participants || [],
                                              d.memberId,
                                              d.amount,
                                              -1,
                                              d.at
                                            )
                                          : (prev.mealBattle?.participants || []);
                                      const next: AppState = {
                                        ...prev,
                                        donors,
                                        members,
                                        mealBattle: { ...prev.mealBattle, participants: mealParticipants },
                                      };
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
              <h2 className="text-lg font-semibold mb-3">기여도 로그</h2>
              <div className="max-h-[260px] overflow-auto pr-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="text-left font-medium p-1">시간</th>
                      <th className="text-left font-medium p-1">멤버</th>
                      <th className="text-left font-medium p-1">구분</th>
                      <th className="text-right font-medium p-1">금액</th>
                      <th className="text-left font-medium p-1">메모</th>
                      <th className="text-right font-medium p-1 w-28">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(state.contributionLogs || [])
                      .slice()
                      .sort((a, b) => b.at - a.at)
                      .map((log) => {
                        const member = state.members.find((m) => m.id === log.memberId);
                        return (
                          <tr key={log.id} className="border-t border-white/10">
                            <td className="p-1 text-neutral-400"><ClientTime ts={log.at} /></td>
                            <td className="p-1 text-neutral-300">{member?.name || log.memberId}</td>
                            <td className="p-1">{log.delta > 0 ? <span className="text-cyan-300">추가</span> : <span className="text-rose-300">차감</span>}</td>
                            <td className="p-1 text-right whitespace-nowrap">{formatWonFull(log.amount)}</td>
                            <td className="p-1 text-neutral-400">{log.note || "-"}</td>
                            <td className="p-1 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs"
                                  onClick={() => {
                                    requestConfirm("기여도 로그 되돌리기", "이 기록을 되돌리고 로그에서 제거할까요?", () => {
                                      setState((prev: AppState) => {
                                        const members = prev.members.map((m: Member) => {
                                          if (m.id !== log.memberId) return m;
                                          const curr = Math.max(0, m.contribution || 0);
                                          const nextContribution = log.delta > 0
                                            ? Math.max(0, curr - log.amount)
                                            : curr + log.amount;
                                          return { ...m, contribution: nextContribution };
                                        });
                                        const next: AppState = {
                                          ...prev,
                                          members,
                                          contributionLogs: (prev.contributionLogs || []).filter((x) => x.id !== log.id),
                                        };
                                        persistState(next);
                                        return next;
                                      });
                                    }, { confirmText: "되돌리기", danger: true });
                                  }}
                                >
                                  되돌리기
                                </button>
                                <button
                                  className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                  onClick={() => {
                                    requestConfirm("기여도 로그 삭제", "값 변화 없이 로그만 삭제할까요?", () => {
                                      setState((prev: AppState) => {
                                        const next: AppState = {
                                          ...prev,
                                          contributionLogs: (prev.contributionLogs || []).filter((x) => x.id !== log.id),
                                        };
                                        persistState(next);
                                        return next;
                                      });
                                    }, { confirmText: "삭제", danger: true });
                                  }}
                                >
                                  삭제
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {(state.contributionLogs || []).length === 0 && (
                      <tr><td className="p-2 text-neutral-400" colSpan={6}>기록이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
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
                        <td className="p-1 text-right whitespace-nowrap text-emerald-300">{formatWonFull(row.account)}</td>
                        <td className="p-1 text-right whitespace-nowrap text-amber-300">{formatWonFull(row.toon)}</td>
                        <td className="p-1 text-right whitespace-nowrap font-semibold">{formatWonFull(row.total)}</td>
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
                <div className="flex items-center gap-2">
                  <button
                    className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs disabled:opacity-50"
                    disabled={missionRestoreLoading}
                    onClick={async () => {
                      setMissionRestoreLoading(true);
                      try {
                        const backup = loadMissionsBackup(user?.id);
                        if (backup && backup.length > 0) {
                          setState((prev) => {
                            const next = { ...prev, missions: backup };
                            persistState(next);
                            return next;
                          });
                          return;
                        }
                        const apiState = await loadStateFromApi(user?.id);
                        if (!apiState || !Array.isArray(apiState.missions) || apiState.missions.length === 0) {
                          alert("서버에 저장된 미션 데이터가 없습니다.");
                          return;
                        }
                        setState((prev) => {
                          const next = { ...prev, missions: apiState.missions! };
                          persistState(next);
                          return next;
                        });
                      } finally {
                        setMissionRestoreLoading(false);
                      }
                    }}
                    title="실수로 초기화했을 경우 서버에 저장된 미션을 복구합니다"
                  >
                    {missionRestoreLoading ? "불러오는 중..." : "서버에서 불러오기"}
                  </button>
                  <button
                    className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs"
                    onClick={() => {
                      requestConfirm("미션 전광판 초기화", "계정에 저장된 모든 미션을 삭제할까요? (서버에서 불러오기로 복구 가능)", () => {
                        setState((prev) => {
                          if ((prev.missions || []).length > 0) {
                            saveMissionsBackup(prev.missions || [], user?.id);
                          }
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
            </>
            )}

            {isAdminNavSectionVisible("overlay") && (
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
              <p className="text-xs text-neutral-500 mb-3">
                복사되는 URL은 <span className="text-neutral-300">서버(Redis)에 저장된 최신 상태</span>를 실시간으로 불러옵니다. 아래 프레임 미리보기만 편집 시점 스냅샷을 쓸 수 있습니다.
                위치/크기는 Prism에서 조정하세요. 세로 방송이면 브라우저 소스를 1080×1920에 맞추면 됩니다.
              </p>
              <div className="mb-3 rounded border border-white/10 bg-black/20 p-2 text-xs text-neutral-400 flex flex-wrap items-center gap-2">
                <span>후원 리스트 오버레이:</span>
                <code className="text-neutral-300 break-all">/overlay/donor-rankings?u={user?.id || "finalent"}&zoomPct={getDonorRankingsZoomPct()}</code>
                <button
                  type="button"
                  className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings-inline" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                  onClick={() => {
                    const u = buildDonorRankingsUrl();
                    void copyUrl(u, "dash-donor-rankings-inline");
                  }}
                >
                  {copiedId === "dash-donor-rankings-inline" ? "복사됨!" : "URL 복사"}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white"
                  onClick={() => window.open(buildDonorRankingsUrl(), "_blank", "noopener,noreferrer")}
                >
                  오버레이 열기
                </button>
              </div>
              <div className="mb-3 rounded border border-white/10 bg-black/20 px-3 py-2">
                <div className="text-xs text-neutral-300 mb-1">후원 리스트 배경 투명도(실시간 · 헤더·목록)</div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={state.donorRankingsTheme.overlayOpacity}
                    onChange={(e) => updateDonorRankingsTheme({ overlayOpacity: Number(e.target.value) })}
                    className="flex-1"
                  />
                  <div className="w-14 text-right text-xs text-neutral-200">{state.donorRankingsTheme.overlayOpacity}%</div>
                </div>
              </div>
              <div className="mb-3 rounded-lg border border-white/10 bg-black/30 overflow-hidden">
                <div className="flex items-center justify-between border-b border-white/5 px-2 py-1.5">
                  <span className="text-xs font-medium text-neutral-300">후원 리스트 오버레이 미리보기</span>
                  <button
                    type="button"
                    className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                    onClick={() => setDonorRankingsPreviewIframeKey((k) => k + 1)}
                  >
                    새로고침
                  </button>
                </div>
                <div className="relative w-full bg-black/40" style={{ minHeight: "260px", aspectRatio: "16 / 9" }}>
                  <iframe
                    key={`donor-rankings-${donorRankingsPreviewIframeKey}-${user?.id || "finalent"}`}
                    src={`/overlay/donor-rankings?u=${user?.id || "finalent"}&zoomPct=${getDonorRankingsZoomPct()}`}
                    title="후원 리스트 오버레이 미리보기"
                    className="absolute inset-0 h-full w-full border-0"
                    style={{ background: "transparent" }}
                  />
                </div>
              </div>
              {presets.length === 0 && (
                <div className="text-sm text-neutral-400 p-6 text-center border border-dashed border-white/10 rounded">아직 오버레이가 없습니다. 위 버튼으로 추가하세요.</div>
              )}
              <div className="space-y-3">
                {presets.map((p) => {
                  const url = buildPrismOverlayUrl(p, !!p.vertical);
                  const demoUrl = buildPrismDemoOverlayUrl(p, !!p.vertical);
                  const previewUrl = buildStablePreviewUrl(p);
                  const scaleNum = Math.max(0.5, Math.min(4, Number.parseFloat(p.scale || "1") || 1));
                  const scalePct = Math.round(scaleNum * 100);
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
                        <button className={`px-2 py-1 rounded text-xs ${copiedId === `${p.id}-demo` ? "bg-emerald-600" : "bg-fuchsia-700 hover:bg-fuchsia-600"}`} onClick={(e) => { e.stopPropagation(); copyUrl(demoUrl, `${p.id}-demo`); }}>{copiedId === `${p.id}-demo` ? "복사됨!" : "데모 URL"}</button>
                        <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={(e) => { e.stopPropagation(); window.open(demoUrl, "_blank", "noopener,noreferrer"); }}>데모 열기</button>
                        <button className="px-2 py-1 rounded bg-[#ef4444] hover:bg-[#dc2626] text-xs text-white" onClick={(e) => { e.stopPropagation(); removePreset(p.id); }}>삭제</button>
                        <div
                          className="basis-full rounded border border-white/10 bg-black/20 px-2 py-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-400">
                            <span>엑셀표 스케일(빠른 조절)</span>
                            <span className="text-neutral-200">{scalePct}%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="50"
                              max="400"
                              step="1"
                              value={String(scalePct)}
                              onChange={(e) => {
                                const n = Math.max(50, Math.min(400, parseInt(e.target.value || "100", 10) || 100));
                                updatePreset(p.id, { scale: String(n / 100) });
                              }}
                              className="flex-1 accent-emerald-500"
                            />
                            <input
                              className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-[11px] text-right"
                              value={String(scalePct)}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d]/g, "");
                                const n = Math.max(50, Math.min(400, parseInt(raw || "100", 10) || 100));
                                updatePreset(p.id, { scale: String(n / 100) });
                              }}
                            />
                            <span className="text-[11px] text-neutral-500">%</span>
                          </div>
                        </div>
                      </div>
                      {isOpen && (
                        <div className={`px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-3 border-t border-white/10 pt-3 ${simpleMode ? "hidden" : ""}`}>
                          <div className="space-y-2 lg:order-2">
                            <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                              <label className="text-xs text-neutral-400">테마</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.theme} onChange={(e) => updatePreset(p.id, { theme: e.target.value })}>
                                <option value="default">기본(핑크 그라데이션)</option>
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
                                    <option value="default">기본(핑크 그라데이션)</option>
                                  </select>
                                  {/* Palette view removed; keep compact select */}
                                  <label className="text-xs text-neutral-400">표 배경 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="0" max="100" value={p.tableBgOpacity || "100"} onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value })} className="flex-1 accent-emerald-500" />
                                    <input className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right" value={p.tableBgOpacity || "100"} onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value.replace(/[^\\d]/g, "") })} />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">엑셀표 배경 GIF URL</label>
                                  <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                                    <input
                                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                      placeholder="예: https://media.giphy.com/.../giphy.gif"
                                      value={p.tableBgGifUrl || ""}
                                      onChange={(e) => updatePreset(p.id, { tableBgGifUrl: e.target.value })}
                                    />
                                    <label className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white cursor-pointer text-center">
                                      GIF 업로드
                                      <input
                                        type="file"
                                        accept=".gif,image/gif"
                                        className="hidden"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0] || null;
                                          uploadTableBgGifImage(p.id, file);
                                          e.currentTarget.value = "";
                                        }}
                                      />
                                    </label>
                                  </div>
                                  <label className="text-xs text-neutral-400">GIF 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={p.tableBgGifOpacity || "45"}
                                      onChange={(e) => updatePreset(p.id, { tableBgGifOpacity: e.target.value })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      value={p.tableBgGifOpacity || "45"}
                                      onChange={(e) => updatePreset(p.id, { tableBgGifOpacity: e.target.value.replace(/[^\\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">GIF 밝기</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range"
                                      min="40"
                                      max="200"
                                      value={p.tableBgGifBrightness || "100"}
                                      onChange={(e) => updatePreset(p.id, { tableBgGifBrightness: e.target.value })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      value={p.tableBgGifBrightness || "100"}
                                      onChange={(e) => updatePreset(p.id, { tableBgGifBrightness: e.target.value.replace(/[^\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">TOTAL 표시</label>
                                  <select
                                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                    value={p.totalMode || "total"}
                                    onChange={(e) => updatePreset(p.id, { totalMode: e.target.value as "total" })}
                                  >
                                    <option value="total">TOTAL</option>
                                  </select>
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
                                    <option value="default">기본(핑크 그라데이션)</option>
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
                              <label className="text-xs text-neutral-400">엑셀표 스케일(%)</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="50"
                                  max="400"
                                  step="1"
                                  value={String(scalePct)}
                                  onChange={(e) => {
                                    const n = Math.max(50, Math.min(400, parseInt(e.target.value || "100", 10) || 100));
                                    updatePreset(p.id, { scale: String(n / 100) });
                                  }}
                                  className="flex-1 accent-emerald-500"
                                />
                                <input
                                  className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                  value={String(scalePct)}
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(/[^\d]/g, "");
                                    const n = Math.max(50, Math.min(400, parseInt(raw || "100", 10) || 100));
                                    updatePreset(p.id, { scale: String(n / 100) });
                                  }}
                                />
                                <span className="text-xs text-neutral-500">%</span>
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
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-neutral-400">합계 선 표시</label>
                                  <button
                                    className={`px-2 py-0.5 rounded border text-xs ${p.totalLineVisible ? "border-amber-500 text-amber-300" : "border-white/10 text-neutral-500"}`}
                                    onClick={() => updatePreset(p.id, { totalLineVisible: !p.totalLineVisible })}
                                  >
                                    {p.totalLineVisible ? "선 ON" : "선 OFF(기본)"}
                                  </button>
                                  <span className="text-[10px] text-neutral-500">기본은 OFF(합계 컬럼/합계행 선 제거)</span>
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
                                      폭죽 효과 테스트
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
                                { label: "폭죽(오버레이)", patch: { showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false, confettiMilestone: "10" } },
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
                              {isAdminNavSectionVisible("goal") && (
                              <button
                                id="overlay-goal-shortcut"
                                className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                onClick={() => {
                                  if (typeof window === "undefined") return;
                                  const url = `${window.location.origin}/overlay/goal?u=${user?.id || "finalent"}${p.id ? `&p=${encodeURIComponent(p.id)}` : ""}`;
                                  window.open(url, "_blank");
                                }}
                              >
                                목표 달성 바(전용)
                              </button>
                              )}
                              </div>
                            </details>

                            {/* 후원 티커 기능 제거됨 */}

                            {p.showGoal && (
                              <details className="rounded border border-white/10 bg-neutral-900/40">
                                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">목표</summary>
                                <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                  <label className="text-xs text-neutral-400">후원(원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" type="number" value={p.goal} onChange={(e) => updatePreset(p.id, { goal: e.target.value })} />
                                  <p className="col-span-1 sm:col-span-2 text-[11px] text-neutral-500 leading-snug">
                                    통합·목표 오버레이: 후원 합계가 목표 이상이면 이 금액이 자동으로 약 10% 증가합니다. OBS URL에{" "}
                                    <code className="rounded bg-black/40 px-1 text-neutral-400">goal=숫자</code>
                                    가 있으면 상향이 적용되지 않습니다(관리자 Prism 복사 URL에는 포함하지 않음). 비활성:{" "}
                                    <code className="rounded bg-black/40 px-1 text-neutral-400">goalAutoStretch=0</code>
                                  </p>
                                  <label className="text-xs text-neutral-400">라벨</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalLabel} onChange={(e) => updatePreset(p.id, { goalLabel: e.target.value })} />
                                  <label className="text-xs text-neutral-400">총 금액(현재 후원액, 원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="미지정 시 자동" value={p.goalCurrent || ""} onChange={(e) => updatePreset(p.id, { goalCurrent: e.target.value })} />
                                  <div className="col-span-1 sm:col-span-2">
                                    <details className="rounded border border-white/10 bg-neutral-900/40">
                                      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">고급 옵션</summary>
                                      <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                        <label className="text-xs text-neutral-400">너비(px)</label>
                                        <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalWidth} onChange={(e) => updatePreset(p.id, { goalWidth: e.target.value })} />
                                        <label className="text-xs text-neutral-400">투명도(%)</label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={p.goalOpacity ?? "100"}
                                            onChange={(e) => updatePreset(p.id, { goalOpacity: e.target.value })}
                                            className="flex-1 accent-fuchsia-500"
                                          />
                                          <input
                                            className="w-14 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                            type="number"
                                            min="0"
                                            max="100"
                                            value={p.goalOpacity ?? "100"}
                                            onChange={(e) => updatePreset(p.id, { goalOpacity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                          />
                                        </div>
                                        <label className="text-xs text-neutral-400">텍스트도 투명화</label>
                                        <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(p.goalOpacityText)}
                                            onChange={(e) => updatePreset(p.id, { goalOpacityText: e.target.checked })}
                                          />
                                          체크 시 텍스트/외곽선도 함께 투명화
                                        </label>
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
                                      className="px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 border border-emerald-700/40 text-xs text-emerald-100"
                                      onClick={() => {
                                        if (typeof window === "undefined") return;
                                        window.open(buildPrismOverlayUrl(p, !!p.vertical), "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      실시간으로 열기 (개인골)
                                    </button>
                                  </div>
                                </div>
                              </details>
                            )}

                            {/* 후원 티커 섹션 제거 */}

                            {p.showTimer && (
                              <details className="rounded border border-white/10 bg-neutral-900/40">
                                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">방송 타이머</summary>
                                <div className="p-3 space-y-3">
                                  <div className="flex flex-wrap gap-2 items-center">
                                    <button className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: Date.now() })}>{p.timerStart ? "재시작" : "시작"}</button>
                                    {p.timerStart && <button className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: null })}>정지</button>}
                                    <button
                                      className={`px-2 py-1 rounded border text-xs ${p.timerShowHours ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`}
                                      onClick={() => updatePreset(p.id, { timerShowHours: !p.timerShowHours })}
                                    >
                                      시:분:초 {p.timerShowHours ? "ON" : "OFF"}
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                    <label className="text-xs text-neutral-400">글자 색상</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="color"
                                        className="w-16 h-10 rounded bg-neutral-900/80 border border-white/10"
                                        value={toColorPickerValue(String(p.timerFontColor ?? ""), "#ffffff")}
                                        onChange={(e) => updatePreset(p.id, { timerFontColor: e.target.value })}
                                      />
                                      <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { timerFontColor: "" })}>기본</button>
                                    </div>
                                    <label className="text-xs text-neutral-400">배경 색상</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="color"
                                        className="w-16 h-10 rounded bg-neutral-900/80 border border-white/10"
                                        value={toColorPickerValue(String(p.timerBgColor ?? ""), "#ffffff")}
                                        onChange={(e) => updatePreset(p.id, { timerBgColor: e.target.value })}
                                      />
                                      <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { timerBgColor: "" })}>기본</button>
                                      <button
                                        type="button"
                                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                        onClick={() => updatePreset(p.id, { timerBgColor: "transparent", timerBorderColor: "transparent", timerBgOpacity: "0" })}
                                      >
                                        배경 없음
                                      </button>
                                    </div>
                                    <label className="text-xs text-neutral-400">테두리 색상</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="color"
                                        className="w-16 h-10 rounded bg-neutral-900/80 border border-white/10"
                                        value={toColorPickerValue(String(p.timerBorderColor ?? ""), "#ffffff")}
                                        onChange={(e) => updatePreset(p.id, { timerBorderColor: e.target.value })}
                                      />
                                      <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { timerBorderColor: "" })}>기본</button>
                                    </div>
                                    <label className="text-xs text-neutral-400">배경 불투명도</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={p.timerBgOpacity || "40"}
                                        onChange={(e) => updatePreset(p.id, { timerBgOpacity: e.target.value })}
                                        className="flex-1 accent-emerald-500 h-10"
                                      />
                                      <input
                                        className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                        value={p.timerBgOpacity || "40"}
                                        onChange={(e) => updatePreset(p.id, { timerBgOpacity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                      />
                                      <span className="text-xs text-neutral-500">%</span>
                                    </div>
                                    <label className="text-xs text-neutral-400">타이머 스케일(%)</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="range"
                                        min="50"
                                        max="250"
                                        value={p.timerScale || "100"}
                                        onChange={(e) => updatePreset(p.id, { timerScale: e.target.value })}
                                        className="flex-1 accent-fuchsia-500 h-10"
                                      />
                                      <input
                                        className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                        value={p.timerScale || "100"}
                                        onChange={(e) => updatePreset(p.id, { timerScale: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                      />
                                      <span className="text-xs text-neutral-500">%</span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-neutral-500">위치 설정은 Prism에서 조정 가능</div>
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
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={toColorPickerValue(String(p.missionBgColor ?? ""), "#0b0b0b")} onChange={(e) => updatePreset(p.id, { missionBgColor: e.target.value })} />
                                  <label className="text-xs text-neutral-400">배경 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="0" max="100" value={p.missionBgOpacity || "85"} onChange={(e) => updatePreset(p.id, { missionBgOpacity: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                    <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionBgOpacity || "85"} onChange={(e) => updatePreset(p.id, { missionBgOpacity: e.target.value.replace(/[^\\d]/g, "") })} />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">텍스트 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={toColorPickerValue(String(p.missionItemColor ?? ""), "#fde68a")} onChange={(e) => updatePreset(p.id, { missionItemColor: e.target.value })} />
                                  <label className="text-xs text-neutral-400">타이틀 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={toColorPickerValue(String(p.missionTitleColor ?? ""), "#fcd34d")} onChange={(e) => updatePreset(p.id, { missionTitleColor: e.target.value })} />
                              <label className="text-xs text-neutral-400">타이틀 효과</label>
                              <select
                                className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                value={(p as any).missionTitleEffect || "none"}
                                onChange={(e) => updatePreset(p.id, { missionTitleEffect: e.target.value })}
                              >
                                <option value="none">없음</option>
                                <option value="blink">깜빡임</option>
                                <option value="pulse">펄스</option>
                                <option value="glow">글로우</option>
                                <option value="sparkle">스파클</option>
                                <option value="gradient">그라데이션</option>
                                <option value="rainbow">레인보우</option>
                                <option value="shadow">섀도우</option>
                              </select>
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
                                {!(p.showMission && !p.showMembers && !p.showTotal && !p.showGoal && !p.showPersonalGoal && !p.showTimer) && (
                                  <div className="mt-2 rounded border border-white/10 bg-neutral-950/60 p-2">
                                    <div className="text-xs text-neutral-400 mb-1">미션 전광판 미리보기</div>
                                    <div className="overflow-hidden">
                                      {(p.missionDisplayMode === "vertical-slot") ? (
                                        <MissionBoardSlot
                                          missions={displayMissions}
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
                                          titleEffect={((p as any).missionTitleEffect || "none") as any}
                                        />
                                      ) : (
                                        <MissionBoard
                                          missions={displayMissions}
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
                                          titleEffect={((p as any).missionTitleEffect || "none") as any}
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
                            {(p.showMission && !p.showMembers && !p.showTotal && !p.showGoal && !p.showPersonalGoal && !p.showTimer) ? (
                              <div className="rounded border border-white/10 bg-neutral-950/60 p-3">
                                <div className="text-xs text-neutral-400 mb-2">미션 전광판 미리보기</div>
                                {(p.missionDisplayMode === "vertical-slot") ? (
                                  <MissionBoardSlot
                                    missions={displayMissions}
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
                                    titleEffect={((p as any).missionTitleEffect || "none") as any}
                                  />
                                ) : (
                                  <MissionBoard
                                    missions={displayMissions}
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
                                    titleEffect={((p as any).missionTitleEffect || "none") as any}
                                    effect={(p as any).missionEffect || "none"}
                                    effectHotOnly={(p as any).missionEffectHotOnly === "true"}
                                  />
                                )}
                              </div>
                            ) : (
                              <ClientPreviewWrapper preset={p} buildUrl={buildStablePreviewUrl} />
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            )}

            {isAdminNavSectionVisible("settlement") && (
            <section className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold">방송 종료 정산</h2>
                <Link className="text-sm text-neutral-300 underline" href="/settlements">정산 기록 보기</Link>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="flex-1 min-w-[220px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="정산 제목 (예: 16화 세부)"
                  value={settlementTitle}
                  onChange={(e) => setSettlementTitle(e.target.value)}
                />
                <input
                  className="w-[120px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="계좌 비율 % (예: 70)"
                  value={accountRatioInput}
                  onChange={(e) => setAccountRatioInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <input
                  className="w-[120px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="투네 비율 % (예: 60)"
                  value={toonRatioInput}
                  onChange={(e) => setToonRatioInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <input
                  className="w-[120px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="세금 비율 % (예: 3.3)"
                  value={taxRateInput}
                  onChange={(e) => setTaxRateInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <button
                  className="px-4 py-2 rounded bg-[#22c55e] hover:bg-[#16a34a] font-semibold text-white whitespace-nowrap flex-none"
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
            )}

            {isAdminNavSectionVisible("logs") && (
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
            )}
          </div>
        </div>
      </div>
      </div>
      {actionSheet.open && (
        <div className="fixed inset-0 z-50 lg:hidden flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/55" onClick={closeActionSheet} aria-label="액션 시트 닫기" />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#202020] p-4 shadow-xl">
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
        <div
          className="grid gap-1 p-2"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, navItems.filter((i) => i.mobileShort).length)}, minmax(0, 1fr))`,
          }}
        >
          {navItems
            .filter((item) => item.mobileShort)
            .map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => moveToSection(item.key, item.targetId)}
                className={`rounded-md py-2 text-xs ${activeNav === item.key ? "bg-[#6366f1] text-white" : "text-neutral-300"}`}
              >
                {item.mobileShort}
              </button>
            ))}
        </div>
      </nav>
    </main>
  );
}

function ClientPreviewWrapper({ preset, buildUrl }: { preset: OverlayPreset; buildUrl: (p: OverlayPreset) => string }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const u = buildUrl(preset);
    if (u) setUrl(u);
  }, [preset, buildUrl]);
  return <VerticalPreview url={url} />;
}

function VerticalPreview({ url }: { url: string }) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [showFrame, setShowFrame] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [w, h] = orientation === "portrait" ? [540, 960] : [960, 540];
  const previewUrl = useMemo(() => {
    if (!url || typeof url !== "string" || url.trim() === "") return "";
    try {
      const u = new URL(url);
      u.searchParams.set("previewGuide", "true");
      return u.toString();
    } catch {
      return url;
    }
  }, [url]);
  useEffect(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (!previewUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    loadTimeoutRef.current = setTimeout(() => {
      setLoading(false);
      setErr("미리보기 로딩 지연 (네트워크 확인 후 새로고침)");
    }, 30000);
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [previewUrl, iframeKey]);
  const onLoad = useCallback((e: any) => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoading(false);
    try {
      const doc = e?.target?.contentDocument;
      if (!doc) { setErr(null); return; }
      const title = (doc.title || "").toLowerCase();
      const text = (doc.body?.innerText || "").toLowerCase();
      if (title.includes("404") || text.includes("not found")) setErr("프리뷰 경로 404");
      else setErr(null);
    } catch {
      setErr(null);
    }
  }, []);
  const onError = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoading(false);
    setErr("미리보기 네트워크 오류");
  }, []);
  const reloadPreview = useCallback(() => {
    setErr(null);
    setLoading(true);
    setIframeKey((k) => k + 1);
  }, []);
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
          <button
            className="px-2 py-0.5 rounded border text-xs border-white/10 text-neutral-300 hover:border-emerald-500 hover:text-emerald-300"
            onClick={reloadPreview}
            title="프리뷰 새로고침"
          >
            새로고침
          </button>
          <button
            className={`px-2 py-0.5 rounded border text-xs ${showDiagnostics ? "border-amber-500 text-amber-300" : "border-white/10 text-neutral-300 hover:border-amber-500"}`}
            onClick={() => setShowDiagnostics((v) => !v)}
            title="원인 진단"
          >
            진단
          </button>
        </div>
      </div>
      {showDiagnostics && (
        <div className="mb-2 p-2 rounded bg-neutral-900/80 border border-amber-500/40 text-xs space-y-1">
          <div><span className="text-neutral-500">URL 길이:</span> {previewUrl ? previewUrl.length : 0}자 (브라우저 한도 ~2000자)</div>
          <div><span className="text-neutral-500">상태:</span> {loading ? "로딩 중" : err || "로드 완료"}</div>
          <div className="flex flex-wrap gap-2">
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 underline">새 탭에서 열기</a>
            <button type="button" className="text-amber-400 underline" onClick={() => { navigator.clipboard?.writeText(previewUrl || ""); }}>URL 복사</button>
          </div>
          {previewUrl && previewUrl.length > 1800 && (
            <div className="text-amber-400">⚠ URL이 너무 길어 일부 환경에서 실패할 수 있습니다. 멤버/후원자 수를 줄여보세요.</div>
          )}
        </div>
      )}
      {!previewUrl ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-white/10 bg-neutral-900/50 text-center">
          <div className="text-sm text-neutral-400 mb-2">프리뷰 URL을 생성할 수 없습니다.</div>
          <div className="text-xs text-neutral-500">페이지를 새로고침하거나, 오버레이를 펼쳐 확인해 주세요.</div>
        </div>
      ) : (
      <div className="relative mx-auto rounded-xl overflow-hidden shrink-0"
           style={{
             width: "min(84vw, 1100px)",
             maxWidth: "100%",
             minHeight: 280,
             height: "auto",
             maxHeight: "82vh",
             aspectRatio: `${w} / ${h}`,
             border: "1px solid rgba(255,255,255,0.1)",
             background: "#0b0b0b",
             boxShadow: showFrame ? "0 6px 24px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 8px 24px rgba(255,255,255,0.04)" : "none",
           }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/90 z-[9999]">
            <div className="text-sm text-neutral-400">프리뷰 로딩 중...</div>
          </div>
        )}
        <iframe key={`${previewUrl}-${iframeKey}`} src={previewUrl} title="vertical-preview" className="absolute inset-0 w-full h-full" style={{ background: "transparent" }} scrolling="no" onLoad={onLoad} onError={onError} />
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
      )}
    </div>
  );
}
