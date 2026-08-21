import type {
  AppState,
  Donor,
  HighSocietyFxSettings,
  HighSocietyPushDir,
  HighSocietySettings,
  Member,
  TerritoryLog,
} from "@/types";
import {
  aggregateSeatPushesFromTerritoryLogs,
  mergeHighSocietyPlayerPushInputs,
} from "@/lib/territory-utils";

/** 상류사회 영토 바·미니맵용 세그먼트 (후원 합계 비율 — 레거시/보조 스타일) */
export type HighSocietyTerritorySlice = {
  id: string;
  name: string;
  amount: number;
  pct: number;
  color: string;
};

export type HighSocietyZone = {
  id: string;
  label: string;
  ownerName: string | null;
  color: string;
};

export type HighSocietySeatLetter = string;

/** 룰 기반 좌석(장벽 안 · 좌→우 순서, N등분) */
export type HighSocietySeat = {
  /** 좌석 인덱스 0..N-1 (표시용 레거시 라벨에도 사용) */
  letter: HighSocietySeatLetter;
  seatIndex: number;
  id: string;
  name: string;
  /** 라운드 후원(원) — 1만원 미만 버림 전 원본 */
  donationWon: number;
  /** 확장 합(cm) */
  expandCm: number;
  expandLeftCm: number;
  expandRightCm: number;
  /** 현재 가로 영토(cm) — 시작은 fieldCm/N */
  widthCm: number;
  /** 전장 대비 점유율(%) */
  pct: number;
  color: string;
  /** 영토 0 → 방석 */
  eliminated: boolean;
  expandDir: "right" | "both" | "left";
};

export type HighSocietyPushSplit = {
  /** 레거시 4인 B 좌측 비율 */
  bLeft: number;
  /** 레거시 4인 C 좌측 비율 */
  cLeft: number;
};

export type HighSocietySeatRole = {
  index: number;
  /** 가운데 좌석이면 좌/우 선택 가능 */
  canChoosePush: boolean;
  expandDir: "right" | "both" | "left";
};

const TERRITORY_COLORS = [
  "linear-gradient(90deg, #6b4e12 0%, #d4af37 100%)",
  "linear-gradient(90deg, #1e3a5f 0%, #3b82f6 100%)",
  "linear-gradient(90deg, #4a1942 0%, #c026d3 100%)",
  "linear-gradient(90deg, #14532d 0%, #22c55e 100%)",
  "linear-gradient(90deg, #7c2d12 0%, #f97316 100%)",
  "linear-gradient(90deg, #312e81 0%, #818cf8 100%)",
  "linear-gradient(90deg, #831843 0%, #fb7185 100%)",
  "linear-gradient(90deg, #134e4a 0%, #2dd4bf 100%)",
];

/** 룰: 1만원 정확히 배수만 5cm — 천원 자리가 있으면 영토 미적용 */
export const HIGH_SOCIETY_WON_PER_UNIT = 10_000;
export const HIGH_SOCIETY_CM_PER_UNIT = 5;
/** 기본 1인 시작 cm (4명 가정 시 전장 1200cm) */
export const HIGH_SOCIETY_DEFAULT_FIELD_CM = 1200;
/** 참가 인원 상한 */
export const HIGH_SOCIETY_MAX_SEATS = 8;

export const HIGH_SOCIETY_SEAT_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#ea580c",
] as const;

/** @deprecated 4인 고정 라벨 — 하위 호환 */
export const HIGH_SOCIETY_SEAT_LETTERS: HighSocietySeatLetter[] = ["A", "B", "C", "D"];

export function seatIndexLabel(index: number): string {
  if (index >= 0 && index < 26) return String.fromCharCode(65 + index);
  return String(index + 1);
}

export function seatExpandDirForIndex(index: number, count: number): "right" | "both" | "left" {
  if (count <= 1) return "both";
  if (index <= 0) return "right";
  if (index >= count - 1) return "left";
  return "both";
}

export const HIGH_SOCIETY_TEST_MEMBERS: Array<
  Pick<Member, "id" | "name" | "account" | "toon" | "operating">
> = [
  { id: "hs1", name: "금수저", account: 320000, toon: 0, operating: false },
  { id: "hs2", name: "은수저", account: 180000, toon: 0, operating: false },
  { id: "hs3", name: "동수저", account: 90000, toon: 0, operating: false },
  { id: "hs4", name: "흑수저", account: 50000, toon: 0, operating: false },
];

function memberTotal(m: Pick<Member, "account" | "toon">): number {
  return Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0));
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

/**
 * 상류사회 확장 cm.
 * - 1만원 정확히 배수만 인정 (1만원 = 5cm)
 * - 천원 자리가 있으면 영토 미적용 (예: 1만9천원 → 0cm)
 * - 예: 10,000원 → 5cm / 20,000원 → 10cm / 10,900원 → 0cm / 26,000원 → 0cm
 */
export function donationToExpandCm(won: number): number {
  const v = Math.max(0, Math.floor(Number(won) || 0));
  if (v === 0 || v % HIGH_SOCIETY_WON_PER_UNIT !== 0) return 0;
  const units = v / HIGH_SOCIETY_WON_PER_UNIT;
  return units * HIGH_SOCIETY_CM_PER_UNIT;
}

/** 1만원 정확 배수만 영토 확장·집계 대상 (천원 자리·0원은 false) */
export function isDonationAmountEligibleForHighSocietyTerritory(amount: number): boolean {
  return donationToExpandCm(amount) > 0;
}

export type HighSocietyZeroCmGaugeDisplay = "hidden" | "0cm" | "00cm";

export function normalizeZeroCmGaugeDisplay(raw: unknown): HighSocietyZeroCmGaugeDisplay {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "0cm" || v === "0") return "0cm";
  if (v === "00cm" || v === "00" || v === "pad" || v === "zero-pad") return "00cm";
  return "hidden";
}

export function shouldShowZeroCmSeatsOnGauge(
  display: HighSocietyZeroCmGaugeDisplay | undefined
): boolean {
  return normalizeZeroCmGaugeDisplay(display) !== "hidden";
}

/** 좌석 width 표시 — 0cm일 때 zeroCmGaugeDisplay 에 따라 0cm / 00cm */
export function formatSeatWidthCm(
  widthCm: number,
  zeroDisplay?: HighSocietyZeroCmGaugeDisplay | null
): string {
  const v = Math.max(0, Math.round(widthCm));
  const mode = normalizeZeroCmGaugeDisplay(zeroDisplay);
  if (v === 0 && mode === "00cm") return "00cm";
  if (v === 0 && mode === "0cm") return "0cm";
  return formatCm(v);
}

export function formatCm(cm: number): string {
  const v = Math.max(0, Math.round(cm));
  return `${v.toLocaleString("ko-KR")}cm`;
}

export function parseHighSocietyPushDir(raw: unknown): HighSocietyPushDir | null {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "left" || v === "l" || v === "←") return "left";
  if (v === "right" || v === "r" || v === "→") return "right";
  if (v === "split" || v === "both" || v === "↔" || v === "half") return "split";
  return null;
}

export function pushDirToLeftRight(
  cm: number,
  dir: HighSocietyPushDir
): { left: number; right: number } {
  const v = Math.max(0, cm);
  if (dir === "left") return { left: v, right: 0 };
  if (dir === "right") return { left: 0, right: v };
  const half = v / 2;
  return { left: half, right: half };
}

export type HighSocietyTerritoryUpdateMode = "realtime" | "onRoundEnd";

export function parseHighSocietyTerritoryUpdateMode(
  raw: unknown
): HighSocietyTerritoryUpdateMode {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "onroundend" || v === "on_round_end" || v === "end" || v === "round") {
    return "onRoundEnd";
  }
  return "realtime";
}

export function defaultHighSocietyFxSettings(): HighSocietyFxSettings {
  return {
    frontier: false,
    growFlash: false,
    contestedEdge: false,
    arrowBlade: false,
    strongOutline: false,
  };
}

export function normalizeHighSocietyFxSettings(input: unknown): HighSocietyFxSettings {
  const base = defaultHighSocietyFxSettings();
  if (!input || typeof input !== "object") return base;
  const v = input as Partial<HighSocietyFxSettings>;
  return {
    frontier: v.frontier === true,
    growFlash: v.growFlash === true,
    contestedEdge: v.contestedEdge === true,
    arrowBlade: v.arrowBlade === true,
    strongOutline: v.strongOutline === true,
  };
}

/** 관리자 iframe 미리보기 — 연출 토글을 URL로 즉시 반영 (5자리 0/1) */
export function highSocietyFxToHsFxParam(fx: HighSocietyFxSettings | null | undefined): string {
  const n = normalizeHighSocietyFxSettings(fx);
  return [
    n.frontier ? "1" : "0",
    n.growFlash ? "1" : "0",
    n.contestedEdge ? "1" : "0",
    n.arrowBlade ? "1" : "0",
    n.strongOutline ? "1" : "0",
  ].join("");
}

export function parseHighSocietyFxFromHsFxParam(raw: string | null | undefined): HighSocietyFxSettings | null {
  const s = String(raw || "").trim();
  if (s.length < 5) return null;
  const bits = s.slice(0, 5).split("");
  return {
    frontier: bits[0] === "1",
    growFlash: bits[1] === "1",
    contestedEdge: bits[2] === "1",
    arrowBlade: bits[3] === "1",
    strongOutline: bits[4] === "1",
  };
}

export function normalizeHighSocietyDonationLinks(
  raw: unknown,
  validMemberIds?: Set<string>
): Record<string, { active: boolean; startedAt?: number }> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, { active: boolean; startedAt?: number }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const linkActive = Boolean(o.active);
    const inSeat = !validMemberIds || validMemberIds.has(id);
    const active = inSeat && linkActive;
    const startedRaw = Number(o.startedAt);
    const startedAt = Number.isFinite(startedRaw) ? Math.max(0, Math.floor(startedRaw)) : undefined;
    out[id] = active
      ? { active: true, ...(startedAt !== undefined ? { startedAt } : {}) }
      : { active: false, ...(startedAt !== undefined ? { startedAt } : {}) };
  }
  return out;
}

