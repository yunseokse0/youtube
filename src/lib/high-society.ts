import type {
  AppState,
  Donor,
  HighSocietyFxSettings,
  HighSocietyPushDir,
  HighSocietySettings,
  Member,
} from "@/types";

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
/** 기본 전장 가로(cm) — 멤버 수와 무관, N등분 */
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

export function formatCm(cm: number): string {
  const v = Math.max(0, Math.round(cm * 10) / 10);
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
    if (key && Number.isFinite(n) && n >= 0) out[key] = Math.round(n * 10) / 10;
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

/** seatMemberIds 비어 있으면 로스터(전원) 순서로 간주 */
export function effectiveHighSocietySeatOrder(
  seatMemberIds: string[] | null | undefined,
  rosterMemberIds: string[]
): string[] {
  const explicit = normalizeSeatIdList(seatMemberIds);
  if (explicit.length > 0) return explicit;
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
  const seatCountForStart = resolveHighSocietySeatCountForField({ seatMemberIds });
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
  return {
    enabled: Boolean(v.enabled),
    seatMemberIds,
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
 * - ON: link.startedAt 이후 + (최초 ON 구간 | OFF 이전 baseline | 재ON 이후)
 * - OFF: OFF 시각 이전만 유지(리셋 전까지 동결)
 * - 일시정지: 진행 중·재개 후 completed windows 구간 후원은 영토 제외(합산은 유지)
 */
export function shouldDonorCountForHighSocietyTerritory(
  d: Pick<Donor, "amount" | "donationExcluded" | "hsTerritoryExcluded" | "at">,
  settings: HighSocietySettings,
  link: { active: boolean; startedAt?: number }
): boolean {
  if (!link.active) return false;
  if (isDonorHsTerritoryExcluded(d)) return false;
  if (d.donationExcluded === true) return false;
  if (Math.max(0, Number(d.amount) || 0) <= 0) return false;
  if (!isDonationAmountEligibleForHighSocietyTerritory(d.amount)) return false;

  const at = highSocietyDonorAtMs(d);
  const startedAt = Number(link.startedAt);
  if (Number.isFinite(startedAt) && startedAt > 0 && at < Math.floor(startedAt)) return false;

  if (isDonorInTerritoryPauseExcludeWindows(at, settings)) return false;

  const pausedAtRaw = Number(settings.territoryPausedAt);
  const pausedAt =
    settings.territoryPaused && Number.isFinite(pausedAtRaw) && pausedAtRaw > 0
      ? Math.floor(pausedAtRaw)
      : null;
  if (pausedAt && at >= pausedAt) return false;

  const lastOffAtRaw = Number(settings.territoryCutoffAt);
  const reopenAtRaw = Number(settings.territoryReopenAt);
  const lastOffAt = Number.isFinite(lastOffAtRaw) && lastOffAtRaw > 0 ? Math.floor(lastOffAtRaw) : null;
  const reopenAt = Number.isFinite(reopenAtRaw) && reopenAtRaw > 0 ? Math.floor(reopenAtRaw) : null;

  if (!settings.enabled) {
    /** cutoff 없으면 OFF 이후 후원이 영토에 섞이지 않게 집계 제외 */
    if (!lastOffAt) return false;
    return at < lastOffAt;
  }

  if (!lastOffAt && !reopenAt) return true;
  if (reopenAt && at >= reopenAt) return true;
  if (lastOffAt && at < lastOffAt) return true;
  return false;
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
  const rosterIds = resolveHighSocietySeatMembers(members, null).map((s) => s.id);
  const reorderOnly =
    nextSettings.enabled &&
    seatsChanged &&
    isSeatMemberIdsReorderOnly(prevSeatIds, nextSeatIds, rosterIds);

  const seatMembers = resolveHighSocietySeatMembers(members, nextSettings.seatMemberIds);
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

  const buildReorderWidthSnapshot = (): Partial<HighSocietySettings> => {
    /** 화면에 보이는 영토(기존 memberWidthCm 포함)를 기준으로 스냅샷 — index 물리 재계산 금지 */
    const prevField = buildHighSocietyFieldFromAppState({
      members,
      donors: (opts.donors ?? []) as Donor[],
      highSocietySettings: prevSettings,
    });
    const memberWidthCm: Record<string, number> = {};
    const memberWidthDonationSnapshot: Record<string, number> = {};
    const memberTerritoryExpand: Record<string, { expandLeftCm: number; expandRightCm: number }> =
      {};
    for (const s of prevField.seats) {
      const expand = (s.expandLeftCm || 0) + (s.expandRightCm || 0);
      const startCm = prevField.startCm;
      const widthCm =
        expand > 0 && s.widthCm < startCm * 0.5
          ? Math.round((startCm + expand) * 10) / 10
          : s.widthCm;
      memberWidthCm[s.id] = widthCm;
      memberWidthDonationSnapshot[s.id] = s.donationWon;
      memberTerritoryExpand[s.id] = {
        expandLeftCm: s.expandLeftCm,
        expandRightCm: s.expandRightCm,
      };
    }
    return { memberWidthCm, memberWidthDonationSnapshot, memberTerritoryExpand };
  };

  const memberWidthPatch =
    resetTerritory || firstOn || turningOff || (seatsChanged && !reorderOnly)
      ? clearMemberWidthSnapshot()
      : reorderOnly
        ? buildReorderWidthSnapshot()
        : {};

  if (!resetTerritory && !turningOn && !(nextSettings.enabled && seatsChanged)) {
    return {
      ...nextSettings,
      donationLinks: normalizeHighSocietyDonationLinks(nextSettings.donationLinks, valid),
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
  } else {
    const steal = Math.min(-net, widths[leftIdx]!);
    widths[rightIdx]! += steal;
    widths[leftIdx]! -= steal;
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
      expandLeftCm = expandCm * bLeft;
      expandRightCm = expandCm * (1 - bLeft);
    } else if (n === 4 && i === 2) {
      expandLeftCm = expandCm * cLeft;
      expandRightCm = expandCm * (1 - cLeft);
    } else {
      expandLeftCm = expandCm * middleLeft;
      expandRightCm = expandCm * (1 - middleLeft);
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
  if (Math.abs(sum - fieldCm) > 0.01) {
    const alive = widths.map((w, i) => (w > 0 ? i : -1)).filter((i) => i >= 0);
    const last = alive[alive.length - 1] ?? 0;
    widths[last]! += fieldCm - sum;
  }

  const seats: HighSocietySeat[] = filled.map((f, i) => {
    const widthCm = Math.max(0, Math.round(widths[i]! * 10) / 10);
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
      const target = Math.round((startCm + expand) * 10) / 10;
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
    out[p.id] = Math.max(0, Math.round(out[p.id]! * shrink * 10) / 10);
  }
  const sum = players.reduce((s, p) => s + (out[p.id] || 0), 0);
  if (Math.abs(sum - fieldCm) > 0.5 && others[0]) {
    out[others[0].id] = Math.max(
      0,
      Math.round(((out[others[0].id] || 0) + (fieldCm - sum)) * 10) / 10
    );
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
    return startCm;
  });
  let sum = rawWidths.reduce((s, w) => s + w, 0);
  if (sum <= 0) sum = fieldCm;
  const scale = fieldCm / sum;

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
    const widthCm = Math.max(0, Math.round(rawWidths[i]! * scale * 10) / 10);
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
  opts?: { fieldCm?: number; split?: Partial<HighSocietyPushSplit>; seatMemberIds?: string[] }
) {
  const playable = resolveHighSocietySeatMembers(members, opts?.seatMemberIds);
  return resolveHighSocietyField({
    players: playable,
    fieldCm: opts?.fieldCm,
    split: opts?.split,
  });
}

export function resolveHighSocietySeatMembers(
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>,
  seatMemberIds?: string[] | null
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

  const ids = (seatMemberIds || []).map((id) => String(id || "").trim()).filter(Boolean);
  /** 명시 목록(1명 이상)은 그대로 사용. 빈 배열만 전원 N등분 fallback */
  if (ids.length >= 1) {
    const picked = ids
      .map((sid) => {
        const m = byId.get(sid);
        if (!m || m.operating) return null;
        return { id: m.id, name: m.name, donationWon: m.donationWon };
      })
      .filter((x): x is { id: string; name: string; donationWon: number } => Boolean(x))
      .slice(0, HIGH_SOCIETY_MAX_SEATS);
    if (picked.length >= 1) return picked;
  }
  return fallback;
}

export function seatRoleForMemberId(
  settings: HighSocietySettings,
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>,
  memberId: string
): HighSocietySeatRole | null {
  const seats = resolveHighSocietySeatMembers(members, settings.seatMemberIds);
  const idx = seats.findIndex((s) => s.id === String(memberId || "").trim());
  if (idx < 0) return null;
  const expandDir = seatExpandDirForIndex(idx, seats.length);
  return {
    index: idx,
    canChoosePush: expandDir === "both",
    expandDir,
  };
}

export function isDonorHsTerritoryExcluded(d: Pick<Donor, "hsTerritoryExcluded">): boolean {
  return d.hsTerritoryExcluded === true;
}

/**
 * 상류사회 ON/OFF 등 admin patch 직전 — React·LS·ref 중 비어 있는 쪽이
 * 실후원을 지우지 않게 id 기준 union(금액·at 더 풍부한 행 우선).
 */
export function mergeDonorRostersPreferFullest(
  ...sources: Array<Donor[] | null | undefined>
): Donor[] {
  const byId = new Map<string, Donor>();
  for (const src of sources) {
    for (const d of src || []) {
      if (!d || typeof d !== "object") continue;
      const id = String(d.id || "").trim();
      if (!id) continue;
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, d);
        continue;
      }
      const existingAmt = Math.max(0, Math.round(Number(existing.amount) || 0));
      const nextAmt = Math.max(0, Math.round(Number(d.amount) || 0));
      const existingAt = Number(existing.at || 0);
      const nextAt = Number(d.at || 0);
      if (nextAmt > existingAmt || (nextAmt === existingAmt && nextAt >= existingAt)) {
        byId.set(id, d);
      }
    }
  }
  return Array.from(byId.values());
}

/**
 * 상류사회 설정 저장 시 donors 를 서버에 권위적으로 올려야 하는 patch 인지.
 * 영토 일시정지·OFF·재ON·좌석 등은 후원 rows 를 건드리지 않는다.
 */
export function shouldPersistDonorsForHighSocietySettingsPatch(opts: {
  resetTerritory: boolean;
  isFirstOn: boolean;
}): boolean {
  return Boolean(opts.resetTerritory || opts.isFirstOn);
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
  const shouldMarkHsTerritoryOff =
    (opts.resetTerritory || opts.isFirstOn) && prevDonors.length > 0;
  return shouldMarkHsTerritoryOff
    ? markDonorsHsTerritoryExcluded(prevDonors, true)
    : prevDonors;
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
    const link = resolveHighSocietyDonationLink(settings, player.id);
    const rows = (donors || []).filter((d) => {
      if (String(d.memberId || "") !== player.id) return false;
      return shouldDonorCountForHighSocietyTerritory(d, settings, link);
    });

    if (rows.length === 0) {
      const cm = 0;
      const base = { id: player.id, name: player.name, donationWon: 0 };
      if (dir === "right") return { ...base, expandLeftCm: 0, expandRightCm: cm };
      if (dir === "left") return { ...base, expandLeftCm: cm, expandRightCm: 0 };
      const lr = pushDirToLeftRight(cm, middleDir);
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
      if (dir === "right") {
        right += cm;
        continue;
      }
      if (dir === "left") {
        left += cm;
        continue;
      }
      const push = parseHighSocietyPushDir(d.hsPushDir) || middleDir;
      const lr = pushDirToLeftRight(cm, push);
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

/** AppState 기준 영토 해상 (좌석·후원 방향 반영) */
export function buildHighSocietyFieldFromAppState(
  state: Pick<AppState, "members" | "donors" | "highSocietySettings">,
  opts?: { fieldCmOverride?: number }
) {
  const settings = normalizeHighSocietySettings(state.highSocietySettings);
  const seatPlayers = resolveHighSocietySeatMembers(state.members || [], settings.seatMemberIds).map(
    (p) => ({ ...p, donationWon: 0 })
  );
  const seatCount = resolveHighSocietySeatCountForField(settings, seatPlayers.length);
  const overrideRaw = Number(opts?.fieldCmOverride);
  const effectiveFieldCm =
    Number.isFinite(overrideRaw) && overrideRaw > 0
      ? Math.max(100, Math.min(20000, Math.floor(overrideRaw)))
      : resolveHighSocietyEffectiveFieldCm(settings, seatCount);
  const settingsForField =
    Number.isFinite(overrideRaw) && overrideRaw > 0
      ? normalizeHighSocietySettings({
          ...settings,
          startCmPerMember: startCmFromField(effectiveFieldCm, seatCount),
          fieldCm: effectiveFieldCm,
        })
      : settings;
  const players = aggregateSeatPushesFromDonors({
    seatPlayers,
    donors: state.donors || [],
    settings: settingsForField,
  });
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

/** 전장 총길이 (?fieldCm=1600) — 100..20000 */
export function parseHighSocietyFieldCm(raw: string | null | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Math.floor(Number(String(raw).replace(/[^\d]/g, "")));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(100, Math.min(20000, n));
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
 * - 자동(빈 배열)이면 actualSeatCount 또는 기본 4, 최소 2
 */
export function resolveHighSocietySeatCountForField(
  settings: Pick<HighSocietySettings, "seatMemberIds">,
  actualSeatCount?: number
): number {
  const explicit = settings.seatMemberIds;
  if (Array.isArray(explicit) && explicit.length > 0) {
    return Math.max(1, Math.min(HIGH_SOCIETY_MAX_SEATS, explicit.length));
  }
  const n = Math.floor(Number(actualSeatCount) || 0);
  if (n >= 1) {
    return Math.max(2, Math.min(HIGH_SOCIETY_MAX_SEATS, n));
  }
  return 4;
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
