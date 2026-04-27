import type {
  AppState,
  Donor,
  ContributionLog,
  MatchTimerEnabled,
  DonorRankingsTheme,
  DonorRankingsPreset,
  MealBattleState,
  MealMatchSettings,
  MealMatchState,
  Member,
  MissionItem,
  OverlayConfig,
  SigItem,
  SigMatchPool,
  SigMatchSettings,
  RouletteState,
  SigMatchState,
  TimerDisplayStyle,
  TimerState,
} from "@/types";
export type {
  AppState,
  ContributionLog,
  Donor,
  DonorTarget,
  LegacyOverlaySettings,
  MatchTimerEnabled,
  DonorRankingsTheme,
  DonorRankingsPreset,
  MealBattleState,
  MealMatchSettings,
  MealMatchState,
  Member,
  MissionItem,
  OverlayConfig,
  RouletteState,
  SigItem,
  SigMatchPool,
  SigMatchSettings,
  SigMatchState,
  TimerDisplayStyle,
  TimerState,
} from "@/types";

/** 시그 풀: 멤버는 최대 한 풀에만, 풀은 2인 이상만 유지 */
export function normalizeSigMatchPools(raw: unknown, validMemberIds: Set<string>): SigMatchPool[] {
  if (!Array.isArray(raw)) return [];
  const assigned = new Set<string>();
  const out: SigMatchPool[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const idRaw = (item as Record<string, unknown>).id;
    const id =
      typeof idRaw === "string" && idRaw.trim()
        ? idRaw.trim()
        : `pool_${out.length}_${Math.random().toString(36).slice(2, 6)}`;
    const idsRaw = (item as Record<string, unknown>).memberIds;
    const ids = Array.isArray(idsRaw)
      ? idsRaw.map((x) => String(x)).filter((mid) => mid && validMemberIds.has(mid) && !assigned.has(mid))
      : [];
    if (ids.length < 2) continue;
    for (const mid of ids) assigned.add(mid);
    out.push({ id, memberIds: ids });
  }
  return out;
}