function normalizeMemberWidthRecord(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(id || "").trim();
    const n = Number(v);
    if (key && Number.isFinite(n) && n >= 0) out[key] = Math.round(n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeMemberDonationSnapshotRecord(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, number> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(id || "").trim();
    const n = Math.max(0, Math.round(Number(v) || 0));
    if (key) out[key] = n;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeMemberTerritoryExpandRecord(
  raw: unknown
): Record<string, { expandLeftCm: number; expandRightCm: number }> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, { expandLeftCm: number; expandRightCm: number }> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(id || "").trim();
    if (!key || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[key] = {
      expandLeftCm: Math.max(0, Math.round(Number(o.expandLeftCm) || 0)),
      expandRightCm: Math.max(0, Math.round(Number(o.expandRightCm) || 0)),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeSeatIdList(ids: string[] | null | undefined): string[] {
  return (ids || []).map((id) => String(id || "").trim()).filter(Boolean);
}

function seatMemberIdMultisetEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const count = new Map<string, number>();
  for (const id of a) count.set(id, (count.get(id) || 0) + 1);
  for (const id of b) {
    const n = count.get(id);
    if (!n) return false;
    if (n === 1) count.delete(id);
    else count.set(id, n - 1);
  }
  return count.size === 0;
}

/** seatMemberIds 비어 있으면 로스터(전원) 순서로 간주 — seatMemberIdsManual=true 는 예외(빈 좌석) */
export function isHighSocietySeatSelectionManual(
  settings: Pick<HighSocietySettings, "seatMemberIds" | "seatMemberIdsManual">
): boolean {
  if ((settings.seatMemberIds || []).length > 0) return true;
  return settings.seatMemberIdsManual === true;
}

export type HighSocietySeatSelection = Pick<
  HighSocietySettings,
  "seatMemberIds" | "seatMemberIdsManual"
>;

function normalizeHighSocietySeatSelectionInput(
  selection?: string[] | null | HighSocietySeatSelection
): HighSocietySeatSelection | null {
  if (selection === null || selection === undefined) return null;
  if (Array.isArray(selection)) {
    return { seatMemberIds: selection, seatMemberIdsManual: selection.length > 0 };
  }
  return {
    seatMemberIds: selection.seatMemberIds || [],
    seatMemberIdsManual: selection.seatMemberIdsManual,
  };
}

/** seatMemberIds 비어 있으면 로스터(전원) 순서로 간주 */
export function effectiveHighSocietySeatOrder(
  seatMemberIds: string[] | null | undefined,
  rosterMemberIds: string[],
  manual?: boolean
): string[] {
  const explicit = normalizeSeatIdList(seatMemberIds);
  if (manual === true || explicit.length > 0) return explicit;
  return normalizeSeatIdList(rosterMemberIds);
}

/** donationLinks 없으면 하위호환 ON(전체 기간) */
export function resolveHighSocietyDonationLink(
  settings: Pick<HighSocietySettings, "donationLinks"> | null | undefined,
  memberId: string
): { active: boolean; startedAt: number } {
  const link = settings?.donationLinks?.[memberId];
  if (!link) return { active: true, startedAt: 0 };
  return {
    active: Boolean(link.active),
    startedAt: Number.isFinite(Number(link.startedAt))
      ? Math.max(0, Math.floor(Number(link.startedAt)))
      : 0,
  };
}

function highSocietyDonorAtMs(d: Pick<Donor, "at">): number {
  return Number.isFinite(Number(d.at)) ? Math.max(0, Math.floor(Number(d.at))) : 0;
}

export function defaultHighSocietySettings(): HighSocietySettings {
  return {
    enabled: false,
    seatMemberIds: [],
    donationLinks: {},
    /** 시스템 기본: 가운데도 한쪽(오른쪽)만 */
    defaultMiddlePush: "right",
    defaultBPush: "right",
    defaultCPush: "right",
    barStyle: "flat",
    round: 1,
    fieldCm: HIGH_SOCIETY_DEFAULT_FIELD_CM,
    startCmPerMember: Math.round(HIGH_SOCIETY_DEFAULT_FIELD_CM / 4),
    territoryUpdateMode: "realtime",
    fx: defaultHighSocietyFxSettings(),
  };
}

/** 초기값과 동일(영토·좌석·라운드 이력 없음) */
export function isDefaultLikeHighSocietySettings(
  settings: HighSocietySettings | null | undefined
): boolean {
  const s = normalizeHighSocietySettings(settings);
  const def = defaultHighSocietySettings();
  if (s.enabled) return false;
  if (Number(s.territoryCutoffAt || 0) > 0) return false;
  if (Number(s.territoryReopenAt || 0) > 0) return false;
  if (s.territoryPaused) return false;
  if ((s.seatMemberIds || []).length > 0) return false;
  if (s.seatMemberIdsManual === true) return false;
  if (Math.max(1, Math.floor(Number(s.round) || 1)) > 1) return false;
  if (Math.floor(Number(s.fieldCm) || 0) !== def.fieldCm) return false;
  if (Math.floor(Number(s.startCmPerMember) || 0) !== def.startCmPerMember) return false;
  const links = s.donationLinks || {};
  if (Object.values(links).some((l) => l?.active)) return false;
  return true;
}

/** ON·영토 이력·좌석·라운드 등 운영 중인 상류사회 설정 */
export function isMeaningfulHighSocietySettings(
  settings: HighSocietySettings | null | undefined
): boolean {
  const s = normalizeHighSocietySettings(settings);
  if (s.enabled) return true;
  if (Number(s.territoryCutoffAt || 0) > 0) return true;
  if (Number(s.territoryReopenAt || 0) > 0) return true;
  if (s.territoryPaused) return true;
  if ((s.seatMemberIds || []).length > 0) return true;
  if (s.seatMemberIdsManual === true) return true;
  if (Math.max(1, Math.floor(Number(s.round) || 1)) > 1) return true;
  const def = defaultHighSocietySettings();
  if (Math.floor(Number(s.fieldCm) || 0) !== def.fieldCm) return true;
  if (Math.floor(Number(s.startCmPerMember) || 0) !== def.startCmPerMember) return true;
  return false;
}

/** 시그·테마 PATCH 등이 구 상류사회 설정을 기본값으로 덮지 않게 */
export function shouldBlockHighSocietyRegression(
  base: HighSocietySettings | null | undefined,
  patch: HighSocietySettings | null | undefined
): boolean {
  if (!isMeaningfulHighSocietySettings(base)) return false;
  return isDefaultLikeHighSocietySettings(patch);
}

function hasMemberWidthSnapshot(
  settings: HighSocietySettings | null | undefined
): boolean {
  const widths = settings?.memberWidthCm;
  return Boolean(widths && Object.keys(widths).length > 0);
}

/**
 * OBS·오버레이 sync — 후원 GET/SSE 직후 HS 가 기본값·스냅샷 누락으로 덮이지 않게.
 * donors/members 는 건드리지 않고 highSocietySettings 만 병합한다.
 */
export function mergeHighSocietySettingsPreferBaseline(
  baseline: HighSocietySettings | null | undefined,
  incoming: HighSocietySettings | null | undefined
): HighSocietySettings {
  const base = baseline ? normalizeHighSocietySettings(baseline) : null;
  const inc = normalizeHighSocietySettings(incoming);
  if (!base || !isMeaningfulHighSocietySettings(base)) return inc;
  if (shouldBlockHighSocietyRegression(base, inc)) return base;
  if (hasMemberWidthSnapshot(base) && !hasMemberWidthSnapshot(inc)) {
    return normalizeHighSocietySettings({
      ...inc,
      memberWidthCm: base.memberWidthCm,
      memberWidthDonationSnapshot:
        base.memberWidthDonationSnapshot ?? inc.memberWidthDonationSnapshot,
      memberTerritoryExpand: base.memberTerritoryExpand ?? inc.memberTerritoryExpand,
    });
  }
  return inc;
}

/** 시스템 기본 방향 — split 불가, left|right 만 */
export function resolveSystemMiddlePushDir(
  settings: Pick<HighSocietySettings, "defaultMiddlePush" | "defaultBPush" | "defaultCPush">
): "left" | "right" {
  const raw =
    parseHighSocietyPushDir(settings.defaultMiddlePush) ||
    parseHighSocietyPushDir(settings.defaultBPush) ||
    parseHighSocietyPushDir(settings.defaultCPush) ||
    "right";
  return raw === "left" ? "left" : "right";
}

export function normalizeTerritoryPauseExcludeWindows(
  raw: unknown
): NonNullable<HighSocietySettings["territoryPauseExcludeWindows"]> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ from: number; to: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const from = Math.floor(Number((item as { from?: number }).from) || 0);
    const to = Math.floor(Number((item as { to?: number }).to) || 0);
    if (from > 0 && to > from) out.push({ from, to });
  }
  return out;
}

export function normalizeHighSocietySettings(input: unknown): HighSocietySettings {
  const base = defaultHighSocietySettings();
  const v = input && typeof input === "object" ? (input as Partial<HighSocietySettings>) : {};
  const seatsRaw = Array.isArray(v.seatMemberIds) ? v.seatMemberIds : [];
  const seatMemberIds = seatsRaw
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, HIGH_SOCIETY_MAX_SEATS);
  const middle = resolveSystemMiddlePushDir({
    defaultMiddlePush: (v.defaultMiddlePush as HighSocietyPushDir) || base.defaultMiddlePush,
    defaultBPush: v.defaultBPush as HighSocietyPushDir | undefined,
    defaultCPush: v.defaultCPush as HighSocietyPushDir | undefined,
  });
  const bar = v.barStyle === "arrow" ? "arrow" : "flat";
  const round = Math.max(1, Math.min(99, Math.floor(Number(v.round) || 1)));
  const fieldCmRaw = Math.max(100, Math.min(20000, Math.floor(Number(v.fieldCm) || HIGH_SOCIETY_DEFAULT_FIELD_CM)));
  const seatCountForStart = resolveHighSocietySeatCountForField({
    seatMemberIds,
    seatMemberIdsManual: v.seatMemberIdsManual === true,
  });
  const startCmRaw = Number(v.startCmPerMember);
  const startCmPerMember =
    Number.isFinite(startCmRaw) && startCmRaw > 0
      ? Math.max(1, Math.min(5000, Math.floor(startCmRaw)))
      : Math.max(1, Math.round(fieldCmRaw / seatCountForStart));
  /** startCmPerMember 정본 — fieldCm 과 어긋나면 맞춤(구 데이터·OFF 후 300cm 회귀 방지) */
  const fieldCm = Math.max(100, Math.min(20000, fieldCmFromStartPerMember(startCmPerMember, seatCountForStart)));
  const territoryUpdateMode = parseHighSocietyTerritoryUpdateMode(v.territoryUpdateMode);
  const fx = normalizeHighSocietyFxSettings(v.fx);
  const donationLinksRaw = v.donationLinks;
  const donationLinks =
    donationLinksRaw && typeof donationLinksRaw === "object" && !Array.isArray(donationLinksRaw)
      ? (donationLinksRaw as HighSocietySettings["donationLinks"])
      : {};
  const cutoffRaw = Number(v.territoryCutoffAt);
  const territoryCutoffAt =
    Number.isFinite(cutoffRaw) && cutoffRaw > 0 ? Math.floor(cutoffRaw) : undefined;
  const reopenRaw = Number(v.territoryReopenAt);
  const territoryReopenAt =
    Number.isFinite(reopenRaw) && reopenRaw > 0 ? Math.floor(reopenRaw) : undefined;
  const territoryPaused = Boolean(v.territoryPaused);
  const pausedAtRaw = Number(v.territoryPausedAt);
  const territoryPausedAt =
    Number.isFinite(pausedAtRaw) && pausedAtRaw > 0 ? Math.floor(pausedAtRaw) : undefined;
  const territoryPauseExcludeWindows = normalizeTerritoryPauseExcludeWindows(
    v.territoryPauseExcludeWindows
  );
  const syncBeforePauseRaw = v.donationSyncModeBeforePause;
  const donationSyncModeBeforePause =
    syncBeforePauseRaw === "none" ||
    syncBeforePauseRaw === "mealBattle" ||
    syncBeforePauseRaw === "sigMatch" ||
    syncBeforePauseRaw === "sigSales" ||
    syncBeforePauseRaw === "highSociety"
      ? syncBeforePauseRaw
      : undefined;
  const memberWidthCm = normalizeMemberWidthRecord(v.memberWidthCm);
  const memberWidthDonationSnapshot = normalizeMemberDonationSnapshotRecord(v.memberWidthDonationSnapshot);
  const memberTerritoryExpand = normalizeMemberTerritoryExpandRecord(v.memberTerritoryExpand);
  const zeroCmGaugeDisplay = normalizeZeroCmGaugeDisplay(v.zeroCmGaugeDisplay);
  return {
    enabled: Boolean(v.enabled),
    seatMemberIds,
    ...(v.seatMemberIdsManual === true ? { seatMemberIdsManual: true } : {}),
    defaultMiddlePush: middle,
    defaultBPush: middle,
    defaultCPush: middle,
    barStyle: bar,
    round,
    fieldCm,
    startCmPerMember,
    territoryUpdateMode,
    fx,
    donationLinks: donationLinks || {},
    ...(territoryCutoffAt !== undefined ? { territoryCutoffAt } : {}),
    ...(territoryReopenAt !== undefined ? { territoryReopenAt } : {}),
    ...(territoryPaused ? { territoryPaused: true } : {}),
    ...(territoryPaused && territoryPausedAt !== undefined ? { territoryPausedAt } : {}),
    ...(territoryPauseExcludeWindows.length > 0 ? { territoryPauseExcludeWindows } : {}),
    ...(donationSyncModeBeforePause !== undefined ? { donationSyncModeBeforePause } : {}),
    ...(memberWidthCm ? { memberWidthCm } : {}),
    ...(memberWidthDonationSnapshot ? { memberWidthDonationSnapshot } : {}),
    ...(memberTerritoryExpand ? { memberTerritoryExpand } : {}),
    ...(zeroCmGaugeDisplay !== "hidden" ? { zeroCmGaugeDisplay } : {}),
  };
}

/** OFF 직전까지 한 번이라도 ON이었는지(재ON vs 최초 ON 구분) */
export function isHighSocietyReopen(prevSettings: HighSocietySettings): boolean {
  const offAt = Number(prevSettings.territoryCutoffAt);
  return Number.isFinite(offAt) && offAt > 0;
}

/** @deprecated 영토 일시정지는 영토만 동결 — 후원 ingest 는 차단하지 않음. 하위호환용 false 고정 */
export function isHighSocietyDonationIngestPaused(
  _state: Pick<AppState, "highSocietySettings"> | null | undefined
): boolean {
  return false;
}

function isDonorInTerritoryPauseExcludeWindows(
  atMs: number,
  settings: HighSocietySettings
): boolean {
  for (const w of normalizeTerritoryPauseExcludeWindows(settings.territoryPauseExcludeWindows)) {
    if (atMs >= w.from && atMs < w.to) return true;
  }
  return false;
}

/**
 * 영토 일시정지/재개 토글 시 settings patch — 재개 시 구간을 territoryPauseExcludeWindows 에 누적.
 */
export function buildTerritoryPauseToggleSettingsPatch(
  patch: { territoryPaused?: boolean },
  prev: HighSocietySettings,
  now = Date.now()
): Partial<HighSocietySettings> {
  if (typeof patch.territoryPaused !== "boolean") return {};
  if (patch.territoryPaused && !prev.territoryPaused) {
    return { territoryPausedAt: Math.floor(now) };
  }
  if (!patch.territoryPaused && prev.territoryPaused) {
    const pausedAt = Math.floor(Number(prev.territoryPausedAt) || 0);
    const windows = normalizeTerritoryPauseExcludeWindows(prev.territoryPauseExcludeWindows);
    if (pausedAt > 0 && now > pausedAt) {
      windows.push({ from: pausedAt, to: Math.floor(now) });
    }
    return {
      territoryPausedAt: undefined,
      territoryPauseExcludeWindows: windows,
    };
  }
  return {};
}

/**
 * 후원 행이 상류사회 영토 집계에 포함되는지.
 * - 완전 수동: 후원 리스트「영토 ON」(`hsTerritoryExcluded === false`)만 반영
 * - OFF: OFF 시각 이전·명시 ON 후원만 동결 유지
 * - 일시정지: 진행 중·재개 후 completed windows 구간 후원은 영토 제외(합산은 유지)
 */
export function shouldDonorCountForHighSocietyTerritory(
  d: Pick<Donor, "amount" | "donationExcluded" | "hsTerritoryExcluded" | "at">,
  settings: HighSocietySettings,
  link: { active: boolean; startedAt?: number }
): boolean {
  /** 완전 수동 — ON 상태에서는 후원 리스트「영토 ON」만 집계 (donationLinks·startedAt 무시) */
  if (!settings.enabled) {
    if (!link.active) return false;
  }
  if (!isDonorHsTerritoryIncluded(d)) return false;
  if (d.donationExcluded === true) return false;
  if (Math.max(0, Number(d.amount) || 0) <= 0) return false;
  if (!isDonationAmountEligibleForHighSocietyTerritory(d.amount)) return false;

  const at = highSocietyDonorAtMs(d);

  if (isDonorInTerritoryPauseExcludeWindows(at, settings)) return false;

  const pausedAtRaw = Number(settings.territoryPausedAt);
  const pausedAt =
    settings.territoryPaused && Number.isFinite(pausedAtRaw) && pausedAtRaw > 0
      ? Math.floor(pausedAtRaw)
      : null;
  if (pausedAt && at >= pausedAt) return false;

  if (!settings.enabled) {
    const lastOffAtRaw = Number(settings.territoryCutoffAt);
    const lastOffAt = Number.isFinite(lastOffAtRaw) && lastOffAtRaw > 0 ? Math.floor(lastOffAtRaw) : null;
    /** cutoff 없으면 OFF 이후 후원이 영토에 섞이지 않게 집계 제외 */
    if (!lastOffAt) return false;
    return at < lastOffAt;
  }

  return true;
}

/** admin patch — 영토만 새 라운드(집계 시작 시점). donors/members 와 분리 */
export type HighSocietySettingsAdminPatch = Partial<HighSocietySettings> & {
  resetTerritory?: boolean;
};

function seatMemberIdsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((id, i) => String(id) === String(b[i]));
}

/** 좌석 멤버 집합은 같고 순서만 바뀐 경우 (자동 좌석→첫 이동 포함) */
export function isSeatMemberIdsReorderOnly(
  a: string[],
  b: string[],
  rosterMemberIds?: string[]
): boolean {
  const roster = normalizeSeatIdList(rosterMemberIds);
  const prev = effectiveHighSocietySeatOrder(a, roster);
  const next = effectiveHighSocietySeatOrder(b, roster);
  if (prev.length === 0 || next.length === 0) return false;
  if (prev.length !== next.length) return false;
  if (seatMemberIdsEqual(prev, next)) return false;
  return seatMemberIdMultisetEqual(prev, next);
}

/** 스냅샷·영토 폭을 유지할 좌석 변경인지 — 0cm 탈락 멤버 추가·제거·재배치는 초기화하지 않음 */
export function shouldClearMemberWidthSnapshotOnSeatChange(opts: {
  prevSettings: HighSocietySettings;
  nextSettings: HighSocietySettings;
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>;
  donors?: Array<Pick<Donor, "memberId" | "amount" | "hsPushDir" | "donationExcluded" | "hsTerritoryExcluded" | "at">>;
}): boolean {
  const { prevSettings, nextSettings, members } = opts;
  const roster = resolveHighSocietySeatMembers(members, null).map((s) => s.id);
  const prevOrder = effectiveHighSocietySeatOrder(
    prevSettings.seatMemberIds,
    roster,
    prevSettings.seatMemberIdsManual
  );
  const nextOrder = effectiveHighSocietySeatOrder(
    nextSettings.seatMemberIds,
    roster,
    nextSettings.seatMemberIdsManual
  );
  if (seatMemberIdsEqual(prevOrder, nextOrder)) return false;
  if (isSeatMemberIdsReorderOnly(prevSettings.seatMemberIds || [], nextSettings.seatMemberIds || [], roster)) {
    return false;
  }
  const prevField = buildHighSocietyFieldFromAppState({
    members,
    donors: (opts.donors ?? []) as Donor[],
    highSocietySettings: prevSettings,
  });
  const widthById = new Map(prevField.seats.map((s) => [s.id, s.widthCm]));
  const nextSet = new Set(nextOrder);
  for (const id of prevOrder) {
    if (!nextSet.has(id) && (widthById.get(id) ?? 0) > 0) return true;
  }
  return false;
}

function isHighSocietyMemberWidthEliminatedInSnapshot(
  settings: Pick<HighSocietySettings, "memberWidthCm">,
  memberId: string
): boolean {
  const snap = settings.memberWidthCm?.[memberId];
  return snap != null && snap <= 0;
}

/**
 * 상류사회 설정 저장·ON/OFF·영토 초기화 시 donationLinks 정합.
 * - OFF/설정 저장: startedAt·기존 link 유지 (후원 집계 기준 리셋 없음)
 * - ON/좌석 추가: 신규 좌석만 active (startedAt 없음 = 전체 기간)
 * - resetTerritory: 영토 집계만 now 기준 새 라운드 (후원 rows 불변)
 */