/** 시그 대전 랭킹 참가자 목록(유효 id만, 순서 유지) */
export function normalizeSigMatchParticipantIds(raw: unknown, validMemberIds: Set<string>): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of raw) {
    const id = String(x);
    if (!id || !validMemberIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
import { DEFAULT_SIG_INVENTORY, normalizeSigInventory } from "./constants";

export function normalizeRouletteState(raw: unknown): RouletteState {
  const def: RouletteState = {
    phase: "IDLE",
    isRolling: false,
    result: null,
    spinCount: 0,
    startedAt: 0,
    overlayOpacity: 0.85,
    oneShotResult: null,
  };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return def;
  const o = raw as Record<string, unknown>;
  let results: SigItem[] | undefined;
  if (Array.isArray(o.results)) {
    const norm = normalizeSigInventory(o.results.filter((x) => x && typeof x === "object") as unknown[]);
    results = norm.length > 0 ? norm : undefined;
  }
  let selectedSigs: SigItem[] | undefined;
  if (Array.isArray(o.selectedSigs)) {
    const norm = normalizeSigInventory(o.selectedSigs.filter((x) => x && typeof x === "object") as unknown[]);
    selectedSigs = norm.length > 0 ? norm : undefined;
  }
  let spinPriceFilters: (number | null)[] | undefined;
  if (Array.isArray(o.spinPriceFilters)) {
    spinPriceFilters = o.spinPriceFilters.map((x) => {
      if (x === null) return null;
      const n = Number(x);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
    });
  }
  let spinPriceRanges: ({ min: number | null; max: number | null } | null)[] | undefined;
  if (Array.isArray((o as Record<string, unknown>).spinPriceRanges)) {
    const raw = (o as Record<string, unknown>).spinPriceRanges as unknown[];
    spinPriceRanges = raw.map((x) => {
      if (x == null || typeof x !== "object") return null;
      const minNum = Number((x as Record<string, unknown>).min);
      const maxNum = Number((x as Record<string, unknown>).max);
      const min = Number.isFinite(minNum) && minNum > 0 ? Math.floor(minNum) : null;
      const max = Number.isFinite(maxNum) && maxNum > 0 ? Math.floor(maxNum) : null;
      if (min == null && max == null) return null;
      if (min != null && max != null && min > max) return { min: max, max: min };
      return { min, max };
    });
  }
  let result: SigItem | null = null;
  if (o.result && typeof o.result === "object") {
    const arr = normalizeSigInventory([o.result]);
    result = arr[0] || null;
  } else if (results && results.length > 0) {
    result = results[results.length - 1] ?? null;
  }
  const rawPhase = String(o.phase || "").toUpperCase();
  const phase = rawPhase === "SPINNING" || rawPhase === "LANDED" || rawPhase === "CONFIRM_PENDING" || rawPhase === "CONFIRMED"
    ? (rawPhase as RouletteState["phase"])
    : "IDLE";
  const overlayOpacityRaw = Number(o.overlayOpacity);
  const overlayOpacity = Number.isFinite(overlayOpacityRaw) ? Math.max(0.4, Math.min(1, overlayOpacityRaw)) : 0.85;
  const oneShotRaw = o.oneShotResult;
  const oneShotResult =
    oneShotRaw && typeof oneShotRaw === "object"
      ? {
          id: String((oneShotRaw as Record<string, unknown>).id || "sig_one_shot"),
          name: String((oneShotRaw as Record<string, unknown>).name || "한방 시그"),
          price: Math.max(0, Math.floor(Number((oneShotRaw as Record<string, unknown>).price || 0))),
        }
      : null;
  const historyLogs = Array.isArray(o.historyLogs)
    ? o.historyLogs
        .filter((x) => x && typeof x === "object")
        .slice(0, 50)
        .map((x) => {
          const r = x as Record<string, unknown>;
          const selectedSigs = Array.isArray(r.selectedSigs)
            ? normalizeSigInventory((r.selectedSigs as unknown[]).filter((s) => s && typeof s === "object"))
            : [];
          const phase: "CONFIRMED" | "CANCELLED" = r.phase === "CANCELLED" ? "CANCELLED" : "CONFIRMED";
          return {
            id: String(r.id || ""),
            sessionId: String(r.sessionId || ""),
            phase,
            selectedSigs,
            selectedSigIds: selectedSigs.map((s) => s.id),
            oneShotPrice: Math.max(0, Math.floor(Number(r.oneShotPrice || 0))),
            totalPrice: Math.max(0, Math.floor(Number(r.totalPrice || 0))),
            timestamp: Math.max(0, Math.floor(Number(r.timestamp || 0))),
            adminId: typeof r.adminId === "string" ? r.adminId : undefined,
            reason: typeof r.reason === "string" ? r.reason : undefined,
          };
        })
    : undefined;
  return {
    phase,
    isRolling: Boolean(o.isRolling),
    result,
    spinCount: Number.isFinite(o.spinCount) ? Math.max(0, Math.floor(Number(o.spinCount))) : 0,
    startedAt: Number.isFinite(o.startedAt) ? Math.max(0, Math.floor(Number(o.startedAt))) : 0,
    results,
    selectedSigs,
    oneShotResult,
    overlayOpacity,
    sessionId: typeof o.sessionId === "string" ? o.sessionId : undefined,
    lastFinishedAt: Number.isFinite(Number(o.lastFinishedAt)) ? Math.max(0, Math.floor(Number(o.lastFinishedAt))) : undefined,
    historyLogs,
    spinPriceFilters,
    spinPriceRanges,
  };
}

const DEFAULT_DONOR_RANKINGS_THEME: DonorRankingsTheme = {
  top: 7,
  titleSize: 28,
  rowSize: 21,
  rankSize: 24,
  overlayOpacity: 100,
  bg: "transparent",
  panelBg: "transparent",
  borderColor: "transparent",
  headerAccountBg: "#F8BBD0",
  headerToonBg: "#F06292",
  rowEvenBg: "transparent",
  rowOddBg: "transparent",
  rankColor: "#F06292",
  nameColor: "#ffffff",
  amountColor: "#fff59d",
  outlineColor: "rgba(0,0,0,0.92)",
};

function normalizeDonorRankingsTheme(input: unknown): DonorRankingsTheme {
  const v = input && typeof input === "object" ? (input as Partial<DonorRankingsTheme>) : {};
  const n = (x: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(x);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  };
  const s = (x: unknown, fallback: string) => {
    const raw = String(x ?? "").trim();
    return raw || fallback;
  };
  return {
    top: n(v.top, 1, 20, DEFAULT_DONOR_RANKINGS_THEME.top),
    titleSize: n(v.titleSize, 14, 80, DEFAULT_DONOR_RANKINGS_THEME.titleSize),
    rowSize: n(v.rowSize, 12, 64, DEFAULT_DONOR_RANKINGS_THEME.rowSize),
    rankSize: n(v.rankSize, 12, 72, DEFAULT_DONOR_RANKINGS_THEME.rankSize),
    overlayOpacity: n(v.overlayOpacity, 0, 100, DEFAULT_DONOR_RANKINGS_THEME.overlayOpacity),
    bg: s(v.bg, DEFAULT_DONOR_RANKINGS_THEME.bg),
    panelBg: s(v.panelBg, DEFAULT_DONOR_RANKINGS_THEME.panelBg),
    borderColor: s(v.borderColor, DEFAULT_DONOR_RANKINGS_THEME.borderColor),
    headerAccountBg: s(v.headerAccountBg, DEFAULT_DONOR_RANKINGS_THEME.headerAccountBg),
    headerToonBg: s(v.headerToonBg, DEFAULT_DONOR_RANKINGS_THEME.headerToonBg),
    rowEvenBg: s(v.rowEvenBg, DEFAULT_DONOR_RANKINGS_THEME.rowEvenBg),
    rowOddBg: s(v.rowOddBg, DEFAULT_DONOR_RANKINGS_THEME.rowOddBg),
    rankColor: s(v.rankColor, DEFAULT_DONOR_RANKINGS_THEME.rankColor),
    nameColor: s(v.nameColor, DEFAULT_DONOR_RANKINGS_THEME.nameColor),
    amountColor: s(v.amountColor, DEFAULT_DONOR_RANKINGS_THEME.amountColor),
    outlineColor: s(v.outlineColor, DEFAULT_DONOR_RANKINGS_THEME.outlineColor),
  };
}

function normalizeDonorRankingsPresets(input: unknown): DonorRankingsPreset[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((x) => x && typeof x === "object")
    .map((x, idx) => {
      const o = x as Record<string, unknown>;
      const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `drp_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : `프리셋 ${idx + 1}`;
      return {
        id,
        name,
        theme: normalizeDonorRankingsTheme(o.theme),
      };
    });
}

/** 동기화 오류 시 members가 missions에 섞이는 것 방지. title/price가 있는 항목만 반환 */
export function ensureMissionItems(items: unknown[] | undefined | null): MissionItem[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is MissionItem => {
    if (!x || typeof x !== "object") return false;
    const t = x as Record<string, unknown>;
    return typeof t.title === "string" && typeof t.price === "string";
  }).map((x) => ({
    id: String((x as MissionItem).id || ""),
    title: String((x as MissionItem).title || ""),
    price: String((x as MissionItem).price || ""),
    isHot: Boolean((x as MissionItem).isHot),
  }));
}

/** 동기화 오류 시 missions가 members에 섞이는 것 방지. name이 있고 title이 없는 항목만 반환 */
export function ensureMembers(items: unknown[] | undefined | null): Member[] {
  if (!Array.isArray(items)) return [];
  return items.filter((x): x is Member => {
    if (!x || typeof x !== "object") return false;
    const t = x as Record<string, unknown>;
    return typeof t.name === "string" && typeof t.title !== "string";
  }).map((m) => normalizeMember(m as Member));
}

import { sendSSEUpdate } from "./sse-client";

export const STORAGE_KEY = "excel-broadcast-state-v1";
export const DAILY_LOG_KEY = "excel-broadcast-daily-log-v1";
export const FORBID_EVENTS_KEY = "excel-broadcast-forbid-events-v1";
export const MISSIONS_BACKUP_KEY = "excel-broadcast-missions-backup-v1";

export function storageKey(userId?: string | null): string {
  return userId ? `${STORAGE_KEY}:${userId}` : STORAGE_KEY;
}
export function dailyLogStorageKey(userId?: string | null): string {
  return userId ? `${DAILY_LOG_KEY}:${userId}` : DAILY_LOG_KEY;
}
export function missionsBackupKey(userId?: string | null): string {
  return userId ? `${MISSIONS_BACKUP_KEY}:${userId}` : MISSIONS_BACKUP_KEY;
}

export function saveMissionsBackup(missions: MissionItem[], userId?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(missionsBackupKey(userId), JSON.stringify(missions));
  } catch {}
}

export function loadMissionsBackup(userId?: string | null): MissionItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(missionsBackupKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as MissionItem[];
  } catch {
    return null;
  }
}

export function defaultMembers(): Member[] {
  return [
    { id: "m1", name: "멤버1", realName: "", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "m2", name: "멤버2", realName: "", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "m3", name: "멤버3", realName: "", account: 0, toon: 0, contribution: 0, operating: false },
  ];
}

function normalizeMember(m: Member): Member {
  const goal = typeof m.goal === "number" && Number.isFinite(m.goal) ? Math.max(0, Math.floor(m.goal)) : undefined;
  const contribution = typeof m.contribution === "number" && Number.isFinite(m.contribution)
    ? Math.max(0, Math.floor(m.contribution))
    : 0;
  return {
    ...m,
    realName: m.realName ?? "",
    contribution,
    goal,
    operating: m.operating ?? /운영비/i.test(m.name),
  };
}

/** 직급은 멤버와 분리 저장: memberId -> 직급 */
export function normalizeMemberPositions(
  raw: unknown,
  members: Member[]
): Record<string, string> {
  const validIds = new Set((members || []).map((m) => m.id));
  const out: Record<string, string> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
      if (!validIds.has(id)) continue;
      const role = String(val ?? "").trim();
      if (!role) continue;
      out[id] = role;
    }
  }
  // 하위호환: 기존 member.role 값이 있으면 초기 직급으로 채움
  for (const m of members || []) {
    if (out[m.id]) continue;
    const legacy = String((m as unknown as { role?: string }).role || "").trim();
    if (legacy) out[m.id] = legacy;
  }
  return out;
}

function normalizeMemberPositionMode(input: unknown): AppState["memberPositionMode"] {
  return input === "rankLinked" ? "rankLinked" : "fixed";
}

function normalizeRankPositionLabels(input: unknown): string[] {
  const fallback = ["대표", "", "", "", "", "", "", "", "", "", "", ""];
  if (!Array.isArray(input)) return fallback;
  return Array.from({ length: 12 }).map((_, idx) => String(input[idx] || "").trim());
}

export function normalizeDonationListsOverlayConfig(input: unknown): OverlayConfig {
  const v = input && typeof input === "object" ? (input as Partial<OverlayConfig>) : {};
  const urlRaw = typeof v.bgGifUrl === "string" ? v.bgGifUrl.trim() : "";
  let op = Number(v.bgOpacity);
  if (!Number.isFinite(op)) op = 40;
  op = Math.max(0, Math.min(100, Math.round(op)));
  return {
    bgGifUrl: urlRaw,
    bgOpacity: op,
    isBgEnabled: Boolean(v.isBgEnabled),
  };
}

export function normalizeDonorRankingsOverlayConfig(input: unknown): OverlayConfig {
  return normalizeDonationListsOverlayConfig(input);
}

function normalizeSigSalesExcludedIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of input) {
    const id = String(x || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function defaultState(): AppState {
  const defaultTimer: TimerState = { remainingTime: 0, isActive: false, lastUpdated: Date.now() };
  const defaultMealBattle: MealBattleState = {
    participants: [],
    memberGaugeColors: {},
    overlayTitle: "식사 대전",
    currentMission: "",
    totalGoal: 100,
    timerTheme: "default",
    timerSize: 36,
    missionBubbleBg: "#9333ea",
    missionBubbleTextColor: "#ffffff",
    gaugeTrackBg: "rgba(23,23,23,0.85)",
    gaugeTrackBorderColor: "rgba(255,255,255,0.2)",
    gaugeFillColor: "#22c55e",
    scoreTextColor: "#ffffff",
    nameTagBg: "#facc15",
    nameTagTextColor: "#000000",
    showPanelBorder: false,
    panelBorderColor: "rgba(255,255,255,0.25)",
    showGaugeTrackBorder: false,
    teamBattleEnabled: false,
    teamAName: "A팀",
    teamBName: "B팀",
    teamAGoal: 0,
    teamBGoal: 0,
    teamAMemberIds: [],
    teamBMemberIds: [],
    teamAColor: "#2563eb",
    teamBColor: "#dc2626",
  };
  const defaultMealSettings: MealMatchSettings = {
    isActive: false,
    title: "식사 대전",
    mode: "team",
    targetScore: 100,
    teamAName: "Team A",
    teamBName: "Team B",
    teamAMemberIds: ["m1"],
    teamBMemberIds: ["m2"],
  };
  return {
    members: defaultMembers(),
    memberPositions: {},
    memberPositionMode: "fixed",
    rankPositionLabels: ["대표", "", "", "", "", "", "", "", "", "", "", ""],
    donorRankingsTheme: { ...DEFAULT_DONOR_RANKINGS_THEME },
    donorRankingsPresets: [],
    donorRankingsPresetId: undefined,
    donors: [],
    contributionLogs: [],
    forbiddenWords: ["금칙어", "욕설", "비속어"],
    sigInventory: DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
    sigSoldOutStampUrl: "",
    sigSalesMemberPresets: {},
    sigSalesExcludedIds: [],
    rouletteState: normalizeRouletteState(null),
    overlayPresets: [],
    sigMatch: {},
    mealBattle: defaultMealBattle,
    mealMatch: {},
    sigMatchSettings: {
      isActive: false,
      targetCount: 100,
      title: "시그 대전",
      keyword: "시그",
      signatureAmounts: [77, 100, 333],
      scoringMode: "count",
      incentivePerPoint: 1000,
      sigMatchPools: [],
      participantMemberIds: [],
    },
    mealMatchSettings: defaultMealSettings,
    sigMatchTimer: { ...defaultTimer },
    mealMatchTimer: { ...defaultTimer },
    sigSalesTimer: { ...defaultTimer },
    generalTimer: { ...defaultTimer },
    matchTimerEnabled: { sigMatch: true, mealMatch: true, sigSales: true, general: true },
    timerDisplayStyles: {
      sigMatch: defaultTimerDisplayStyle(),
      mealMatch: defaultTimerDisplayStyle(),
      sigSales: defaultTimerDisplayStyle(),
      general: defaultTimerDisplayStyle(),
    },
    donorRankingsOverlayConfig: normalizeDonorRankingsOverlayConfig(null),
    donationListsOverlayConfig: normalizeDonationListsOverlayConfig(null),
    updatedAt: Date.now(),
  };
}

function normalizeMealBattle(input: unknown): MealBattleState {
  const v = input && typeof input === "object" ? (input as Partial<MealBattleState>) : {};
  const rawGaugeColors = (v as Record<string, unknown>).memberGaugeColors;
  const memberGaugeColors =
    rawGaugeColors && typeof rawGaugeColors === "object" && !Array.isArray(rawGaugeColors)
      ? Object.fromEntries(
          Object.entries(rawGaugeColors as Record<string, unknown>)
            .filter(([key, val]) => typeof key === "string" && typeof val === "string" && String(val).trim())
            .map(([key, val]) => [key, String(val).trim()])
        )
      : {};
  const otRaw = typeof v.overlayTitle === "string" ? v.overlayTitle.trim() : "";
  const cmRaw = typeof v.currentMission === "string" ? v.currentMission.trim() : "";
  const totalGoal = Number.isFinite(v.totalGoal) ? Math.max(1, Math.floor(v.totalGoal as number)) : 100;
  const participantsWithGoals = Array.isArray(v.participants)
    ? v.participants
        .filter((x) => Boolean(x && typeof x === "object"))
        .map((x) => {
          const goalRaw = (x as Record<string, unknown>).goal;
          const goalNum = Number(goalRaw);
          const goal =
            goalRaw !== undefined && goalRaw !== null && Number.isFinite(goalNum) ? Math.max(1, Math.floor(goalNum)) : totalGoal;
          return {
            memberId: String((x as Record<string, unknown>).memberId || ""),
            name: String((x as Record<string, unknown>).name || ""),
            score: Math.max(0, Math.floor(Number((x as Record<string, unknown>).score || 0) || 0)),
            goal,
            color: String((x as Record<string, unknown>).color || "#60a5fa"),
            donationLinkActive: Boolean((x as Record<string, unknown>).donationLinkActive),
            donationLinkStartedAt: Number.isFinite(Number((x as Record<string, unknown>).donationLinkStartedAt))
              ? Math.max(0, Math.floor(Number((x as Record<string, unknown>).donationLinkStartedAt)))
              : undefined,
          };
        })
        .filter((x) => Boolean(x.memberId))
    : [];
  return {
    participants: participantsWithGoals,
    memberGaugeColors,
    overlayTitle: otRaw || "식사 대전",
    currentMission: cmRaw,
    totalGoal,
    timerTheme: v.timerTheme === "neon" || v.timerTheme === "minimal" || v.timerTheme === "danger" ? v.timerTheme : "default",
    timerSize: Number.isFinite(v.timerSize) ? Math.max(16, Math.min(120, Math.floor(v.timerSize as number))) : 36,
    missionBubbleBg: String((v as Record<string, unknown>).missionBubbleBg || "#9333ea"),
    missionBubbleTextColor: String((v as Record<string, unknown>).missionBubbleTextColor || "#ffffff"),
    gaugeTrackBg: String((v as Record<string, unknown>).gaugeTrackBg || "rgba(23,23,23,0.85)"),
    gaugeTrackBorderColor: String((v as Record<string, unknown>).gaugeTrackBorderColor || "rgba(255,255,255,0.2)"),
    gaugeFillColor: String((v as Record<string, unknown>).gaugeFillColor || "#22c55e"),
    scoreTextColor: String((v as Record<string, unknown>).scoreTextColor || "#ffffff"),
    nameTagBg: String((v as Record<string, unknown>).nameTagBg || "#facc15"),
    nameTagTextColor: String((v as Record<string, unknown>).nameTagTextColor || "#000000"),
    showPanelBorder: typeof (v as Record<string, unknown>).showPanelBorder === "boolean" ? Boolean((v as Record<string, unknown>).showPanelBorder) : false,
    panelBorderColor: String((v as Record<string, unknown>).panelBorderColor || "rgba(255,255,255,0.25)"),
    showGaugeTrackBorder: typeof (v as Record<string, unknown>).showGaugeTrackBorder === "boolean"
      ? Boolean((v as Record<string, unknown>).showGaugeTrackBorder)
      : false,
    teamBattleEnabled: Boolean((v as Record<string, unknown>).teamBattleEnabled),
    teamAName: typeof (v as Record<string, unknown>).teamAName === "string" && String((v as Record<string, unknown>).teamAName).trim()
      ? String((v as Record<string, unknown>).teamAName).trim()
      : "A팀",
    teamBName: typeof (v as Record<string, unknown>).teamBName === "string" && String((v as Record<string, unknown>).teamBName).trim()
      ? String((v as Record<string, unknown>).teamBName).trim()
      : "B팀",
    teamAGoal: Number.isFinite(Number((v as Record<string, unknown>).teamAGoal))
      ? Math.max(0, Math.floor(Number((v as Record<string, unknown>).teamAGoal)))
      : 0,
    teamBGoal: Number.isFinite(Number((v as Record<string, unknown>).teamBGoal))
      ? Math.max(0, Math.floor(Number((v as Record<string, unknown>).teamBGoal)))
      : 0,
    teamAMemberIds: Array.isArray((v as Record<string, unknown>).teamAMemberIds)
      ? ((v as Record<string, unknown>).teamAMemberIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [],
    teamBMemberIds: Array.isArray((v as Record<string, unknown>).teamBMemberIds)
      ? ((v as Record<string, unknown>).teamBMemberIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [],
    teamAColor: String((v as Record<string, unknown>).teamAColor || "#2563eb"),
    teamBColor: String((v as Record<string, unknown>).teamBColor || "#dc2626"),
  };
}

function normalizeMealMatchSettings(input: unknown): MealMatchSettings {
  const s = input && typeof input === "object" ? (input as Partial<MealMatchSettings>) : {};
  return {
    isActive: Boolean(s.isActive),
    title: typeof s.title === "string" && s.title.trim() ? s.title : "식사 대전",
    mode: s.mode === "individual" ? "individual" : "team",
    targetScore: Number.isFinite(s.targetScore) ? Math.max(1, Math.floor(s.targetScore as number)) : 100,
    teamAName: typeof s.teamAName === "string" && s.teamAName.trim() ? s.teamAName : "Team A",
    teamBName: typeof s.teamBName === "string" && s.teamBName.trim() ? s.teamBName : "Team B",
    teamAMemberIds: Array.isArray(s.teamAMemberIds) ? s.teamAMemberIds.map((x) => String(x)).filter(Boolean) : [],
    teamBMemberIds: Array.isArray(s.teamBMemberIds) ? s.teamBMemberIds.map((x) => String(x)).filter(Boolean) : [],
  };
}

function normalizeTimerState(input: unknown): TimerState {
  const t = input && typeof input === "object" ? (input as Partial<TimerState>) : {};
  return {
    remainingTime: Number.isFinite(t.remainingTime) ? Math.max(0, Math.floor(t.remainingTime as number)) : 0,
    isActive: Boolean(t.isActive),
    lastUpdated: Number.isFinite(t.lastUpdated) ? Math.max(0, Math.floor(t.lastUpdated as number)) : Date.now(),
  };
}

function normalizeMatchTimerEnabled(input: unknown): MatchTimerEnabled {
  const v = input && typeof input === "object" ? (input as Partial<MatchTimerEnabled>) : {};
  return {
    sigMatch: typeof v.sigMatch === "boolean" ? v.sigMatch : true,
    mealMatch: typeof v.mealMatch === "boolean" ? v.mealMatch : true,
    sigSales: typeof v.sigSales === "boolean" ? v.sigSales : true,
    general: typeof v.general === "boolean" ? v.general : true,
  };
}

function defaultTimerDisplayStyle(): TimerDisplayStyle {
  return {
    showHours: false,
    fontColor: "",
    bgColor: "",
    borderColor: "",
    bgOpacity: 40,
    scalePercent: 100,
  };
}

function normalizeTimerDisplayStyle(input: unknown): TimerDisplayStyle {
  const v = input && typeof input === "object" ? (input as Partial<TimerDisplayStyle>) : {};
  const op = Number(v.bgOpacity);
  const scale = Number(v.scalePercent);
  return {
    showHours: typeof v.showHours === "boolean" ? v.showHours : false,
    fontColor: typeof v.fontColor === "string" ? v.fontColor : "",
    bgColor: typeof v.bgColor === "string" ? v.bgColor : "",
    borderColor: typeof v.borderColor === "string" ? v.borderColor : "",
    bgOpacity: Number.isFinite(op) ? Math.max(0, Math.min(100, Math.round(op))) : 40,
    scalePercent: Number.isFinite(scale) ? Math.max(50, Math.min(250, Math.round(scale))) : 100,
  };
}

function normalizeTimerDisplayStyles(input: unknown): AppState["timerDisplayStyles"] {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    sigMatch: normalizeTimerDisplayStyle(v.sigMatch),
    mealMatch: normalizeTimerDisplayStyle(v.mealMatch),
    sigSales: normalizeTimerDisplayStyle(v.sigSales),
    general: normalizeTimerDisplayStyle(v.general),
  };
}

export function parseAmount(input: string | number): number {
  if (typeof input === "number") return Math.max(0, Math.floor(input));
  const extracted = (input || "")
    .replace(/[^\d]/g, "");
  const n = parseInt(extracted || "0", 10);
  return isNaN(n) ? 0 : n;
}

// ex) "3.5" => 35,000 (3만5천원), "2" => 20,000, "2.0" => 20,000
// Only first decimal digit is used as thousands; other characters are ignored.
export function parseTenThousandThousand(input: string | number): number {
  if (typeof input === "number") {
    const intPart = Math.trunc(input);
    const frac = Math.abs(input - intPart);
    const thousandDigit = Math.trunc(frac * 10);
    const value = intPart * 10000 + thousandDigit * 1000;
    return Math.max(0, value);
  }
  const s = (input || "").toString().trim();
  const match = s.replace(/,/g, "").match(/(-?\d+)(?:[.,](\d))?/);
  if (!match) return 0;
  const intPart = parseInt(match[1] || "0", 10);
  const thousandDigit = parseInt(match[2] || "0", 10);
  if (isNaN(intPart) || intPart < 0) return 0;
  const td = isNaN(thousandDigit) || thousandDigit < 0 ? 0 : thousandDigit;
  return intPart * 10000 + td * 1000;
}

export function maskTenThousandThousandInput(input: string): string {
  const s = (input || "").toString().replace(/,/g, "").replace(/[^\d.,]/g, "");
  const m = s.match(/^(\d*)([.,]?)(\d?)/);
  if (!m) return "";
  const i = m[1] || "";
  const sep = m[2] ? "." : "";
  const d = m[3] || "";
  return i + sep + d;
}

export function roundToThousand(n: number): number {
  return Math.round((n || 0) / 1000) * 1000;
}

export function loadState(userId?: string | null): AppState {
  if (typeof window === "undefined") return defaultState();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return defaultState();
    const data = JSON.parse(raw) as AppState;
    data.members = (() => { const v = ensureMembers(data.members); return v.length > 0 ? v : defaultMembers().map(normalizeMember); })();
    data.memberPositions = normalizeMemberPositions((data as AppState).memberPositions, data.members);
    data.memberPositionMode = normalizeMemberPositionMode((data as AppState).memberPositionMode);
    data.rankPositionLabels = normalizeRankPositionLabels((data as AppState).rankPositionLabels);
    data.donorRankingsTheme = normalizeDonorRankingsTheme((data as AppState).donorRankingsTheme);
    data.donorRankingsPresets = normalizeDonorRankingsPresets((data as AppState).donorRankingsPresets);
    data.donorRankingsPresetId = typeof (data as AppState).donorRankingsPresetId === "string" && (data as AppState).donorRankingsPresetId
      ? (data as AppState).donorRankingsPresetId
      : undefined;
    data.donors = data.donors || [];
    data.contributionLogs = Array.isArray((data as AppState).contributionLogs)
      ? ((data as AppState).contributionLogs as ContributionLog[])
          .filter((x) => x && typeof x === "object")
          .map((x) => ({
            id: String((x as ContributionLog).id || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
            memberId: String((x as ContributionLog).memberId || ""),
            amount: Math.max(0, Math.floor(Number((x as ContributionLog).amount || 0))),
            delta: (x as ContributionLog).delta === -1 ? -1 : 1,
            note: typeof (x as ContributionLog).note === "string" ? (x as ContributionLog).note : "",
            at: Number.isFinite(Number((x as ContributionLog).at)) ? Math.floor(Number((x as ContributionLog).at)) : Date.now(),
          }))
      : [];
    data.forbiddenWords = data.forbiddenWords || [];
    data.missions = ensureMissionItems(data.missions);
    data.sigInventory = normalizeSigInventory((data as AppState).sigInventory);
    data.sigSoldOutStampUrl = typeof (data as AppState).sigSoldOutStampUrl === "string" ? (data as AppState).sigSoldOutStampUrl : "";
    data.sigSalesMemberPresets =
      (data as AppState).sigSalesMemberPresets && typeof (data as AppState).sigSalesMemberPresets === "object"
        ? Object.fromEntries(
            Object.entries((data as AppState).sigSalesMemberPresets as Record<string, unknown>)
              .map(([memberId, ids]) => [
                memberId,
                Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : [],
              ])
          )
        : {};
    data.sigSalesExcludedIds = normalizeSigSalesExcludedIds((data as AppState).sigSalesExcludedIds);
    data.sigMatch = data.sigMatch && typeof data.sigMatch === "object" ? data.sigMatch : {};
    data.mealBattle = normalizeMealBattle((data as AppState).mealBattle);
    data.mealMatch = data.mealMatch && typeof data.mealMatch === "object" ? data.mealMatch : {};
    const validSigMemberIds = new Set(data.members.map((m: Member) => m.id));
    data.sigMatchSettings = {
      isActive: Boolean(data.sigMatchSettings?.isActive),
      targetCount: Number.isFinite(data.sigMatchSettings?.targetCount)
        ? Math.max(1, Math.floor(data.sigMatchSettings!.targetCount))
        : 100,
      title: typeof data.sigMatchSettings?.title === "string" && data.sigMatchSettings.title.trim()
        ? data.sigMatchSettings.title
        : "시그 대전",
      keyword: typeof data.sigMatchSettings?.keyword === "string" ? data.sigMatchSettings.keyword : "시그",
      signatureAmounts: Array.isArray(data.sigMatchSettings?.signatureAmounts)
        ? data.sigMatchSettings.signatureAmounts
            .map((x: unknown) => Number(x))
            .filter((x: number) => Number.isFinite(x) && x > 0)
        : [77, 100, 333],
      scoringMode: data.sigMatchSettings?.scoringMode === "amount" ? "amount" : "count",
      incentivePerPoint: Number.isFinite(data.sigMatchSettings?.incentivePerPoint)
        ? Math.max(0, Math.floor(data.sigMatchSettings!.incentivePerPoint))
        : 1000,
      sigMatchPools: normalizeSigMatchPools(data.sigMatchSettings?.sigMatchPools, validSigMemberIds),
      participantMemberIds: normalizeSigMatchParticipantIds(
        (data as AppState).sigMatchSettings?.participantMemberIds,
        validSigMemberIds
      ),
    };
    data.rouletteState = normalizeRouletteState((data as AppState).rouletteState);
    data.mealMatchSettings = normalizeMealMatchSettings((data as AppState).mealMatchSettings);
    data.sigMatchTimer = normalizeTimerState((data as AppState).sigMatchTimer);
    data.mealMatchTimer = normalizeTimerState((data as AppState).mealMatchTimer);
    data.sigSalesTimer = normalizeTimerState((data as AppState).sigSalesTimer);
    data.generalTimer = normalizeTimerState((data as AppState).generalTimer);
    data.matchTimerEnabled = normalizeMatchTimerEnabled((data as AppState).matchTimerEnabled);
    data.timerDisplayStyles = normalizeTimerDisplayStyles((data as AppState).timerDisplayStyles);
    data.donorRankingsOverlayConfig = normalizeDonorRankingsOverlayConfig((data as AppState).donorRankingsOverlayConfig);
    data.donationListsOverlayConfig = normalizeDonationListsOverlayConfig((data as AppState).donationListsOverlayConfig);
    data.overlayPresets = Array.isArray(data.overlayPresets)
      ? data.overlayPresets
      : Array.isArray(data.overlaySettings?.presets)
        ? data.overlaySettings?.presets
        : [];
    return data;
  } catch {
    return defaultState();
  }
}

export function saveState(state: AppState, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const next = { ...state, updatedAt: Date.now() };
    const json = JSON.stringify(next);
    window.localStorage.setItem(storageKey(userId), json);
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const url = q.toString() ? `/api/state?${q.toString()}` : "/api/state";
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      credentials: "include",
    }).catch(() => {});
    try {
      const { sendSSEUpdate } = require("./sse-post") as { sendSSEUpdate: (d: unknown) => Promise<void> };
      void sendSSEUpdate(next);
    } catch {}
  } catch {
    // ignore
  }
}

export async function saveStateAsync(state: AppState, userId?: string | null): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const next = { ...state, updatedAt: Date.now() };
  const json = JSON.stringify(next);
  try { window.localStorage.setItem(storageKey(userId), json); } catch {}
  try {
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const url = q.toString() ? `/api/state?${q.toString()}` : "/api/state";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: json,
      credentials: "include",
    });
    try {
      const { sendSSEUpdate } = require("./sse-post") as { sendSSEUpdate: (d: unknown) => Promise<void> };
      void sendSSEUpdate(next);
    } catch {}
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadStateFromApi(userId?: string): Promise<AppState | null> {
  try {
    const q = new URLSearchParams({ _t: String(Date.now()) });
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/state?${q.toString()}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.members) {
      data.members = (() => { const v = ensureMembers(data.members); return v.length > 0 ? v : defaultMembers().map(normalizeMember); })();
      data.memberPositions = normalizeMemberPositions((data as AppState).memberPositions, data.members);
      data.memberPositionMode = normalizeMemberPositionMode((data as AppState).memberPositionMode);
      data.rankPositionLabels = normalizeRankPositionLabels((data as AppState).rankPositionLabels);
      data.donorRankingsTheme = normalizeDonorRankingsTheme((data as AppState).donorRankingsTheme);
      data.donorRankingsPresets = normalizeDonorRankingsPresets((data as AppState).donorRankingsPresets);
      data.donorRankingsPresetId = typeof (data as AppState).donorRankingsPresetId === "string" && (data as AppState).donorRankingsPresetId
        ? (data as AppState).donorRankingsPresetId
        : undefined;
      data.donors = data.donors || [];
      data.contributionLogs = Array.isArray((data as AppState).contributionLogs)
        ? ((data as AppState).contributionLogs as ContributionLog[])
            .filter((x) => x && typeof x === "object")
            .map((x) => ({
              id: String((x as ContributionLog).id || `cl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`),
              memberId: String((x as ContributionLog).memberId || ""),
              amount: Math.max(0, Math.floor(Number((x as ContributionLog).amount || 0))),
              delta: (x as ContributionLog).delta === -1 ? -1 : 1,
              note: typeof (x as ContributionLog).note === "string" ? (x as ContributionLog).note : "",
              at: Number.isFinite(Number((x as ContributionLog).at)) ? Math.floor(Number((x as ContributionLog).at)) : Date.now(),
            }))
        : [];
      data.forbiddenWords = data.forbiddenWords || [];
      data.missions = ensureMissionItems(data.missions);
      data.sigInventory = normalizeSigInventory((data as AppState).sigInventory);
      data.sigSoldOutStampUrl = typeof (data as AppState).sigSoldOutStampUrl === "string" ? (data as AppState).sigSoldOutStampUrl : "";
      data.sigSalesMemberPresets =
        (data as AppState).sigSalesMemberPresets && typeof (data as AppState).sigSalesMemberPresets === "object"
          ? Object.fromEntries(
              Object.entries((data as AppState).sigSalesMemberPresets as Record<string, unknown>)
                .map(([memberId, ids]) => [
                  memberId,
                  Array.isArray(ids) ? ids.map((x) => String(x)).filter(Boolean) : [],
                ])
            )
          : {};
      data.sigSalesExcludedIds = normalizeSigSalesExcludedIds((data as AppState).sigSalesExcludedIds);
      data.sigMatch = data.sigMatch && typeof data.sigMatch === "object" ? data.sigMatch : {};
      data.mealBattle = normalizeMealBattle((data as AppState).mealBattle);
      data.mealMatch = data.mealMatch && typeof data.mealMatch === "object" ? data.mealMatch : {};
      const validSigMemberIdsApi = new Set<string>((data.members as Member[]).map((m) => m.id));
      data.sigMatchSettings = {
        isActive: Boolean(data.sigMatchSettings?.isActive),
        targetCount: Number.isFinite(data.sigMatchSettings?.targetCount)
          ? Math.max(1, Math.floor(data.sigMatchSettings!.targetCount))
          : 100,
        title: typeof data.sigMatchSettings?.title === "string" && data.sigMatchSettings.title.trim()
          ? data.sigMatchSettings.title
          : "시그 대전",
        keyword: typeof data.sigMatchSettings?.keyword === "string" ? data.sigMatchSettings.keyword : "시그",
        signatureAmounts: Array.isArray(data.sigMatchSettings?.signatureAmounts)
          ? data.sigMatchSettings.signatureAmounts
              .map((x: unknown) => Number(x))
              .filter((x: number) => Number.isFinite(x) && x > 0)
          : [77, 100, 333],
        scoringMode: data.sigMatchSettings?.scoringMode === "amount" ? "amount" : "count",
        incentivePerPoint: Number.isFinite(data.sigMatchSettings?.incentivePerPoint)
          ? Math.max(0, Math.floor(data.sigMatchSettings!.incentivePerPoint))
          : 1000,
        sigMatchPools: normalizeSigMatchPools(data.sigMatchSettings?.sigMatchPools, validSigMemberIdsApi),
        participantMemberIds: normalizeSigMatchParticipantIds(
          (data as AppState).sigMatchSettings?.participantMemberIds,
          validSigMemberIdsApi
        ),
      };
      data.rouletteState = normalizeRouletteState((data as AppState).rouletteState);
      data.mealMatchSettings = normalizeMealMatchSettings((data as AppState).mealMatchSettings);
      data.sigMatchTimer = normalizeTimerState((data as AppState).sigMatchTimer);
      data.mealMatchTimer = normalizeTimerState((data as AppState).mealMatchTimer);
      data.sigSalesTimer = normalizeTimerState((data as AppState).sigSalesTimer);
      data.generalTimer = normalizeTimerState((data as AppState).generalTimer);
      data.matchTimerEnabled = normalizeMatchTimerEnabled((data as AppState).matchTimerEnabled);
      data.timerDisplayStyles = normalizeTimerDisplayStyles((data as AppState).timerDisplayStyles);
      data.donorRankingsOverlayConfig = normalizeDonorRankingsOverlayConfig((data as AppState).donorRankingsOverlayConfig);
      data.donationListsOverlayConfig = normalizeDonationListsOverlayConfig((data as AppState).donationListsOverlayConfig);
      data.overlayPresets = Array.isArray(data.overlayPresets)
        ? data.overlayPresets
        : Array.isArray(data.overlaySettings?.presets)
          ? data.overlaySettings?.presets
          : [];
      return data as AppState;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 여러 브라우저/탭이 동시에 저장할 때 오래된 탭이 후원 목록을 덮어쓰는 것을 완화합니다.
 * - incoming에 서버에 없던 새 후원 id가 있으면 기존과 id 기준 병합(최신 at 우선).
 * - incoming이 기존 id의 부분집합이고 비율이 절반 이하이면, 누락분을 서버(existing)에서 채움(스테일 탭).
 * - 그 외(삭제·소량 삭제 등)는 incoming을 그대로 반영합니다.
 */
export function mergeDonorsForMultiTabSave(incoming: Donor[], existing: Donor[] | undefined): Donor[] {
  if (!existing || existing.length === 0) return incoming;
  if (incoming.length === 0) return [];
  const existingIds = new Set(existing.map((d) => d.id));
  const hasNewInIncoming = incoming.some((d) => !existingIds.has(d.id));
  if (hasNewInIncoming) {
    const map = new Map<string, Donor>();
    for (const d of existing) map.set(d.id, d);
    for (const d of incoming) {
      const prev = map.get(d.id);
      if (!prev || d.at >= prev.at) map.set(d.id, d);
    }
    return Array.from(map.values()).sort((a, b) => b.at - a.at);
  }
  const subset = incoming.every((d) => existingIds.has(d.id));
  if (!subset) return incoming;
  const ratio = incoming.length / existing.length;
  if (incoming.length < existing.length && ratio <= 0.5) {
    const map = new Map<string, Donor>();
    for (const d of incoming) map.set(d.id, d);
    for (const d of existing) {
      if (!map.has(d.id)) map.set(d.id, d);
    }
    return Array.from(map.values()).sort((a, b) => b.at - a.at);
  }
  return incoming;
}

export function totalAccount(state: AppState): number {
  return state.members.reduce((sum, m) => sum + (m.account || 0), 0);
}

export function totalToon(state: AppState): number {
  return state.members.reduce((sum, m) => sum + (m.toon || 0), 0);
}

export function totalCombined(state: AppState): number {
  return totalAccount(state) + totalToon(state);
}

/** 서버/동기화 시 기본값으로 덮어쓰기 방지: remote가 기본 상태처럼 보이는지 확인 */
export function isDefaultLikeState(state: AppState): boolean {
  const def = defaultMembers();
  const m = state.members || [];
  if (m.length !== def.length) return false;
  const allDefaultNames = m.every((mm, i) => mm.id === def[i].id && mm.name === def[i].name);
  const noData = totalCombined(state) === 0 && (!state.donors || state.donors.length === 0);
  return allDefaultNames && noData;
}

export function formatManThousand(n: number): string {
  const safe = Math.max(0, Math.round(n / 1000) * 1000);
  const man = Math.floor(safe / 10000);
  const thousandDigit = Math.floor((safe % 10000) / 1000);
  return thousandDigit ? `${man}.${thousandDigit}` : `${man}`;
}

export function formatChatLine(state: AppState): string {
  const members = state.members
    .map((m) => `${m.name}${formatManThousand(m.account)}(${formatManThousand(m.toon)})`)
    .join(",");
  const accAgg = new Map<string, number>();
  for (const d of state.donors) {
    if ((d.target || "account") === "toon") continue;
    accAgg.set(d.name, (accAgg.get(d.name) || 0) + d.amount);
  }
  const accPairs = Array.from(accAgg.entries()).map(([name, amt]) => `${String(name).replace(/\s+/g, "")}${formatManThousand(amt)}`);
  const accStr = accPairs.length ? ` 후원:${accPairs.join(",")}` : "";
  const total = totalAccount(state);
  return `${members}${accStr} 총합:${formatManThousand(total)}`
    .replace(/\s+,/g, ",")
    .replace(/,\s+/g, ",")
    .trim();
}

export function todaysDateKey(d = new Date()): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

export function appendDailyLog(snapshot: AppState, userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const storageKeyForLog = dailyLogStorageKey(userId);
    const raw = window.localStorage.getItem(storageKeyForLog);
    const logs = raw ? (JSON.parse(raw) as Record<string, unknown[]>) : {};
    const dateKey = todaysDateKey();
    const entry = {
      at: new Date().toISOString(),
      total: totalAccount(snapshot),
      members: snapshot.members,
      donors: snapshot.donors,
    };
    if (!logs[dateKey]) logs[dateKey] = [];
    (logs[dateKey] as unknown[]).push(entry);
    const merged = JSON.stringify(logs);
    window.localStorage.setItem(storageKeyForLog, merged);
    // 서버에 동기화: 기존 서버 데이터와 병합 후 저장 (실패 시 로컬만 유지)
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const baseUrl = q.toString() ? `/api/daily-log?${q.toString()}` : "/api/daily-log";
    fetch(baseUrl, { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((serverLog: Record<string, unknown[]> | null) => {
        let toSave: Record<string, unknown[]>;
        if (serverLog && typeof serverLog === "object") {
          toSave = { ...serverLog };
          if (!toSave[dateKey]) toSave[dateKey] = [];
          (toSave[dateKey] as unknown[]).push(entry);
        } else {
          toSave = JSON.parse(merged) as Record<string, unknown[]>;
        }
        return fetch(baseUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(toSave),
        });
      })
      .catch(() => {});
  } catch {
    // ignore
  }
}

export type DailyLogEntry = {
  at: string;
  total: number;
  members: Member[];
  donors: Donor[];
};

export function loadDailyLog(userId?: string | null): Record<string, DailyLogEntry[]> {
  if (typeof window === "undefined") return {};
  try {
    let raw = window.localStorage.getItem(dailyLogStorageKey(userId));
    if (!raw && userId) {
      raw = window.localStorage.getItem(DAILY_LOG_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, DailyLogEntry[]>;
        if (parsed && typeof parsed === "object" && Object.keys(parsed).length > 0) {
          window.localStorage.setItem(dailyLogStorageKey(userId), raw);
          return parsed;
        }
      }
    }
    return raw ? (JSON.parse(raw) as Record<string, DailyLogEntry[]>) : {};
  } catch {
    return {};
  }
}

export async function loadDailyLogFromApi(userId?: string | null): Promise<Record<string, DailyLogEntry[]>> {
  if (typeof window === "undefined") return {};
  try {
    const q = new URLSearchParams({ _t: String(Date.now()) });
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/daily-log?${q.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (data && typeof data === "object") return data as Record<string, DailyLogEntry[]>;
    return {};
  } catch {
    return {};
  }
}

export function clearDailyLog(userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(dailyLogStorageKey(userId));
  } catch {
    // ignore
  }
}

export type ForbidEvent = { at: number; author: string; message: string; word: string };
export function appendForbidEvent(ev: ForbidEvent) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(FORBID_EVENTS_KEY);
    const arr: ForbidEvent[] = raw ? JSON.parse(raw) : [];
    arr.unshift(ev);
    const next = arr.slice(0, 200);
    window.localStorage.setItem(FORBID_EVENTS_KEY, JSON.stringify(next));
  } catch {}
}

export function loadForbidEvents(): ForbidEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FORBID_EVENTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function confirmHighAmount(amount: number): boolean {
  if (amount >= 1_000_000) {
    return typeof window !== "undefined"
      ? window.confirm("정말 이 금액이 맞습니까?")
      : false;
  }
  return true;
}