export function mergeHighSocietyDonationLinksOnSettingsChange(opts: {
  prevSettings: HighSocietySettings;
  nextSettings: HighSocietySettings;
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>;
  resetTerritory?: boolean;
  donors?: Array<Pick<Donor, "memberId" | "amount" | "hsPushDir" | "donationExcluded" | "hsTerritoryExcluded" | "at">>;
  now?: number;
}): HighSocietySettings {
  const { prevSettings, nextSettings, members, resetTerritory = false } = opts;
  const now = opts.now ?? Date.now();
  const wasOn = prevSettings.enabled;
  const turningOn = !wasOn && nextSettings.enabled;
  const turningOff = wasOn && !nextSettings.enabled;
  const reOn = turningOn && isHighSocietyReopen(prevSettings);
  const firstOn = turningOn && !reOn;
  const prevSeatIds = prevSettings.seatMemberIds || [];
  const nextSeatIds = nextSettings.seatMemberIds || [];
  const seatsChanged = !seatMemberIdsEqual(prevSeatIds, nextSeatIds);

  const seatMembers = resolveHighSocietySeatMembers(members, nextSettings);
  const valid = new Set(seatMembers.map((s) => s.id));

  const territoryTimingPatch = (): Partial<HighSocietySettings> => {
    if (resetTerritory) {
      return {
        territoryCutoffAt: undefined,
        territoryReopenAt: undefined,
        territoryPaused: false,
        territoryPausedAt: undefined,
        territoryPauseExcludeWindows: undefined,
        memberWidthCm: undefined,
        memberWidthDonationSnapshot: undefined,
        memberTerritoryExpand: undefined,
      };
    }
    if (turningOff) {
      const windows = normalizeTerritoryPauseExcludeWindows(nextSettings.territoryPauseExcludeWindows);
      if (nextSettings.territoryPaused && nextSettings.territoryPausedAt) {
        const from = Math.floor(Number(nextSettings.territoryPausedAt));
        if (now > from) windows.push({ from, to: Math.floor(now) });
      }
      return {
        territoryCutoffAt: now,
        territoryReopenAt: undefined,
        territoryPaused: false,
        territoryPausedAt: undefined,
        donationSyncModeBeforePause: undefined,
        ...(windows.length > 0 ? { territoryPauseExcludeWindows: windows } : {}),
      };
    }
    if (reOn) return { territoryReopenAt: now };
    if (firstOn) return { territoryCutoffAt: undefined, territoryReopenAt: undefined };
    return {};
  };

  const clearMemberWidthSnapshot = (): Partial<HighSocietySettings> => ({
    memberWidthCm: undefined,
    memberWidthDonationSnapshot: undefined,
    memberTerritoryExpand: undefined,
  });

  const buildSeatLayoutPreservingWidthSnapshot = (): Partial<HighSocietySettings> => {
    /** 멤버 id별 widthCm 유지 — expand·donation 스냅은 새 좌석 순서 기준으로 갱신 */
    const prevField = buildHighSocietyFieldFromAppState({
      members,
      donors: (opts.donors ?? []) as Donor[],
      highSocietySettings: prevSettings,
    });
    const prevById = new Map(prevField.seats.map((s) => [s.id, s]));
    const nextPlayers = resolveHighSocietySeatMembers(members, nextSettings);
    const playersAgg = aggregateSeatPushesFromDonors({
      seatPlayers: nextPlayers.map((p) => ({ ...p, donationWon: 0 })),
      donors: (opts.donors ?? []) as Donor[],
      settings: nextSettings,
    });
    const aggById = new Map(playersAgg.map((p) => [p.id, p]));
    const memberWidthCm: Record<string, number> = {};
    const memberWidthDonationSnapshot: Record<string, number> = {};
    const memberTerritoryExpand: Record<string, { expandLeftCm: number; expandRightCm: number }> =
      {};
    for (const p of nextPlayers) {
      const prev = prevById.get(p.id);
      const agg = aggById.get(p.id);
      if (prev) {
        const expand = (prev.expandLeftCm || 0) + (prev.expandRightCm || 0);
        const startCm = prevField.startCm;
        memberWidthCm[p.id] =
          expand > 0 && prev.widthCm < startCm * 0.5
            ? Math.round(startCm + expand)
            : prev.widthCm;
      } else {
        memberWidthCm[p.id] = 0;
      }
      memberWidthDonationSnapshot[p.id] = Math.max(0, Number(agg?.donationWon) || 0);
      memberTerritoryExpand[p.id] = {
        expandLeftCm: Math.max(0, Number(agg?.expandLeftCm) || 0),
        expandRightCm: Math.max(0, Number(agg?.expandRightCm) || 0),
      };
    }
    return { memberWidthCm, memberWidthDonationSnapshot, memberTerritoryExpand };
  };

  const clearWidthsOnSeatChange = shouldClearMemberWidthSnapshotOnSeatChange({
    prevSettings,
    nextSettings,
    members,
    donors: opts.donors,
  });

  const preserveLayoutOnSeatChange = seatsChanged && !clearWidthsOnSeatChange;

  const memberWidthPatch =
    resetTerritory || firstOn || turningOff || clearWidthsOnSeatChange
      ? clearMemberWidthSnapshot()
      : preserveLayoutOnSeatChange
        ? buildSeatLayoutPreservingWidthSnapshot()
        : {};

  const needsDonationLinkRebuild =
    resetTerritory || turningOn || clearWidthsOnSeatChange;

  const patchReaddedSeatDonationLinks = (): Partial<HighSocietySettings> => {
    if (!preserveLayoutOnSeatChange) return {};
    const prevValid = new Set(resolveHighSocietySeatMembers(members, prevSettings).map((s) => s.id));
    const links = { ...(nextSettings.donationLinks || {}) };
    let changed = false;
    for (const id of valid) {
      if (prevValid.has(id)) continue;
      const archived = prevSettings.donationLinks?.[id];
      const archivedStart = Number(archived?.startedAt);
      if (archived && Number.isFinite(archivedStart) && archivedStart > 0) {
        links[id] = { active: true, startedAt: Math.floor(archivedStart) };
      } else {
        links[id] = {
          active: true,
          ...(links[id]?.startedAt !== undefined ? { startedAt: links[id]!.startedAt } : {}),
        };
      }
      changed = true;
    }
    return changed
      ? { donationLinks: normalizeHighSocietyDonationLinks(links, valid) }
      : {};
  };

  if (!needsDonationLinkRebuild) {
    return {
      ...nextSettings,
      donationLinks: normalizeHighSocietyDonationLinks(nextSettings.donationLinks, valid),
      ...patchReaddedSeatDonationLinks(),
      ...territoryTimingPatch(),
      ...memberWidthPatch,
    };
  }

  const donationLinks: Record<string, { active: boolean; startedAt?: number }> = {
    ...(nextSettings.donationLinks || {}),
  };

  for (const id of valid) {
    const prevLink = donationLinks[id];
    if (resetTerritory) {
      donationLinks[id] = { active: true, startedAt: now };
      continue;
    }
    if (turningOn) {
      if (reOn && prevLink?.active && Number(prevLink.startedAt) > 0) {
        /** 재ON — baseline link 유지, 신규 후원은 territoryReopenAt 으로 필터 */
        donationLinks[id] = { active: true, startedAt: prevLink.startedAt };
      } else {
        /** 최초 ON — ON 시점 이후 후원만 영토 반영 */
        donationLinks[id] = { active: true, startedAt: now };
      }
      continue;
    }
    if (!prevLink) {
      const archived = prevSettings.donationLinks?.[id];
      const archivedStart = Number(archived?.startedAt);
      if (archived && Number.isFinite(archivedStart) && archivedStart > 0) {
        donationLinks[id] = { active: true, startedAt: Math.floor(archivedStart) };
      } else {
        donationLinks[id] = { active: true, startedAt: now };
      }
    } else {
      donationLinks[id] = { ...prevLink, active: true };
    }
  }

  for (const id of Object.keys(donationLinks)) {
    if (!valid.has(id)) {
      donationLinks[id] = { ...donationLinks[id]!, active: false };
    }
  }

  const prevRound = Math.max(1, Math.floor(Number(prevSettings.round) || 1));
  return {
    ...nextSettings,
    donationLinks: normalizeHighSocietyDonationLinks(donationLinks, valid),
    ...(resetTerritory ? { round: Math.min(99, prevRound + 1) } : {}),
    ...territoryTimingPatch(),
    ...memberWidthPatch,
  };
}

/** 가운데 좌·우 분배 — 합은 expandCm(5cm 배수) 유지, 정수 cm만 사용 */
function splitExpandCmByRatio(
  expandCm: number,
  leftRatio: number
): { expandLeftCm: number; expandRightCm: number } {
  const total = Math.max(0, Math.round(expandCm));
  if (total === 0) return { expandLeftCm: 0, expandRightCm: 0 };
  const expandLeftCm = Math.round(total * clamp01(leftRatio));
  return { expandLeftCm, expandRightCm: total - expandLeftCm };
}

/**
 * 전장 합(fieldCm)을 유지하며 좌석 폭을 정수 cm로 맞춤.
 * 스케일·N등분 잔여로 생기는 0.1cm 표시(230.1 등)를 제거한다.
 */
function quantizeSeatWidthsToFieldCm(widths: number[], fieldCm: number): number[] {
  if (widths.length === 0) return [];
  const target = Math.round(fieldCm);
  const floored = widths.map((w) => Math.max(0, Math.floor(w)));
  let deficit = target - floored.reduce((a, b) => a + b, 0);
  const order = widths
    .map((w, i) => ({ i, frac: w - Math.floor(Math.max(0, w)) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floored];
  let k = 0;
  while (deficit > 0 && order.length > 0) {
    out[order[k % order.length]!.i]! += 1;
    deficit -= 1;
    k += 1;
  }
  while (deficit < 0) {
    const idx = out.reduce(
      (best, w, i) => (w > 0 && (best < 0 || w < out[best]!) ? i : best),
      -1
    );
    if (idx < 0) break;
    out[idx]! -= 1;
    deficit += 1;
  }
  return out;
}

/**
 * 인접 경계 순이동 적용.
 * net > 0 → 왼쪽 좌석이 오른쪽에서 뺏음 / net < 0 → 오른쪽이 왼쪽에서 뺏음.
 */
function applyBoundaryNet(widths: number[], leftIdx: number, rightIdx: number, net: number): void {
  if (net === 0) return;
  if (net > 0) {
    const steal = Math.min(net, widths[rightIdx]!);
    widths[leftIdx]! += steal;
    widths[rightIdx]! -= steal;
    /** 이웃이 비면 남은 확장은 밀어낸 쪽에 유지 — 양끝 200/200 균등 오류 방지 */
    const remainder = net - steal;
    if (remainder > 0) widths[leftIdx]! += remainder;
  } else {
    const steal = Math.min(-net, widths[leftIdx]!);
    widths[rightIdx]! += steal;
    widths[leftIdx]! -= steal;
    const remainder = -net - steal;
    if (remainder > 0) widths[rightIdx]! += remainder;
  }
}

/** 바깥 경계부터 안쪽으로 적용 — 벽 쪽 압력 우선 */
function applyBoundaryNetsOutsideIn(widths: number[], nets: number[]): void {
  let left = 0;
  let right = nets.length - 1;
  while (left <= right) {
    if (left === right) {
      applyBoundaryNet(widths, left, left + 1, nets[left]!);
    } else {
      applyBoundaryNet(widths, left, left + 1, nets[left]!);
      applyBoundaryNet(widths, right, right + 1, nets[right]!);
    }
    left += 1;
    right -= 1;
  }
}

export type HighSocietyPlayerInput = {
  id: string;
  name: string;
  donationWon: number;
  /** 지정 시 split 비율 대신 절대 cm 사용 */
  expandLeftCm?: number;
  expandRightCm?: number;
};

/**
 * 룰 기반 영토 해상 (땅따먹기).
 * - 전장 총길이 fieldCm 고정
 * - 시작: 멤버 N명 → 각 fieldCm/N
 * - 양끝: 단방향 / 가운데: 좌·우 분배
 * - 확장량만큼 인접 영토 축소
 */
export function resolveHighSocietyField(opts: {
  players: HighSocietyPlayerInput[];
  fieldCm?: number;
  split?: Partial<HighSocietyPushSplit>;
  /** 가운데 기본 좌측 비율(절대 cm 없을 때). 미지정 시 split.bLeft 또는 0.5 */
  middleLeftRatio?: number;
}): {
  seats: HighSocietySeat[];
  fieldCm: number;
  startCm: number;
  playerCount: number;
  leader: HighSocietySeat | null;
  cushion: HighSocietySeat[];
} {
  const players = (opts.players || []).slice(0, HIGH_SOCIETY_MAX_SEATS);
  const n = players.length;
  const fieldCm = Math.max(n > 0 ? n : 4, opts.fieldCm ?? HIGH_SOCIETY_DEFAULT_FIELD_CM);
  if (n === 0) {
    return { seats: [], fieldCm, startCm: 0, playerCount: 0, leader: null, cushion: [] };
  }

  const startCm = fieldCm / n;
  const middleLeft = clamp01(
    opts.middleLeftRatio ?? opts.split?.bLeft ?? opts.split?.cLeft ?? 0.5
  );
  const bLeft = clamp01(opts.split?.bLeft ?? middleLeft);
  const cLeft = clamp01(opts.split?.cLeft ?? middleLeft);

  const filled = players.map((p, i) => {
    const donationWon = Math.max(0, Number(p?.donationWon || 0));
    const expandCm = donationToExpandCm(donationWon);
    const dir = seatExpandDirForIndex(i, n);
    let expandLeftCm = 0;
    let expandRightCm = 0;
    if (p && (p.expandLeftCm != null || p.expandRightCm != null)) {
      expandLeftCm = Math.max(0, Number(p.expandLeftCm) || 0);
      expandRightCm = Math.max(0, Number(p.expandRightCm) || 0);
    } else if (dir === "right") {
      expandRightCm = expandCm;
    } else if (dir === "left") {
      expandLeftCm = expandCm;
    } else if (n === 4 && i === 1) {
      ({ expandLeftCm, expandRightCm } = splitExpandCmByRatio(expandCm, bLeft));
    } else if (n === 4 && i === 2) {
      ({ expandLeftCm, expandRightCm } = splitExpandCmByRatio(expandCm, cLeft));
    } else {
      ({ expandLeftCm, expandRightCm } = splitExpandCmByRatio(expandCm, middleLeft));
    }
    const letter = seatIndexLabel(i);
    return {
      letter,
      seatIndex: i,
      id: p?.id ? String(p.id) : `seat-${letter}`,
      name: p?.name?.trim() || `플레이어 ${letter}`,
      donationWon,
      expandCm: expandLeftCm + expandRightCm,
      expandLeftCm,
      expandRightCm,
      expandDir: dir,
      color: HIGH_SOCIETY_SEAT_COLORS[i % HIGH_SOCIETY_SEAT_COLORS.length]!,
    };
  });

  const widths = Array.from({ length: n }, () => startCm);
  if (n >= 2) {
    const nets: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      nets.push(filled[i]!.expandRightCm - filled[i + 1]!.expandLeftCm);
    }
    applyBoundaryNetsOutsideIn(widths, nets);
  }

  const sum = widths.reduce((s, w) => s + w, 0);
  if (Math.abs(sum - fieldCm) > 0.01 && sum > 0) {
    const scale = fieldCm / sum;
    for (let i = 0; i < widths.length; i++) {
      widths[i] = widths[i]! * scale;
    }
  }
  const quantizedWidths = quantizeSeatWidthsToFieldCm(widths, fieldCm);

  const seats: HighSocietySeat[] = filled.map((f, i) => {
    const widthCm = Math.max(0, quantizedWidths[i]!);
    return {
      ...f,
      widthCm,
      pct: Math.round((widthCm / fieldCm) * 1000) / 10,
      eliminated: widthCm <= 0,
    };
  });

  const alive = seats.filter((s) => !s.eliminated).sort((a, b) => b.widthCm - a.widthCm);
  return {
    seats,
    fieldCm,
    startCm,
    playerCount: n,
    leader: alive[0] ?? null,
    cushion: seats.filter((s) => s.eliminated),
  };
}

function playerTerritoryExpandCm(p: HighSocietyPlayerInput): number {
  return Math.max(0, Number(p.expandLeftCm) || 0) + Math.max(0, Number(p.expandRightCm) || 0);
}

function shouldUseMemberWidthSnapshot(
  settings: HighSocietySettings,
  players: HighSocietyPlayerInput[]
): settings is HighSocietySettings & {
  memberWidthCm: Record<string, number>;
  memberWidthDonationSnapshot: Record<string, number>;
} {
  const widths = settings.memberWidthCm;
  const snap = settings.memberWidthDonationSnapshot;
  if (!widths || !snap || Object.keys(widths).length === 0) return false;
  for (const p of players) {
    if (widths[p.id] == null) return false;
    const snapWon = snap[p.id];
    if (snapWon == null || p.donationWon !== snapWon) return false;
    const snapWidth = Math.max(0, Number(widths[p.id]) || 0);
    const expandNow = playerTerritoryExpandCm(p);
    /** 0cm 탈락 후 영토 재적용 — 스냅샷 width=0 고정을 풀고 실시간 재계산 */
    if (snapWidth <= 0 && expandNow > 0) return false;
    const expandSnap = settings.memberTerritoryExpand?.[p.id];
    if (expandSnap) {
      const left = Math.max(0, Number(p.expandLeftCm) || 0);
      const right = Math.max(0, Number(p.expandRightCm) || 0);
      if (expandSnap.expandLeftCm !== left || expandSnap.expandRightCm !== right) return false;
    }
  }
  return true;
}

/** 옛 스냅샷 width=expandCm(5)만 저장된 경우 복구 — fieldCm 합 유지하며 타 좌석에서 균등 차감 */
function repairMemberWidthSnapshot(
  widthByMemberId: Record<string, number>,
  players: HighSocietyPlayerInput[],
  startCm: number,
  fieldCm: number
): Record<string, number> {
  const out = { ...widthByMemberId };
  const corruptIds = new Set<string>();
  let extraNeeded = 0;
  for (const p of players) {
    const w = out[p.id];
    if (w == null) continue;
    const expand = (p.expandLeftCm || 0) + (p.expandRightCm || 0);
    if (expand > 0 && w < startCm * 0.5) {
      const target = Math.round(startCm + expand);
      extraNeeded += target - w;
      out[p.id] = target;
      corruptIds.add(p.id);
    }
  }
  if (extraNeeded <= 0) return out;
  const others = players.filter((p) => out[p.id] != null && !corruptIds.has(p.id));
  const otherSum = others.reduce((s, p) => s + (out[p.id] || 0), 0);
  if (otherSum <= extraNeeded) return out;
  const shrink = (otherSum - extraNeeded) / otherSum;
  for (const p of others) {
    out[p.id] = Math.max(0, Math.round(out[p.id]! * shrink));
  }
  const sum = players.reduce((s, p) => s + (out[p.id] || 0), 0);
  if (Math.abs(sum - fieldCm) > 0.5 && others[0]) {
    out[others[0].id] = Math.max(0, Math.round((out[others[0].id] || 0) + (fieldCm - sum)));
  }
  return out;
}

/** 좌석 reorder 직후 — 멤버 id별 widthCm 유지(슬롯 index 물리 재계산 생략) */
export function resolveHighSocietyFieldWithMemberWidths(opts: {
  players: HighSocietyPlayerInput[];
  fieldCm: number;
  widthByMemberId: Record<string, number>;
  expandByMemberId?: Record<string, { expandLeftCm: number; expandRightCm: number }>;
}): ReturnType<typeof resolveHighSocietyField> {
  const players = (opts.players || []).slice(0, HIGH_SOCIETY_MAX_SEATS);
  const n = players.length;
  const fieldCm = Math.max(n > 0 ? n : 4, opts.fieldCm ?? HIGH_SOCIETY_DEFAULT_FIELD_CM);
  if (n === 0) {
    return { seats: [], fieldCm, startCm: 0, playerCount: 0, leader: null, cushion: [] };
  }

  const startCm = fieldCm / n;
  const rawWidths = players.map((p) => {
    const snap = opts.widthByMemberId[p.id];
    if (snap != null && snap > 0) return snap;
    if (snap === 0) return 0;
    return startCm;
  });
  const sum = rawWidths.reduce((s, w) => s + w, 0);
  const hasExplicitZero = players.some((p) => opts.widthByMemberId[p.id] === 0);
  let scaledWidths: number[];
  if (sum <= 0) {
    scaledWidths = rawWidths.map(() => startCm);
  } else if (hasExplicitZero && sum < fieldCm) {
    /** 0cm 탈락 슬롯 유지 — 기존 영토 cm 절대값 보존(신규 좌석 추가 시 N등분 회귀 방지) */
    scaledWidths = rawWidths;
  } else {
    scaledWidths = rawWidths.map((w) => w * (fieldCm / sum));
  }
  const quantizedWidths =
    hasExplicitZero && sum < fieldCm
      ? scaledWidths.map((w) => Math.max(0, Math.round(w)))
      : quantizeSeatWidthsToFieldCm(scaledWidths, fieldCm);

  const seats: HighSocietySeat[] = players.map((p, i) => {
    const donationWon = Math.max(0, Number(p.donationWon || 0));
    const expandSnap = opts.expandByMemberId?.[p.id];
    const expandLeftCm = Math.max(
      0,
      expandSnap ? expandSnap.expandLeftCm : Number(p.expandLeftCm) || 0
    );
    const expandRightCm = Math.max(
      0,
      expandSnap ? expandSnap.expandRightCm : Number(p.expandRightCm) || 0
    );
    const widthCm = Math.max(0, quantizedWidths[i]!);
    const letter = seatIndexLabel(i);
    return {
      letter,
      seatIndex: i,
      id: p.id,
      name: p.name?.trim() || `플레이어 ${letter}`,
      donationWon,
      expandCm: expandLeftCm + expandRightCm,
      expandLeftCm,
      expandRightCm,
      expandDir: seatExpandDirForIndex(i, n),
      color: HIGH_SOCIETY_SEAT_COLORS[i % HIGH_SOCIETY_SEAT_COLORS.length]!,
      widthCm,
      pct: Math.round((widthCm / fieldCm) * 1000) / 10,
      eliminated: widthCm <= 0,
    };
  });

  const alive = seats.filter((s) => !s.eliminated).sort((a, b) => b.widthCm - a.widthCm);
  return {
    seats,
    fieldCm,
    startCm,
    playerCount: n,
    leader: alive[0] ?? null,
    cushion: seats.filter((s) => s.eliminated),
  };
}

/** 운영비 제외 멤버 전원(또는 지정 좌석) N등분 */
export function buildHighSocietyFieldFromMembers(
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>,
  opts?: {
    fieldCm?: number;
    split?: Partial<HighSocietyPushSplit>;
    seatMemberIds?: string[];
    seatMemberIdsManual?: boolean;
  }
) {
  const playable = resolveHighSocietySeatMembers(members, {
    seatMemberIds: opts?.seatMemberIds ?? [],
    seatMemberIdsManual: opts?.seatMemberIdsManual,
  });
  return resolveHighSocietyField({
    players: playable,
    fieldCm: opts?.fieldCm,
    split: opts?.split,
  });
}

export function resolveHighSocietySeatMembers(
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>,
  selection?: string[] | null | HighSocietySeatSelection
): Array<{ id: string; name: string; donationWon: number }> {
  const byId = new Map(
    members.map((m) => [
      String(m.id),
      {
        id: String(m.id),
        name: String(m.name || "").trim() || "멤버",
        donationWon: memberTotal(m),
        operating: Boolean(m.operating),
      },
    ])
  );
  const fallback = members
    .filter((m) => !m.operating)
    .slice(0, HIGH_SOCIETY_MAX_SEATS)
    .map((m) => ({
      id: String(m.id),
      name: String(m.name || "").trim() || "멤버",
      donationWon: memberTotal(m),
    }));

  const normalized = normalizeHighSocietySeatSelectionInput(selection);
  if (normalized === null) return fallback;

  const ids = (normalized.seatMemberIds || [])
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const manual = isHighSocietySeatSelectionManual(normalized);

  if (manual) {
    if (ids.length === 0) return [];
    return ids
      .map((sid) => {
        const m = byId.get(sid);
        if (!m || m.operating) return null;
        return { id: m.id, name: m.name, donationWon: m.donationWon };
      })
      .filter((x): x is { id: string; name: string; donationWon: number } => Boolean(x))
      .slice(0, HIGH_SOCIETY_MAX_SEATS);
  }

  return fallback;
}

/** 관리자 좌석 편집용 id 목록 — 수동이면 seatMemberIds, 자동이면 현재 표시 중인 전원 */
export function resolveHighSocietySeatMemberIdsForEdit(
  settings: Pick<HighSocietySettings, "seatMemberIds" | "seatMemberIdsManual">,
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>
): string[] {
  const selection: HighSocietySeatSelection = {
    seatMemberIds: settings.seatMemberIds || [],
    seatMemberIdsManual: settings.seatMemberIdsManual,
  };
  if (isHighSocietySeatSelectionManual(selection)) {
    return (selection.seatMemberIds || []).map((id) => String(id).trim()).filter(Boolean);
  }
  return resolveHighSocietySeatMembers(members, selection).map((p) => p.id);
}

/** 좌석 재추가 — id 중복·유령(미해석) 항목 제거 후 맨 뒤에 배치 */
export function appendHighSocietySeatMemberId(curIds: string[], memberId: string): string[] {
  return insertHighSocietySeatMemberIdAt(curIds, memberId, Number.MAX_SAFE_INTEGER);
}

/** 좌석 재추가 — 지정 인덱스(0=맨 왼쪽)에 삽입. atIndex≥length 이면 맨 뒤 */
export function insertHighSocietySeatMemberIdAt(
  curIds: string[],
  memberId: string,
  atIndex: number
): string[] {
  const id = String(memberId || "").trim();
  const base = curIds.map((x) => String(x).trim()).filter(Boolean);
  if (!id) return base;
  const next = base.filter((x) => x !== id);
  const idx = Math.max(0, Math.min(Math.floor(atIndex), next.length));
  return [...next.slice(0, idx), id, ...next.slice(idx)];
}

export function seatRoleForMemberId(
  settings: HighSocietySettings,
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>,
  memberId: string
): HighSocietySeatRole | null {
  const seats = resolveHighSocietySeatMembers(members, settings);
  const idx = seats.findIndex((s) => s.id === String(memberId || "").trim());
  if (idx < 0) return null;
  const expandDir = seatExpandDirForIndex(idx, seats.length);
  return {
    index: idx,
    canChoosePush: expandDir === "both",
    expandDir,
  };
}

/** 후원 리스트에서 영토 ON 으로 명시 반영된 행 */
export function isDonorHsTerritoryIncluded(d: Pick<Donor, "hsTerritoryExcluded">): boolean {
  return d.hsTerritoryExcluded === false;
}

export function isDonorHsTerritoryExcluded(d: Pick<Donor, "hsTerritoryExcluded">): boolean {
  return !isDonorHsTerritoryIncluded(d);
}

/**
 * 상류사회 ON/OFF 등 admin patch 직전 — React·LS·ref 중 비어 있는 쪽이
 * 실후원을 지우지 않게 id 기준 union(금액·at 더 풍부한 행 우선).
 */
function donorRosterMergeKey(d: Donor): string {
  const id = String(d.id || "").trim();
  if (id) return `id:${id}`;
  const name = String(d.name || "").trim();
  const amount = Math.max(0, Math.round(Number(d.amount) || 0));
  const at = Number.isFinite(Number(d.at)) ? Math.floor(Number(d.at)) : 0;
  return `fallback:${name}|${at}|${amount}`;
}

export function mergeDonorRostersPreferFullest(
  ...sources: Array<Donor[] | null | undefined>
): Donor[] {
  const byKey = new Map<string, Donor>();
  for (const src of sources) {
    for (const d of src || []) {
      if (!d || typeof d !== "object") continue;
      const key = donorRosterMergeKey(d);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, d);
        continue;
      }
      const existingAmt = Math.max(0, Math.round(Number(existing.amount) || 0));
      const nextAmt = Math.max(0, Math.round(Number(d.amount) || 0));
      const existingAt = Number(existing.at || 0);
      const nextAt = Number(d.at || 0);
      if (nextAmt > existingAmt || (nextAmt === existingAmt && nextAt >= existingAt)) {
        byKey.set(key, d);
      }
    }
  }
  return Array.from(byKey.values());
}

/**
 * 상류사회 설정 저장 시 donors 를 서버에 권위적으로 올려야 하는 patch 인지.
 * 최초 ON 만 — 영토만 초기화는 settings-only PATCH + 서버 round bump 마킹.
 */
export function shouldPersistDonorsForHighSocietySettingsPatch(opts: {
  resetTerritory: boolean;
  isFirstOn: boolean;
}): boolean {
  void opts.resetTerritory;
  return Boolean(opts.isFirstOn);
}

/** 영토 리셋·최초 ON — 로컬 UI/LS 에 hsTerritoryExcluded 반영 (서버 authoritative 와 분리) */
export function shouldMarkDonorsLocallyForHighSocietySettingsPatch(opts: {
  resetTerritory: boolean;
  isFirstOn: boolean;
}): boolean {
  return Boolean(opts.resetTerritory || opts.isFirstOn);
}

/**
 * settings-only PATCH 로 round 가 올라갔을 때 서버 donors 에 영토 OFF 표시만 부여.
 * donors/members wipe 없음 — resetTerritory 전용.
 */
export function markDonorsForHighSocietyTerritoryRoundBump(opts: {
  prevRound: number;
  nextRound: number;
  donors: Donor[] | null | undefined;
}): Donor[] | null {
  const prev = Math.max(1, Math.floor(Number(opts.prevRound) || 1));
  const next = Math.max(1, Math.floor(Number(opts.nextRound) || 1));
  if (next <= prev) return null;
  const donors = mergeDonorRostersPreferFullest(opts.donors);
  if (donors.length === 0) return null;
  return markDonorsHsTerritoryExcluded(donors, true);
}

/** 상류사회 ON/OFF 시 donationSyncMode — OFF 후에도 후원 합산·투네는 mealBattle 경로 유지 */
export function resolveDonationSyncModeForHighSocietySettingsChange(opts: {
  turningOn: boolean;
  turningOff: boolean;
  prevMode: AppState["donationSyncMode"] | undefined;
}): NonNullable<AppState["donationSyncMode"]> {
  if (opts.turningOn) return "highSociety";
  if (opts.turningOff && opts.prevMode === "highSociety") return "mealBattle";
  const m = opts.prevMode;
  if (
    m === "none" ||
    m === "mealBattle" ||
    m === "sigMatch" ||
    m === "sigSales" ||
    m === "highSociety"
  ) {
    return m;
  }
  return "mealBattle";
}

/**
 * 상류사회 설정 patch(OFF·일시정지·ON·영토 리셋) 직전 donors 확정.
 * React·ref·LS union 후, 최초 ON·영토 리셋 때만 hsTerritoryExcluded 표시.
 */
export function resolveDonorsForHighSocietySettingsPatch(opts: {
  prevDonorsReact: Donor[] | null | undefined;
  refDonors: Donor[] | null | undefined;
  lsDonors: Donor[] | null | undefined;
  resetTerritory: boolean;
  isFirstOn: boolean;
}): Donor[] {
  const prevDonors = mergeDonorRostersPreferFullest(
    opts.prevDonorsReact,
    opts.refDonors,
    opts.lsDonors
  );
  /** id 없는 행·일시적 React 비움 — 영토 patch 가 donors/members 를 0으로 덮지 않게 */
  const shouldMarkHsTerritoryOff =
    (opts.resetTerritory || opts.isFirstOn) && prevDonors.length > 0;
  return shouldMarkHsTerritoryOff
    ? markDonorsHsTerritoryExcluded(prevDonors, true)
    : prevDonors;
}

/** 영토 리셋·최초 ON patch 에서 donors 를 state/LS/API 에 반영할지 */
export function shouldApplyDonorsForHighSocietySettingsPatch(
  donors: Donor[] | null | undefined
): boolean {
  return mergeDonorRostersPreferFullest(donors).length > 0;
}

/** 영토 초기화·상류사회 ON 시 기존 후원 행 — 영토만 OFF (순위·합산 유지) */
export function markDonorsHsTerritoryExcluded<T extends { hsTerritoryExcluded?: boolean }>(
  donors: T[],
  excluded: boolean
): T[] {
  if (!donors.length) return donors;
  return donors.map((d) => {
    if (excluded) {
      if (d.hsTerritoryExcluded === true) return d;
      return { ...d, hsTerritoryExcluded: true as const };
    }
    if (!d.hsTerritoryExcluded) return d;
    const { hsTerritoryExcluded: _drop, ...rest } = d;
    return rest as T;
  });
}

/** @deprecated seatRoleForMemberId 사용 */
export function seatLetterForMemberId(
  settings: HighSocietySettings,
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>,
  memberId: string
): HighSocietySeatLetter | null {
  const role = seatRoleForMemberId(settings, members, memberId);
  if (!role) return null;
  return seatIndexLabel(role.index);
}

/** 후원 행별 방향을 반영해 좌석 확장 cm 합산 */
export function aggregateSeatPushesFromDonors(opts: {
  seatPlayers: Array<{ id: string; name: string; donationWon: number }>;
  donors: Array<Pick<Donor, "memberId" | "amount" | "hsPushDir" | "donationExcluded" | "hsTerritoryExcluded" | "at">>;
  settings: HighSocietySettings;
}): HighSocietyPlayerInput[] {
  const { seatPlayers, donors, settings } = opts;
  const n = seatPlayers.length;
  const middleDir = resolveSystemMiddlePushDir(settings);

  return seatPlayers.map((player, i) => {
    const dir = seatExpandDirForIndex(i, n);
    const eliminatedSnap = isHighSocietyMemberWidthEliminatedInSnapshot(settings, player.id);
    const link = resolveHighSocietyDonationLink(settings, player.id);
    const rows = (donors || []).filter((d) => {
      if (String(d.memberId || "") !== player.id) return false;
      return shouldDonorCountForHighSocietyTerritory(d, settings, link);
    });

    const applyPushCm = (cm: number, d: (typeof rows)[number]) => {
      if (eliminatedSnap || dir === "both") {
        const push = parseHighSocietyPushDir(d.hsPushDir) || middleDir;
        const lr = pushDirToLeftRight(cm, push);
        return { left: lr.left, right: lr.right };
      }
      if (dir === "right") return { left: 0, right: cm };
      if (dir === "left") return { left: cm, right: 0 };
      const push = parseHighSocietyPushDir(d.hsPushDir) || middleDir;
      const lr = pushDirToLeftRight(cm, push);
      return { left: lr.left, right: lr.right };
    };

    if (rows.length === 0) {
      const cm = 0;
      const base = { id: player.id, name: player.name, donationWon: 0 };
      const lr = applyPushCm(cm, { hsPushDir: undefined } as (typeof rows)[number]);
      return { ...base, expandLeftCm: lr.left, expandRightCm: lr.right };
    }

    let left = 0;
    let right = 0;
    let won = 0;
    for (const d of rows) {
      const amount = Math.max(0, Math.round(Number(d.amount) || 0));
      const cm = donationToExpandCm(amount);
      /** 스냅샷 비교용 — 1만원 배수만 합산(1만3천 등은 영토·won 변동 없음) */
      if (isDonationAmountEligibleForHighSocietyTerritory(amount)) {
        won += amount;
      }
      const lr = applyPushCm(cm, d);
      left += lr.left;
      right += lr.right;
    }
    return {
      id: player.id,
      name: player.name,
      donationWon: won,
      expandLeftCm: left,
      expandRightCm: right,
    };
  });
}

/** AppState 기준 영토 해상 (좌석·후원 방향·수동 기록부 반영) */
export function buildHighSocietyFieldFromAppState(
  state: Pick<AppState, "members" | "donors" | "highSocietySettings" | "territoryLogs">,
  opts?: { startCmPerMemberOverride?: number }
) {
  const settings = normalizeHighSocietySettings(state.highSocietySettings);
  const seatPlayers = resolveHighSocietySeatMembers(state.members || [], settings).map(
    (p) => ({ ...p, donationWon: 0 })
  );
  const seatCount = resolveHighSocietySeatCountForField(settings, seatPlayers.length);
  const startOverrideRaw = Number(opts?.startCmPerMemberOverride);
  const startCmPerMember =
    Number.isFinite(startOverrideRaw) && startOverrideRaw > 0
      ? Math.max(1, Math.min(5000, Math.floor(startOverrideRaw)))
      : resolveHighSocietyStartCmPerMember(settings, seatCount);
  const effectiveFieldCm = fieldCmFromStartPerMember(startCmPerMember, seatCount);
  const settingsForField = normalizeHighSocietySettings({
    ...settings,
    startCmPerMember,
    fieldCm: effectiveFieldCm,
  });
  const playersFromDonors = aggregateSeatPushesFromDonors({
    seatPlayers,
    donors: state.donors || [],
    settings: settingsForField,
  });
  const playersFromLogs = aggregateSeatPushesFromTerritoryLogs({
    seatPlayers,
    logs: (state.territoryLogs || []) as TerritoryLog[],
    settings: settingsForField,
  });
  const players = mergeHighSocietyPlayerPushInputs(playersFromDonors, playersFromLogs);
  const startCm = seatCount > 0 ? effectiveFieldCm / seatCount : 0;
  const field =
    shouldUseMemberWidthSnapshot(settingsForField, players)
      ? resolveHighSocietyFieldWithMemberWidths({
          players,
          fieldCm: effectiveFieldCm,
          widthByMemberId: repairMemberWidthSnapshot(
            settingsForField.memberWidthCm!,
            players,
            startCm,
            effectiveFieldCm
          ),
          expandByMemberId: settingsForField.memberTerritoryExpand,
        })
      : resolveHighSocietyField({ players, fieldCm: effectiveFieldCm });
  return {
    ...field,
    settings: { ...settingsForField, fieldCm: effectiveFieldCm },
  };
}

/** 실시간 영토 모드에서 memberWidthCm 스냅샷을 서버·OBS와 맞출지 */
export function shouldSyncHighSocietyMemberWidthSnapshot(
  settings: HighSocietySettings | null | undefined
): boolean {
  const s = normalizeHighSocietySettings(settings);
  if (!s.enabled || s.territoryPaused) return false;
  if (s.territoryUpdateMode === "onRoundEnd") return false;
  return true;
}

/** 스냅샷 없이 해상한 현재 영토 → memberWidthCm·집계 스냅샷 (OBS·관리자 수치 일치) */
export function buildHighSocietyMemberWidthSnapshotPatch(
  state: Pick<AppState, "members" | "donors" | "highSocietySettings" | "territoryLogs">
): Pick<
  HighSocietySettings,
  "memberWidthCm" | "memberWidthDonationSnapshot" | "memberTerritoryExpand"
> | null {
  if (!shouldSyncHighSocietyMemberWidthSnapshot(state.highSocietySettings)) return null;
  const settings = normalizeHighSocietySettings(state.highSocietySettings);
  const seatPlayers = resolveHighSocietySeatMembers(state.members || [], settings);
  if (seatPlayers.length === 0) return null;

  /** UI·merge 가 보여주는 필드(스냅샷 유지) — 스냅샷 제거 후 live 재계산하면 좌석 이동 시 N등분 회귀 */
  const field = buildHighSocietyFieldFromAppState(state);
  if (field.seats.length === 0) return null;

  const playersAgg = aggregateSeatPushesFromDonors({
    seatPlayers: seatPlayers.map((p) => ({ ...p, donationWon: 0 })),
    donors: state.donors || [],
    settings: field.settings,
  });
  const aggById = new Map(playersAgg.map((p) => [p.id, p]));

  const memberWidthCm: Record<string, number> = {};
  const memberWidthDonationSnapshot: Record<string, number> = {};
  const memberTerritoryExpand: Record<string, { expandLeftCm: number; expandRightCm: number }> = {};
  for (const seat of field.seats) {
    const agg = aggById.get(seat.id);
    memberWidthCm[seat.id] = Math.max(0, Math.round(seat.widthCm));
    memberWidthDonationSnapshot[seat.id] = Math.max(0, Number(agg?.donationWon) || 0);
    memberTerritoryExpand[seat.id] = {
      expandLeftCm: Math.max(0, Number(seat.expandLeftCm ?? agg?.expandLeftCm) || 0),
      expandRightCm: Math.max(0, Number(seat.expandRightCm ?? agg?.expandRightCm) || 0),
    };
  }
  return { memberWidthCm, memberWidthDonationSnapshot, memberTerritoryExpand };
}

/** 후원·영토 변경 직후 AppState.highSocietySettings 스냅샷 갱신 */
export function syncHighSocietyMemberWidthSnapshotInState(state: AppState): AppState {
  const patch = buildHighSocietyMemberWidthSnapshotPatch(state);
  if (!patch) return state;
  return {
    ...state,
    highSocietySettings: normalizeHighSocietySettings({
      ...state.highSocietySettings,
      ...patch,
    }),
  };
}

/** 서버·OBS에 영토 cm 스냅샷을 올려야 하는지 — 누락·현재 해상과 불일치 */
export function highSocietyNeedsMemberWidthSnapshotPersist(
  state: Pick<AppState, "members" | "donors" | "highSocietySettings" | "territoryLogs">
): boolean {
  if (!shouldSyncHighSocietyMemberWidthSnapshot(state.highSocietySettings)) return false;
  const patch = buildHighSocietyMemberWidthSnapshotPatch(state);
  if (!patch) return false;
  const cur = normalizeHighSocietySettings(state.highSocietySettings);
  const curW = cur.memberWidthCm;
  const curSnap = cur.memberWidthDonationSnapshot;
  const curExp = cur.memberTerritoryExpand;
  if (!curW || Object.keys(curW).length === 0) return true;
  if (
    JSON.stringify(curW) !== JSON.stringify(patch.memberWidthCm) ||
    JSON.stringify(curSnap ?? {}) !== JSON.stringify(patch.memberWidthDonationSnapshot ?? {}) ||
    JSON.stringify(curExp ?? {}) !== JSON.stringify(patch.memberTerritoryExpand ?? {})
  ) {
    return true;
  }
  return false;
}

/** 운영비 제외 멤버의 계좌+투네 합으로 영토 점유율 계산 (보조 게이지용) */
export function buildHighSocietyTerritory(
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>
): {
  slices: HighSocietyTerritorySlice[];
  total: number;
  leader: HighSocietyTerritorySlice | null;
} {
  const playable = members
    .filter((m) => !m.operating)
    .map((m) => ({
      id: String(m.id),
      name: String(m.name || "").trim() || "멤버",
      amount: memberTotal(m),
    }))
    .filter((m) => m.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  const total = playable.reduce((s, m) => s + m.amount, 0);
  if (total <= 0) {
    return { slices: [], total: 0, leader: null };
  }

  const slices: HighSocietyTerritorySlice[] = playable.map((m, i) => ({
    id: m.id,
    name: m.name,
    amount: m.amount,
    pct: Math.round((m.amount / total) * 1000) / 10,
    color: TERRITORY_COLORS[i % TERRITORY_COLORS.length]!,
  }));

  const pctSum = slices.reduce((s, x) => s + x.pct, 0);
  if (slices[0] && Math.abs(pctSum - 100) > 0.05) {
    slices[0] = {
      ...slices[0],
      pct: Math.max(0, Math.round((slices[0].pct + (100 - pctSum)) * 10) / 10),
    };
  }

  return { slices, total, leader: slices[0] || null };
}

/** 2×2 미니맵: 좌석 A→D 또는 상위 점유 */
export function buildHighSocietyZones(
  slices: HighSocietyTerritorySlice[] | HighSocietySeat[]
): HighSocietyZone[] {
  const labels = ["NW", "NE", "SW", "SE"];
  return labels.map((label, i) => {
    const owner = slices[i] as HighSocietyTerritorySlice | HighSocietySeat | undefined;
    if (!owner) {
      return { id: `zone-${label}`, label, ownerName: null, color: "transparent" };
    }
    const eliminated = "eliminated" in owner && owner.eliminated;
    return {
      id: `zone-${label}`,
      label,
      ownerName: eliminated ? null : owner.name,
      color: eliminated ? "transparent" : owner.color,
    };
  });
}

export function highSocietyAdminPreviewSig(
  settings: HighSocietySettings | null | undefined,
  opts?: { updatedAt?: number; donorTerritorySig?: string }
): string {
  const s = normalizeHighSocietySettings(settings);
  return [
    s.enabled ? "1" : "0",
    s.territoryPaused ? "1" : "0",
    s.territoryUpdateMode || "realtime",
    (s.seatMemberIds || []).join(","),
    s.seatMemberIdsManual ? "1" : "0",
    s.barStyle || "flat",
    s.fieldCm ?? "",
    s.startCmPerMember ?? "",
    s.round ?? 1,
    highSocietyFxToHsFxParam(normalizeHighSocietyFxSettings(s.fx)),
    JSON.stringify(s.memberWidthCm || {}),
    JSON.stringify(s.memberTerritoryExpand || {}),
    JSON.stringify(s.donationLinks || {}),
    opts?.updatedAt ?? 0,
    opts?.donorTerritorySig ?? "",
  ].join("|");
}

/**
 * 관리자 iframe React key — 후원·updatedAt·donationLinks 등 volatile 필드 제외.
 * key 가 바뀔 때마다 iframe 이 리마운트되어 100cm 균등 기본 화면으로 되돌아가는 회귀 방지.
 * 후원·영토 갱신은 iframe 내부 폴링·localStorage 브로드캐스트로 반영.
 */
export function highSocietyAdminPreviewIframeKeySig(
  settings: HighSocietySettings | null | undefined
): string {
  const s = normalizeHighSocietySettings(settings);
  return [
    s.enabled ? "1" : "0",
    s.territoryPaused ? "1" : "0",
    s.territoryUpdateMode || "realtime",
    (s.seatMemberIds || []).join(","),
    s.seatMemberIdsManual ? "1" : "0",
    s.barStyle || "flat",
    s.fieldCm ?? "",
    s.startCmPerMember ?? "",
    s.round ?? 1,
    highSocietyFxToHsFxParam(normalizeHighSocietyFxSettings(s.fx)),
  ].join("|");
}

export function formatHighSocietyTimer(remainingSec: number): string {
  const s = Math.max(0, Math.floor(remainingSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function formatManWon(amount: number): string {
  const man = amount / 10000;
  if (man >= 100) return `${Math.round(man).toLocaleString("ko-KR")}만`;
  if (man >= 1) return `${(Math.round(man * 10) / 10).toLocaleString("ko-KR")}만`;
  return `${Math.max(0, Math.floor(amount)).toLocaleString("ko-KR")}원`;
}

export type HighSocietyBarStyle = "flat" | "arrow";

export const HIGH_SOCIETY_BAR_STYLES: Array<{
  id: HighSocietyBarStyle;
  label: string;
  desc: string;
}> = [
  {
    id: "flat",
    label: "평평(사각)",
    desc: "장벽(벽) + A~D 연속 영토 바 · 사각",
  },
  {
    id: "arrow",
    label: "화살표",
    desc: "장벽(벽) + 연속 바 · 세그먼트 끝 화살",
  },
];

export function parseHighSocietyBarStyle(raw: string | null | undefined): HighSocietyBarStyle {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "arrow" || v === "chevron" || v === "skew" || v === "tip" || v === "active") {
    return "arrow";
  }
  return "flat";
}

export function parseHighSocietySplit(
  bLeftRaw: string | null | undefined,
  cLeftRaw: string | null | undefined
): HighSocietyPushSplit {
  const parse = (raw: string | null | undefined, fallback: number) => {
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return clamp01(n > 1 ? n / 100 : n);
  };
  return { bLeft: parse(bLeftRaw, 0.5), cLeft: parse(cLeftRaw, 0.5) };
}

/** @deprecated 전장 총길이 URL — startCm 정본으로 대체. 하위호환 파싱만 유지 */
export function parseHighSocietyFieldCm(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Math.floor(Number(String(raw).replace(/[^\d]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(100, Math.min(20000, n));
}

/** 1인 시작 cm (?startCm=400) — 1..5000 */
export function parseHighSocietyStartCmPerMember(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Math.floor(Number(String(raw).replace(/[^\d]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.min(5000, n));
}

/** 1인 시작 cm → 전장 총길이 (참가 N명) */
export function fieldCmFromStartPerMember(startCm: number, seatCount: number): number {
  const n = Math.max(1, Math.min(HIGH_SOCIETY_MAX_SEATS, Math.floor(seatCount) || 4));
  const start = Math.max(1, Math.floor(Number(startCm) || 0));
  return Math.max(100, Math.min(20000, start * n));
}

/** 전장 총길이 → 1인 시작 cm */
export function startCmFromField(fieldCm: number, seatCount: number): number {
  const n = Math.max(1, Math.min(HIGH_SOCIETY_MAX_SEATS, Math.floor(seatCount) || 4));
  const field = Math.max(100, Math.floor(Number(fieldCm) || HIGH_SOCIETY_DEFAULT_FIELD_CM));
  return Math.max(1, Math.round(field / n));
}

/**
 * 전장·1인 시작 cm 계산용 좌석 수.
 * - seatMemberIds 가 있으면 실제 명수(1명 포함) 그대로
 * - actualSeatCount 가 있으면 해석된 좌석(유령 id 제외) 우선
 * - 자동(빈 배열)이면 actualSeatCount 또는 기본 4, 최소 2
 */
export function resolveHighSocietySeatCountForField(
  settings: Pick<HighSocietySettings, "seatMemberIds" | "seatMemberIdsManual">,
  actualSeatCount?: number
): number {
  const explicit = settings.seatMemberIds || [];
  const actual = Math.max(0, Math.floor(Number(actualSeatCount) || 0));
  if (isHighSocietySeatSelectionManual(settings)) {
    if (explicit.length === 0) {
      return actual;
    }
    if (actual >= 1) {
      return Math.max(1, Math.min(HIGH_SOCIETY_MAX_SEATS, actual));
    }
    return Math.max(1, Math.min(HIGH_SOCIETY_MAX_SEATS, explicit.length));
  }
  if (actual >= 1) {
    return Math.max(2, Math.min(HIGH_SOCIETY_MAX_SEATS, actual));
  }
  return 4;
}

/** 삭제·운영비 멤버 id — seatMemberIds 에 남은 유령 항목 제거 */
export function pruneHighSocietySeatMemberIds(
  settings: HighSocietySettings,
  members: Array<Pick<Member, "id" | "operating">>
): HighSocietySettings {
  if (!isHighSocietySeatSelectionManual(settings)) return settings;
  const playable = new Set(
    members.filter((m) => !m.operating).map((m) => String(m.id))
  );
  const pruned = (settings.seatMemberIds || [])
    .map((id) => String(id || "").trim())
    .filter((id) => playable.has(id));
  if (pruned.length === (settings.seatMemberIds || []).length) return settings;
  return { ...settings, seatMemberIds: pruned, seatMemberIdsManual: true };
}

/** 저장된 1인 시작 cm — startCmPerMember 우선, 없으면 fieldCm/N */
export function resolveHighSocietyStartCmPerMember(
  settings: Pick<HighSocietySettings, "fieldCm" | "startCmPerMember" | "seatMemberIds">,
  seatCount?: number
): number {
  const saved = Number(settings.startCmPerMember);
  if (Number.isFinite(saved) && saved > 0) {
    return Math.max(1, Math.min(5000, Math.floor(saved)));
  }
  const n = resolveHighSocietySeatCountForField(settings, seatCount);
  return startCmFromField(settings.fieldCm ?? HIGH_SOCIETY_DEFAULT_FIELD_CM, n);
}

/** 좌석 수·저장 startCm 기준 전장 총길이 — 미리보기·OFF 상태 일관 */
export function resolveHighSocietyEffectiveFieldCm(
  settings: Pick<HighSocietySettings, "fieldCm" | "startCmPerMember" | "seatMemberIds">,
  seatCount?: number
): number {
  const n = resolveHighSocietySeatCountForField(settings, seatCount);
  const start = resolveHighSocietyStartCmPerMember(settings, n);
  return fieldCmFromStartPerMember(start, n);
}

/** startCmPerMember 정본 — fieldCm = start × 좌석 수 로 저장값 정렬 */
export function reconcileHighSocietyFieldDimensions(
  settings: HighSocietySettings,
  actualSeatCount?: number,
  members?: Array<Pick<Member, "id" | "operating">>
): HighSocietySettings {
  let base = settings;
  if (members && members.length >= 0) {
    base = pruneHighSocietySeatMemberIds(settings, members);
  }
  const seatCount = resolveHighSocietySeatCountForField(base, actualSeatCount);
  const startCmPerMember = resolveHighSocietyStartCmPerMember(base, seatCount);
  const fieldCm = fieldCmFromStartPerMember(startCmPerMember, seatCount);
  if (
    base.startCmPerMember === startCmPerMember &&
    base.fieldCm === fieldCm &&
    (base.seatMemberIds || []).join(",") === (settings.seatMemberIds || []).join(",")
  ) {
    return base;
  }
  return { ...base, startCmPerMember, fieldCm };
}

/** 라운드 번호 (?round=1) — 1..99 */
export function parseHighSocietyRound(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(99, n);
}

/** 룰 권장 라운드 길이(초) — 1시간 */
export const HIGH_SOCIETY_ROUND_SEC = 60 * 60;

/** 레인/레이스용 단색 */
export const HIGH_SOCIETY_LANE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#ca8a04",
  "#dc2626",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#ea580c",
];

export function laneSolidColor(index: number): string {
  return HIGH_SOCIETY_LANE_COLORS[index % HIGH_SOCIETY_LANE_COLORS.length]!;
}

export function laneLetter(index: number): string {
  return String.fromCharCode(65 + (index % 26));
}

export function highSocietyPushDirLabel(dir: HighSocietyPushDir): string {
  if (dir === "left") return "← 왼쪽";
  if (dir === "right") return "오른쪽 →";
  return "↔ 양분";
}

export type HighSocietyExpandPressure = { left: number; right: number };

/**
 * 성장 연출 대상 — 본인 expandLeft/Right 가 늘었을 때만.
 * (이웃이 공격을 멈춰 수동적으로 넓어진 좌석은 연출하지 않음)
 */
export function detectHighSocietyGrowFlashSeatIds(
  seats: Array<{ id: string; expandLeftCm: number; expandRightCm: number }>,
  prev: Record<string, HighSocietyExpandPressure>
): { grownIds: string[]; nextPrev: Record<string, HighSocietyExpandPressure> } {
  const nextPrev: Record<string, HighSocietyExpandPressure> = { ...prev };
  const grownIds: string[] = [];
  for (const seat of seats) {
    const left = Math.max(0, Number(seat.expandLeftCm) || 0);
    const right = Math.max(0, Number(seat.expandRightCm) || 0);
    const before = prev[seat.id];
    if (before && (left > before.left + 0.05 || right > before.right + 0.05)) {
      grownIds.push(seat.id);
    }
    nextPrev[seat.id] = { left, right };
  }
  return { grownIds, nextPrev };
}

/** admin patchHighSocietySettings — persistState 토스트 라벨(저장 완료 시 서버 확인 문구와 합쳐짐) */
export function buildHighSocietySettingsPersistToast(args: {
  patch: HighSocietySettingsAdminPatch;
  before: HighSocietySettings;
  wasOn: boolean;
  after: HighSocietySettings;
  resetTerritory: boolean;
  members: Member[];
}): string | null {
  const { patch, before, wasOn, after, resetTerritory, members } = args;
  if (resetTerritory) {
    return `상류사회 · 영토만 초기화 (${after.round || 1}라운드 · 기존 후원 영토 OFF · 합산·금액 유지)`;
  }
  if (typeof patch.enabled === "boolean" && patch.enabled !== wasOn) {
    return patch.enabled
      ? isHighSocietyReopen(before)
        ? "상류사회 재ON — 기존 영토 유지, 후원 리스트에서 영토 ON 한 건만 반영"
        : "상류사회 ON — 기존 후원은 영토 OFF, 후원 리스트에서 영토 ON 한 건만 반영"
      : "상류사회 OFF — 영토는 리셋 전까지 유지(OFF 이후 후원은 영토 미반영)";
  }
  if (patch.defaultMiddlePush && after.defaultMiddlePush !== before.defaultMiddlePush) {
    const dir = resolveSystemMiddlePushDir(after);
    return `상류사회 · 가운데 기본 확장 → ${dir === "left" ? "← 왼쪽" : "→ 오른쪽"} (시스템 추종 후원에 적용)`;
  }
  if (typeof patch.fieldCm === "number" && Number(patch.fieldCm) !== Number(before.fieldCm)) {
    const seats = Math.max(
      2,
      resolveHighSocietySeatMembers(members, after).length || 4
    );
    const start = Math.round(startCmFromField(after.fieldCm || HIGH_SOCIETY_DEFAULT_FIELD_CM, seats));
    return `상류사회 · 1인 시작 ${start.toLocaleString("ko-KR")}cm (전장 ${(after.fieldCm || 0).toLocaleString("ko-KR")}cm · ${seats}명)`;
  }
  if (patch.territoryUpdateMode && patch.territoryUpdateMode !== before.territoryUpdateMode) {
    return patch.territoryUpdateMode === "onRoundEnd"
      ? "상류사회 · 영토 갱신: 라운드 종료 후"
      : "상류사회 · 영토 갱신: 실시간";
  }
  if (typeof patch.territoryPaused === "boolean" && patch.territoryPaused !== before.territoryPaused) {
    return patch.territoryPaused
      ? "상류사회 · 영토 일시정지 — 게이지만 동결(후원·투네 합산은 계속 반영)"
      : "상류사회 · 영토 재개 — 일시정지 중 후원은 합산만 반영(영토 미반영)";
  }
  if (patch.fx) {
    const fx = normalizeHighSocietyFxSettings(after.fx);
    const labels = [
      fx.frontier ? "전선" : null,
      fx.growFlash ? "플래시" : null,
      fx.contestedEdge ? "분쟁" : null,
      fx.arrowBlade ? "칼날" : null,
      fx.strongOutline ? "외곽선" : null,
    ].filter(Boolean);
    return labels.length > 0
      ? `상류사회 · 연출 ON: ${labels.join(" · ")}`
      : "상류사회 · 연출 효과 전부 OFF";
  }
  if (Array.isArray(patch.seatMemberIds)) {
    const seats = resolveHighSocietySeatMembers(members, after);
    if (isHighSocietySeatSelectionManual(after) && after.seatMemberIds.length === 0) {
      return "상류사회 · 좌석 없음 — 아래에서 멤버를 추가하세요";
    }
    if (!isHighSocietySeatSelectionManual(after) && after.seatMemberIds.length === 0) {
      return "상류사회 · 자동(전원 N등분)";
    }
    if (seats.length >= 1) {
      return `상류사회 · 좌석 배치: ${seats.map((s) => s.name).join(" → ")}`;
    }
    return "상류사회 · 좌석 없음 — 아래에서 멤버를 추가하세요";
  }
  if (patch.barStyle && patch.barStyle !== before.barStyle) {
    return `상류사회 · 게이지 스타일: ${patch.barStyle === "arrow" ? "화살표" : "평평"}`;
  }
  return "상류사회 설정";
}
