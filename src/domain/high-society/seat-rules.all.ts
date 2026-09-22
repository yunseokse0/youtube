import type {
  AppState,
  Donor,
  HighSocietyFxSettings,
  HighSocietyPushDir,
  HighSocietySettings,
  HighSocietyTeam,
  Member,
  TerritoryLog,
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
  /** @deprecated 후원 합계. 영토 해상에는 쓰지 않음(항상 0) */
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
    /** ✅ 2026-09-13 벽 사라짐 Bug Fix:
     *  사용자 제보: "영토 오버레이에 벽이 어느순간 사라짐"
     *  기존 기본값 contestedEdge=false + CSS에서 contested OFF시 border를 2px 45% 반투명 검정으로 약화시켜
     *  채도 높은 색상 영토 칸 사이에서 벽 구분선이 시각적으로 사라지는 Bug.
     *  Fix: 기본값 frontier(영토 가장자리 장식) + contestedEdge(진한 벽 구분선) 를 모두 true 로 켜서
     *       신규 유저 settings 초기화시에도 벽 구분선이 항상 명확히 보이도록 기본값 상향.
     */
    frontier: true,
    growFlash: false,
    contestedEdge: true,
    arrowBlade: false,
    strongOutline: false,
  };
}

export function normalizeHighSocietyFxSettings(input: unknown): HighSocietyFxSettings {
  const base = defaultHighSocietyFxSettings();
  if (!input || typeof input !== "object") return base;
  const v = input as Partial<HighSocietyFxSettings>;
  /** ✅ 2026-09-13 Fix: 사용자가 명시적으로 false/true 로 준 값만 적용하고, undefined(저장된 적 없음) 는 기본값(true) 유지.
   *  기존: `frontier: v.frontier === true` → undefined 일때 강제로 false 로 떨어져서 벽/장식이 꺼지던 Bug.
   *  Fix: 각 필드마다 `undefined 아니면 명시값` else `defaultHighSocietyFxSettings의 기본값(true)` 적용 */
  const coerce = (raw: unknown, fallback: boolean): boolean =>
    raw === undefined ? fallback : raw === true;
  return {
    frontier: coerce(v.frontier, base.frontier),
    growFlash: coerce(v.growFlash, base.growFlash),
    contestedEdge: coerce(v.contestedEdge, base.contestedEdge),
    arrowBlade: coerce(v.arrowBlade, base.arrowBlade),
    strongOutline: coerce(v.strongOutline, base.strongOutline),
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

export function normalizeTeam(raw: unknown): HighSocietyTeam | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id || "").trim();
  if (!id) return null;
  const name = String(r.name || "").trim() || id;
  const color = typeof r.color === "string" && /^#[0-9a-f]{3,8}$/i.test(r.color.trim()) ? r.color.trim() : undefined;
  const hintRaw = Number(r.seatOrderHint);
  const seatOrderHint = Number.isFinite(hintRaw) ? Math.floor(hintRaw) : undefined;
  return { id, name, ...(color ? { color } : {}), ...(seatOrderHint !== undefined ? { seatOrderHint } : {}) };
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
    matchMode: "individual",
    teams: [],
    memberTeamAssignments: {},
  };
}

/** 초기값과 동일(영토·좌석·라운드 이력 없음)
 *  — 소린 10cm 확장 / memberTerritoryExpand / memberWidthCm / territoryLogs 1건 이상이면
 *    기본값이 아님(false)으로 판정해야 regression heal 로 기존 10cm → 0cm revert 되는 현상 차단 */
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
  if (Object.keys(s.memberTerritoryExpand || {}).length > 0) return false;
  if (Object.keys(s.memberWidthCm || {}).length > 0) return false;
  if (Object.keys(s.memberWidthDonationSnapshot || {}).length > 0) return false;
  if (Array.isArray((s as { territoryLogs?: unknown[] }).territoryLogs) && (s as { territoryLogs?: unknown[] }).territoryLogs!.length > 0) return false;
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
  if (Object.keys(s.memberTerritoryExpand || {}).length > 0) return true;
  if (Object.keys(s.memberWidthCm || {}).length > 0) return true;
  if (Object.keys(s.memberWidthDonationSnapshot || {}).length > 0) return true;
  if (Array.isArray((s as { territoryLogs?: unknown[] }).territoryLogs) && (s as { territoryLogs?: unknown[] }).territoryLogs!.length > 0) return true;
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
  const baseN = base ? normalizeHighSocietySettings(base) : null;
  const patchN = patch ? normalizeHighSocietySettings(patch) : null;
  // ✅ 2026-09-22 v15 Hotfix: 명시적 ON/OFF 토글은 절대 regression guard 로 막으면 안됨
  //   → 사용자가 OFF → ON 또는 ON → OFF 버튼 클릭시 그 즉시 허용 (그 외 모든 wipe block은 정상 유지)
  // ✅ 2026-09-22 v15.1 Hotfix: enabled가 달라도 patch 자체가 완전 기본값 꼴이면 stale 스냅샷이므로 차단 로직 계속 진행
  //   → SSE 폴링으로 들어온 깡통 기본값(enabled:false + seat[] + field 1200 등)이 사용자의 저장된 ON 설정을 덮어쓰는 롤백 버그 방지
  if (
    Boolean(patchN?.enabled) !== Boolean(baseN?.enabled) &&
    !isDefaultLikeHighSocietySettings(patchN)
  ) {
    return false;
  }
  if (!isMeaningfulHighSocietySettings(base)) return false;
  const baseRound = Math.max(1, Math.floor(Number(base?.round) || 1));
  const patchRound = Math.max(1, Math.floor(Number(patch?.round) || 1));
  /** ✅ 2026-09-06 Hotfix: patch.round > base.round = 명시적 영토 초기화(resetTerritory) 시그니처.
   *  기존 regression guard가 reset 후의 깨끗한 snapshot undefined 패턴을 기본값 롤백으로 오판하여
   *  base의 구 넓은 memberWidthCm을 살려버리는 회귀 방지. round bump는 의도적 리셋이므로 bypass. */
  if (patchRound > baseRound) return false;
  const raw = patch && typeof patch === "object" ? (patch as Record<string, unknown>) : null;
  if (
    raw &&
    ("startCmPerMember" in raw || "fieldCm" in raw) &&
    ("memberWidthCm" in raw || "memberWidthDonationSnapshot" in raw || "memberTerritoryExpand" in raw)
  ) {
    return false;
  }
  return isDefaultLikeHighSocietySettings(patch);
}

function hasMemberWidthSnapshot(
  settings: HighSocietySettings | null | undefined
): boolean {
  const widths = settings?.memberWidthCm;
  return Boolean(widths && Object.keys(widths).length > 0);
}

function hasMemberTerritoryExpand(
  settings: HighSocietySettings | null | undefined
): boolean {
  const expand = settings?.memberTerritoryExpand;
  return Boolean(expand && Object.keys(expand).length > 0);
}

function hasTerritoryLogs(
  settings: HighSocietySettings | null | undefined
): boolean {
  return Array.isArray((settings as { territoryLogs?: unknown[] } | null)?.territoryLogs) && 
    ((settings as { territoryLogs?: unknown[] }).territoryLogs?.length ?? 0) > 0;
}

/**
 * OBS·오버레이 sync — 후원 GET/SSE 직후 HS 가 기본값·스냅샷 누락으로 덮이지 않게.
 * donors/members 는 건드리지 않고 highSocietySettings 만 병합한다.
 * — 상호 Complement: base에만 있고 inc에 없는 스냅샷은 base 살리고, inc에만 있고 base에 없는 expand/logs는 inc 살림 (어느 한쪽만 누락 시 양쪽 merge 해서 영구 소실 방지)
 */
export function mergeHighSocietySettingsPreferBaseline(
  baseline: HighSocietySettings | null | undefined,
  incoming: HighSocietySettings | null | undefined
): HighSocietySettings {
  const base = baseline ? normalizeHighSocietySettings(baseline) : null;
  const inc = normalizeHighSocietySettings(incoming);
  if (!base || !isMeaningfulHighSocietySettings(base)) return inc;
  if (shouldBlockHighSocietyRegression(base, inc)) return base;

  const incRound = Math.max(1, Math.floor(Number(inc.round) || 1));
  const baseRound = Math.max(1, Math.floor(Number(base.round) || 1));
  const incResetAt = Number(inc.territoryLogsResetAt || 0);
  const baseResetAt = Number(base.territoryLogsResetAt || 0);
  /** 영토만 초기화 — 구 스냅샷·기록부를 baseline 에서 되살리지 않음 */
  if (incRound > baseRound || incResetAt > baseResetAt) return inc;

  const patch: Partial<HighSocietySettings> = { ...inc };
  let hasPatch = false;

  if (hasMemberWidthSnapshot(base) && !hasMemberWidthSnapshot(inc)) {
    patch.memberWidthCm = base.memberWidthCm;
    patch.memberWidthDonationSnapshot = base.memberWidthDonationSnapshot ?? inc.memberWidthDonationSnapshot;
    hasPatch = true;
  }
  if (hasMemberTerritoryExpand(base) && !hasMemberTerritoryExpand(inc)) {
    patch.memberTerritoryExpand = base.memberTerritoryExpand;
    hasPatch = true;
  }
  if (hasTerritoryLogs(base) && !hasTerritoryLogs(inc)) {
    (patch as { territoryLogs?: unknown[] }).territoryLogs = (base as { territoryLogs?: unknown[] }).territoryLogs;
    hasPatch = true;
  }
  /** stale wire 가 팀 목록을 비우면 팀전 설정 유지 (matchMode 키 누락 → individual 폴백 방지) */
  if (
    base.matchMode === "team" &&
    (base.teams || []).length > 0 &&
    (inc.teams || []).length === 0 &&
    inc.matchMode !== "individual"
  ) {
    patch.matchMode = "team";
    patch.teams = base.teams;
    patch.memberTeamAssignments = {
      ...(base.memberTeamAssignments || {}),
      ...(inc.memberTeamAssignments || {}),
    };
    hasPatch = true;
  }
  // 반대 방향: inc 에만 스냅샷 있고 base 에 없을 때는 inc 유지 (return inc)
  return hasPatch ? normalizeHighSocietySettings({ ...inc, ...patch }) : inc;
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
  const logsResetRaw = Number(v.territoryLogsResetAt);
  const territoryLogsResetAt =
    Number.isFinite(logsResetRaw) && logsResetRaw > 0 ? Math.floor(logsResetRaw) : undefined;
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
  /**
   * matchMode 키가 빠진 stale PATCH/SSE 는 teams 가 있으면 팀전으로 복구.
   * 명시적 "individual" 은 팀이 남아 있어도 개인전 유지.
   */
  const matchMode: "individual" | "team" =
    v.matchMode === "team"
      ? "team"
      : v.matchMode === "individual"
        ? "individual"
        : Array.isArray(v.teams) && v.teams.length > 0
          ? "team"
          : "individual";
  const teamsArr = Array.isArray(v.teams) ? v.teams.map(normalizeTeam).filter((t): t is HighSocietyTeam => Boolean(t)) : [];
  const assignmentsRaw = v.memberTeamAssignments;
  const memberTeamAssignments: Record<string, string> =
    assignmentsRaw && typeof assignmentsRaw === "object" && !Array.isArray(assignmentsRaw)
      ? Object.fromEntries(
          Object.entries(assignmentsRaw as Record<string, unknown>)
            .map(([k, val]) => [String(k || "").trim(), String(val || "").trim()])
            .filter(([k, val]) => k && val)
        )
      : {};
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
    ...(territoryLogsResetAt !== undefined ? { territoryLogsResetAt } : {}),
    ...(territoryReopenAt !== undefined ? { territoryReopenAt } : {}),
    ...(territoryPaused ? { territoryPaused: true } : {}),
    ...(territoryPaused && territoryPausedAt !== undefined ? { territoryPausedAt } : {}),
    ...(territoryPauseExcludeWindows.length > 0 ? { territoryPauseExcludeWindows } : {}),
    ...(donationSyncModeBeforePause !== undefined ? { donationSyncModeBeforePause } : {}),
    ...(memberWidthCm ? { memberWidthCm } : {}),
    ...(memberWidthDonationSnapshot ? { memberWidthDonationSnapshot } : {}),
    ...(memberTerritoryExpand ? { memberTerritoryExpand } : {}),
    ...(zeroCmGaugeDisplay !== "hidden" ? { zeroCmGaugeDisplay } : {}),
    matchMode,
    teams: teamsArr,
    memberTeamAssignments,
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
 * 영토는 「영토 기록부」 수동 cm만 반영 — 후원 리스트(금액·영토 ON)는 집계하지 않음.
 */
export function shouldDonorCountForHighSocietyTerritory(
  _d: Pick<Donor, "amount" | "donationExcluded" | "hsTerritoryExcluded" | "at">,
  _settings: HighSocietySettings,
  _link: { active: boolean; startedAt?: number }
): boolean {
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

/**
 * 상류사회 설정 변경 시 영토 스냅샷·라운드만 맞춤.
 * 후원 연동(donationLinks)은 하위 호환으로 유지하되 영토 계산에 쓰지 않는다.
 */
export function mergeHighSocietyDonationLinksOnSettingsChange(opts: {
  prevSettings: HighSocietySettings;
  nextSettings: HighSocietySettings;
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>;
  resetTerritory?: boolean;
  donors?: Array<Pick<Donor, "memberId" | "amount" | "hsPushDir" | "donationExcluded" | "hsTerritoryExcluded" | "at">>;
  territoryLogs?: Array<Pick<TerritoryLog, "id" | "memberId" | "delta" | "amount" | "pushDir">>;
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
        territoryLogsResetAt: now,
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

  const preserveWidthsByMemberId = (): Partial<HighSocietySettings> => {
    const prevWidths = prevSettings.memberWidthCm || {};
    const prevExpands = prevSettings.memberTerritoryExpand || {};
    const prevSeated = new Set(resolveHighSocietySeatMembers(members, prevSettings).map((s) => s.id));
    const nextPlayers = resolveHighSocietySeatMembers(members, nextSettings);
    const startW = Math.max(
      0,
      Math.round(resolveHighSocietyStartCmPerMember(nextSettings, nextPlayers.length))
    );
    const memberWidthCm: Record<string, number> = {};
    const memberWidthDonationSnapshot: Record<string, number> = {};
    const memberTerritoryExpand: Record<string, { expandLeftCm: number; expandRightCm: number }> = {};
    for (const p of nextPlayers) {
      const wasSeated = prevSeated.has(p.id);
      const snapW = Number(prevWidths[p.id]);
      memberWidthCm[p.id] = wasSeated && Number.isFinite(snapW) && snapW >= 0 ? Math.round(snapW) : startW;
      memberWidthDonationSnapshot[p.id] = 0;
      const prevExp = wasSeated ? prevExpands[p.id] : undefined;
      memberTerritoryExpand[p.id] = {
        expandLeftCm: Math.max(0, Number(prevExp?.expandLeftCm) || 0),
        expandRightCm: Math.max(0, Number(prevExp?.expandRightCm) || 0),
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
    resetTerritory || clearWidthsOnSeatChange
      ? clearMemberWidthSnapshot()
      : preserveLayoutOnSeatChange
        ? preserveWidthsByMemberId()
        : {};

  const prevRound = Math.max(1, Math.floor(Number(prevSettings.round) || 1));
  return {
    ...nextSettings,
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

  const filled = players.map((p, i) => {
    const dir = seatExpandDirForIndex(i, n);
    const expandLeftCm = Math.max(0, Number(p?.expandLeftCm) || 0);
    const expandRightCm = Math.max(0, Number(p?.expandRightCm) || 0);
    const letter = seatIndexLabel(i);
    return {
      letter,
      seatIndex: i,
      id: p?.id ? String(p.id) : `seat-${letter}`,
      name: p?.name?.trim() || `플레이어 ${letter}`,
      donationWon: 0,
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
    /**
     * ✅ 2026-09-14 LIVE BUG FIX: "탈락 멤버 맨 뒤로 이동시 다른 멤버 영토 사라짐"
     *  - 이전 버그: seat 이동/재정렬 시 hasExplicitZero=true + raw sum < fieldCm 이면 scaling 완전 bypass
     *    → 0cm 탈락 멤버 1명이 이동하는 순간 alive 멤버들의 width 합이 fieldCm 보다 작아져도
     *      비율 보정 없이 rawWidths 그대로 저장 → 영토가 사라지는 현상
     *  - Fix: 0cm 슬롯은 그대로 유지하되, alive 멤버의 width 합만 fieldCm 에 가깝게 정규화하여
     *    기존 비율 보존 + 전체 영토 절대값 보존 + 0cm 탈락 슬롯 유지 3마리 토끼 동시 충족.
     */
    const zeroSlotMask = rawWidths.map((w) => w === 0);
    const aliveIdx = zeroSlotMask.map((isZero, i) => (isZero ? -1 : i)).filter((i) => i >= 0);
    const aliveSum = aliveIdx.reduce((s, i) => s + (rawWidths[i] || 0), 0);
    const zeroSlots = zeroSlotMask.filter(Boolean).length;
    const targetAliveTotal = Math.max(1, fieldCm - 0 * zeroSlots);
    if (aliveIdx.length > 0 && aliveSum > 0 && Math.abs(aliveSum - targetAliveTotal) >= 1) {
      const ratio = targetAliveTotal / aliveSum;
      scaledWidths = rawWidths.slice();
      for (const i of aliveIdx) {
        scaledWidths[i] = (rawWidths[i] || 0) * ratio;
      }
    } else {
      scaledWidths = rawWidths;
    }
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
        donationWon: 0,
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
      donationWon: 0,
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
        if (!m) return null;
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
  void opts;
  return false;
}

/** 상류사회는 후원을 건드리지 않음 — 영토 기록부만 사용 */
export function shouldMarkDonorsLocallyForHighSocietySettingsPatch(opts: {
  resetTerritory: boolean;
  isFirstOn: boolean;
}): boolean {
  void opts;
  return false;
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

/** 상류사회 ON/OFF 는 후원 동기화 모드를 바꾸지 않음 (영토는 기록부만) */
export function resolveDonationSyncModeForHighSocietySettingsChange(opts: {
  turningOn: boolean;
  turningOff: boolean;
  prevMode: AppState["donationSyncMode"] | undefined;
}): NonNullable<AppState["donationSyncMode"]> {
  void opts.turningOn;
  void opts.turningOff;
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
 * 상류사회 설정 patch 직전 donors 확정.
 * 영토는 기록부만 쓰므로 hsTerritoryExcluded 표시를 하지 않는다.
 */
export function resolveDonorsForHighSocietySettingsPatch(opts: {
  prevDonorsReact: Donor[] | null | undefined;
  refDonors: Donor[] | null | undefined;
  lsDonors: Donor[] | null | undefined;
  resetTerritory: boolean;
  isFirstOn: boolean;
}): Donor[] {
  void opts.resetTerritory;
  void opts.isFirstOn;
  return mergeDonorRostersPreferFullest(
    opts.prevDonorsReact,
    opts.refDonors,
    opts.lsDonors
  );
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

/** @deprecated 후원 금액은 영토에 쓰지 않음. 좌석명만 유지한 0 expand 스텁 */
export function aggregateSeatPushesFromDonors(opts: {
  seatPlayers: Array<{ id: string; name: string; donationWon: number }>;
  donors?: Array<Pick<Donor, "memberId" | "amount" | "hsPushDir" | "donationExcluded" | "hsTerritoryExcluded" | "at">>;
  settings?: HighSocietySettings;
}): HighSocietyPlayerInput[] {
  return opts.seatPlayers.map((player) => ({
    id: player.id,
    name: player.name,
    donationWon: 0,
    expandLeftCm: 0,
    expandRightCm: 0,
  }));
}

/**
 * 영토 기록부 — 적힌 cm 를 있는 그대로 옮긴다.
 * +N: 상대(0cm 건너뜀)에게서 N 을 가져와 대상에게 N 을 준다. 0cm 대상도 한 번에 땅이 생긴다.
 * -N: 대상에게서 N 을 빼 상대에게 준다. 전장에서 빌려오거나 ceil 분할하지 않는다.
 */
export function applyTerritoryLogDirectTransfers(
  field: ReturnType<typeof resolveHighSocietyField>,
  seatMemberIds: string[],
  logs: TerritoryLog[],
  settings: HighSocietySettings
): ReturnType<typeof resolveHighSocietyField> {
  const order = seatMemberIds.filter(Boolean);
  const n = order.length;
  if (n === 0 || !logs?.length) return field;

  const widthById = new Map(
    field.seats.map((s) => [s.id, Math.max(0, Math.round(s.widthCm))])
  );
  const seatMeta = new Map(field.seats.map((s) => [s.id, s]));
  const middleDir = resolveSystemMiddlePushDir(settings);
  const teamAssignments: Record<string, string> = settings?.memberTeamAssignments ?? {};
  const matchMode = settings?.matchMode === "team" ? "team" : "individual";

  const widthAt = (idx: number) => Math.max(0, widthById.get(order[idx]!) ?? 0);
  const addAt = (idx: number, delta: number) => {
    const id = order[idx]!;
    widthById.set(id, Math.max(0, (widthById.get(id) ?? 0) + delta));
  };

  const takeFromIndices = (idxs: number[], amount: number): number => {
    let remain = Math.max(0, Math.floor(amount));
    if (remain <= 0) return 0;
    let taken = 0;
    for (const idx of idxs) {
      if (remain <= 0) break;
      if (idx < 0 || idx >= n) continue;
      const cur = widthAt(idx);
      if (cur <= 0) continue;
      const t = Math.min(remain, cur);
      addAt(idx, -t);
      remain -= t;
      taken += t;
    }
    return taken;
  };

  const giveToIndices = (idxs: number[], amount: number) => {
    const total = Math.max(0, Math.floor(amount));
    if (total <= 0 || idxs.length === 0) return;
    const cnt = idxs.length;
    const base = Math.floor(total / cnt);
    const rem = total - base * cnt;
    for (let k = 0; k < cnt; k += 1) {
      addAt(idxs[k]!, base + (k === 0 ? rem : 0));
    }
  };

  const othersOf = (own: number[]): number[] => {
    const set = new Set(own);
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) if (!set.has(i)) out.push(i);
    return out;
  };

  const preferToward = (own: number[], dir: "left" | "right"): number[] => {
    const exclude = new Set(own);
    const start = dir === "right" ? Math.max(...own) + 1 : Math.min(...own) - 1;
    const step: 1 | -1 = dir === "right" ? 1 : -1;
    const prefer: number[] = [];
    for (let i = start; i >= 0 && i < n; i += step) {
      if (!exclude.has(i)) prefer.push(i);
    }
    const rest = othersOf(own).filter((i) => !prefer.includes(i));
    return [...prefer, ...rest];
  };

  const takeToward = (own: number[], dir: "left" | "right", amount: number): number =>
    takeFromIndices(preferToward(own, dir), amount);

  const giveToward = (own: number[], dir: "left" | "right", amount: number) => {
    const targets = preferToward(own, dir);
    if (targets.length === 0) {
      giveToIndices(own, amount);
      return;
    }
    giveToIndices([targets[0]!], amount);
  };

  const orderedLogs = [...logs].sort((a, b) => {
    const at = Number(a.at || 0) - Number(b.at || 0);
    if (at !== 0) return at;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  for (const log of orderedLogs) {
    let rawTeamId =
      typeof (log as unknown as { teamId?: string }).teamId === "string"
        ? String((log as unknown as { teamId?: string }).teamId || "").trim()
        : "";
    if (!rawTeamId) {
      const m = String(log.memberId || "").match(/^__team_(.+)$/);
      if (m) rawTeamId = String(m[1] || "").trim();
    }
    const memberId = String(log.memberId || "").trim();
    const cm = Math.max(0, Math.floor(Number(log.amount) || 0));
    if (cm <= 0) continue;
    const sign = log.delta === -1 ? -1 : 1;

    const targetIdxs: number[] = [];
    if (rawTeamId) {
      for (let i = 0; i < n; i += 1) {
        if (teamAssignments[order[i]!] === rawTeamId) targetIdxs.push(i);
      }
    }
    if (!rawTeamId || targetIdxs.length === 0) {
      const idx = order.indexOf(memberId.startsWith("__team_") ? "" : memberId);
      if (idx >= 0) targetIdxs.push(idx);
    }
    if (matchMode === "team" && (!rawTeamId || targetIdxs.length === 0)) {
      const memTeam =
        memberId && !memberId.startsWith("__team_") ? teamAssignments[memberId] : undefined;
      if (memTeam && typeof memTeam === "string" && memTeam.trim()) {
        rawTeamId = memTeam.trim();
        targetIdxs.length = 0;
        for (let i = 0; i < n; i += 1) {
          if (teamAssignments[order[i]!] === rawTeamId) targetIdxs.push(i);
        }
      }
    }
    if (targetIdxs.length === 0) continue;

    let explicitPush = parseHighSocietyPushDir(log.pushDir);
    if (!explicitPush) {
      if (rawTeamId && targetIdxs.length >= 1) {
        const teamCenter = (Math.min(...targetIdxs) + Math.max(...targetIdxs)) / 2;
        const rawDir = seatExpandDirForIndex(Math.round(teamCenter), n) || middleDir;
        explicitPush = rawDir === "both" ? "split" : rawDir;
      } else {
        const seatDir = seatExpandDirForIndex(targetIdxs[0]!, n);
        explicitPush = seatDir === "both" ? middleDir : seatDir;
      }
    }

    const parts: Array<{ dir: "left" | "right"; cm: number }> =
      explicitPush === "split"
        ? [
            { dir: "left", cm: Math.floor(cm / 2) },
            { dir: "right", cm: cm - Math.floor(cm / 2) },
          ]
        : [{ dir: explicitPush === "left" ? "left" : "right", cm }];

    for (const part of parts) {
      if (part.cm <= 0) continue;
      if (sign > 0) {
        const got = takeToward(targetIdxs, part.dir, part.cm);
        giveToIndices(targetIdxs, got);
      } else {
        const got = takeFromIndices(targetIdxs, part.cm);
        if (got > 0) giveToward(targetIdxs, part.dir, got);
      }
    }
  }

  /** 팀전 — 팀 합은 as-is 이전 결과 유지, 팀원끼리는 균등. OBS 팀 게이지 = 기록부 팀 합. */
  if (matchMode === "team") {
    const byTeam = new Map<string, number[]>();
    for (let i = 0; i < n; i += 1) {
      const tid = String(teamAssignments[order[i]!] || "").trim();
      if (!tid) continue;
      const idxs = byTeam.get(tid);
      if (idxs) idxs.push(i);
      else byTeam.set(tid, [i]);
    }
    for (const idxs of byTeam.values()) {
      if (idxs.length === 0) continue;
      const total = idxs.reduce((s, i) => s + widthAt(i), 0);
      const cnt = idxs.length;
      const base = Math.floor(total / cnt);
      const rem = total - base * cnt;
      for (let k = 0; k < cnt; k += 1) {
        widthById.set(order[idxs[k]!]!, Math.max(0, base + (k === 0 ? rem : 0)));
      }
    }
  }

  const widthsArr = order.map((id) => Math.max(0, widthById.get(id) ?? 0));
  const quantized = quantizeSeatWidthsToFieldCm(widthsArr, field.fieldCm);
  const seats: HighSocietySeat[] = order.map((id, i) => {
    const prev = seatMeta.get(id)!;
    const widthCm = Math.max(0, quantized[i]!);
    return {
      ...prev,
      widthCm,
      pct: Math.round((widthCm / field.fieldCm) * 1000) / 10,
      eliminated: widthCm <= 0,
    };
  });
  const alive = seats.filter((s) => !s.eliminated).sort((a, b) => b.widthCm - a.widthCm);
  return {
    ...field,
    seats,
    leader: alive[0] ?? null,
    cushion: seats.filter((s) => s.eliminated),
  };
}

/** AppState 기준 영토 해상 — 기록부가 있으면 균등 시작 후 replay. 스냅샷 leftover 는 덮지 않음. */
export function buildHighSocietyFieldFromAppState(
  state: Pick<AppState, "members" | "donors" | "highSocietySettings" | "territoryLogs">,
  opts?: { startCmPerMemberOverride?: number }
) {
  const settings = normalizeHighSocietySettings(state.highSocietySettings);
  const seatPlayers = resolveHighSocietySeatMembers(state.members || [], settings);
  const seatIds = seatPlayers.map((p) => p.id);
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
  const equalPlayers: HighSocietyPlayerInput[] = seatPlayers.map((p) => ({
    id: p.id,
    name: p.name,
    donationWon: 0,
    expandLeftCm: 0,
    expandRightCm: 0,
  }));
  const equalField = resolveHighSocietyField({
    players: equalPlayers,
    fieldCm: effectiveFieldCm,
  });
  const resetAt = Number(settingsForField.territoryLogsResetAt || 0);
  const territoryLogs = ((state.territoryLogs || []) as TerritoryLog[]).filter((log) =>
    resetAt > 0 ? Number(log.at || 0) >= resetAt : true
  );
  if (territoryLogs.length > 0) {
    const fieldResolved = applyTerritoryLogDirectTransfers(
      equalField,
      seatIds,
      territoryLogs,
      settingsForField
    );
    return {
      ...fieldResolved,
      settings: { ...settingsForField, fieldCm: effectiveFieldCm },
    };
  }
  const widths = settingsForField.memberWidthCm;
  const snapshotComplete =
    Boolean(widths) && seatIds.length > 0 && seatIds.every((id) => widths![id] != null);
  if (snapshotComplete) {
    return {
      ...resolveHighSocietyFieldWithMemberWidths({
        players: equalPlayers,
        fieldCm: effectiveFieldCm,
        widthByMemberId: widths!,
        expandByMemberId: settingsForField.memberTerritoryExpand,
      }),
      settings: { ...settingsForField, fieldCm: effectiveFieldCm },
    };
  }
  return {
    ...equalField,
    settings: { ...settingsForField, fieldCm: effectiveFieldCm },
  };
}

/** 스냅샷에서 멤버별 width 패치 생성 */
function memberWidthPatchFromFieldSeats(
  seats: Array<{
    id: string;
    widthCm: number;
    expandLeftCm?: number;
    expandRightCm?: number;
  }>
): Pick<
  HighSocietySettings,
  "memberWidthCm" | "memberWidthDonationSnapshot" | "memberTerritoryExpand"
> {
  const memberWidthCm: Record<string, number> = {};
  const memberWidthDonationSnapshot: Record<string, number> = {};
  const memberTerritoryExpand: Record<string, { expandLeftCm: number; expandRightCm: number }> =
    {};
  for (const seat of seats) {
    memberWidthCm[seat.id] = Math.max(0, Math.round(seat.widthCm));
    memberWidthDonationSnapshot[seat.id] = 0;
    memberTerritoryExpand[seat.id] = {
      expandLeftCm: Math.max(0, Number(seat.expandLeftCm) || 0),
      expandRightCm: Math.max(0, Number(seat.expandRightCm) || 0),
    };
  }
  return { memberWidthCm, memberWidthDonationSnapshot, memberTerritoryExpand };
}

/**
 * 영토 기록 1건을 현재 필드에 증분 반영 후 스냅샷·로그에 저장.
 * (전체 로그 재적용 금지 — 좌석 순서 변경과 충돌)
 */
export function appendTerritoryLogToAppState(state: AppState, log: TerritoryLog): AppState {
  const settings = normalizeHighSocietySettings(state.highSocietySettings);
  const seatIds = resolveHighSocietySeatMembers(state.members || [], settings).map((s) => s.id);
  if (seatIds.length === 0) {
    return {
      ...state,
      territoryLogs: [...(state.territoryLogs || []), log],
      updatedAt: Date.now(),
    };
  }
  const fieldBefore = buildHighSocietyFieldFromAppState(state);
  const fieldAfter = applyTerritoryLogDirectTransfers(fieldBefore, seatIds, [log], settings);
  const widthPatch = memberWidthPatchFromFieldSeats(fieldAfter.seats);
  return {
    ...state,
    territoryLogs: [...(state.territoryLogs || []), log],
    highSocietySettings: normalizeHighSocietySettings({
      ...fieldBefore.settings,
      ...widthPatch,
    }),
    updatedAt: Date.now(),
  };
}

/**
 * 영토 기록 삭제 — 스냅을 비운 뒤 남은 로그만으로 콜드 재계산.
 */
export function removeTerritoryLogFromAppState(state: AppState, logId: string): AppState {
  const settings = normalizeHighSocietySettings(state.highSocietySettings);
  const id = String(logId || "").trim();
  const prevDeleted = Array.isArray(state.deletedTerritoryLogIds) ? state.deletedTerritoryLogIds : [];
  const cleared: AppState = {
    ...state,
    territoryLogs: (state.territoryLogs || []).filter((x) => String(x.id) !== id),
    deletedTerritoryLogIds: id
      ? [...new Set([...prevDeleted.map((x) => String(x)), id])].filter(Boolean).slice(-80)
      : prevDeleted,
    highSocietySettings: normalizeHighSocietySettings({
      ...settings,
      memberWidthCm: undefined,
      memberWidthDonationSnapshot: undefined,
      memberTerritoryExpand: undefined,
    }),
    updatedAt: Date.now(),
  };
  return syncHighSocietyMemberWidthSnapshotInState(cleared);
}

/** 실시간 영토 모드에서 memberWidthCm 스냅샷을 서버·OBS와 맞출지 */
export function shouldSyncHighSocietyMemberWidthSnapshot(
  settings: HighSocietySettings | null | undefined
): boolean {
  const s = normalizeHighSocietySettings(settings);
  if (s.territoryPaused) return false;
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

  const memberWidthCm: Record<string, number> = {};
  const memberWidthDonationSnapshot: Record<string, number> = {};
  const memberTerritoryExpand: Record<string, { expandLeftCm: number; expandRightCm: number }> = {};
  for (const seat of field.seats) {
    memberWidthCm[seat.id] = Math.max(0, Math.round(seat.widthCm));
    memberWidthDonationSnapshot[seat.id] = 0;
    memberTerritoryExpand[seat.id] = {
      expandLeftCm: Math.max(0, Number(seat.expandLeftCm) || 0),
      expandRightCm: Math.max(0, Number(seat.expandRightCm) || 0),
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
 * - 자동(빈 배열)이면 actualSeatCount 또는 기본 4, 1명 이상이면 실제 명수 존중
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
    return Math.max(1, Math.min(HIGH_SOCIETY_MAX_SEATS, actual));
  }
  return 4;
}

/** 삭제 멤버 id — seatMemberIds 에 남은 유령 항목 제거 (운영진 멤버도 수동 선택시 보존) */
export function pruneHighSocietySeatMemberIds(
  settings: HighSocietySettings,
  members: Array<Pick<Member, "id" | "operating">>
): HighSocietySettings {
  if (!isHighSocietySeatSelectionManual(settings)) return settings;
  const playable = new Set(
    members.map((m) => String(m.id))
  );
  const pruned = (settings.seatMemberIds || [])
    .map((id) => String(id || "").trim())
    .filter((id) => playable.has(id));
  if (pruned.length === (settings.seatMemberIds || []).length) return settings;
  return { ...settings, seatMemberIds: pruned, seatMemberIdsManual: true };
}

/** 팀 id 로 팀 색상 fallback lookup — HIGH_SOCIETY_SEAT_COLORS circular */
export function resolveTeamColor(team: HighSocietyTeam | null | undefined, fallbackIndex = 0): string {
  if (team?.color) return team.color;
  const palette = Array.from(HIGH_SOCIETY_SEAT_COLORS);
  const hash = (team?.id || String(fallbackIndex))
    .split("")
    .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return palette[Math.abs(hash) % palette.length]!;
}

/** TerritoryLog 를 팀별로 재집계 (TerritoryLog.memberId → memberTeamAssignments 로 조인) */
export function aggregateTeamPushesFromTerritoryLogs(opts: {
  seatPlayers: Array<{ id: string; name: string }>;
  logs: TerritoryLog[];
  settings: HighSocietySettings;
  memberTeamAssignments: Record<string, string>;
  teams: HighSocietyTeam[];
}): Array<{
  id: string;
  teamName: string;
  color: string;
  donationWon: number;
  expandLeftCm: number;
  expandRightCm: number;
  memberIds: string[];
}> {
  const { seatPlayers, logs, memberTeamAssignments, teams } = opts;
  const playerExpandMap = new Map<string, { expandLeftCm: number; expandRightCm: number }>();
  for (const m of seatPlayers) {
    playerExpandMap.set(m.id, { expandLeftCm: 0, expandRightCm: 0 });
  }
  for (const log of logs || []) {
    const cm = Math.max(0, Number(log.amount) || 0);
    const isExpand = Number(log.delta) >= 0;
    if (!isExpand) continue;
    const logTeamId = typeof (log as unknown as { teamId?: string }).teamId === "string"
      ? String((log as unknown as { teamId?: string }).teamId || "").trim()
      : "";
    const pushDir = (log as unknown as { pushDir?: string }).pushDir || "both";

    if (logTeamId) {
      const memberIdsInTeam = seatPlayers
        .filter((m) => memberTeamAssignments[m.id] === logTeamId)
        .map((m) => m.id);
      if (memberIdsInTeam.length === 0) continue;
      const sharePer = Math.max(0, Math.floor(cm / memberIdsInTeam.length));
      const remainder = Math.max(0, cm - sharePer * memberIdsInTeam.length);
      for (let i = 0; i < memberIdsInTeam.length; i += 1) {
        const mid = memberIdsInTeam[i]!;
        const entry = playerExpandMap.get(mid);
        if (!entry) continue;
        const share = sharePer + (i === 0 ? remainder : 0);
        if (share <= 0) continue;
        if (pushDir === "left") {
          entry.expandLeftCm += share;
        } else if (pushDir === "right") {
          entry.expandRightCm += share;
        } else {
          const half = Math.floor(share / 2);
          entry.expandLeftCm += half;
          entry.expandRightCm += share - half;
        }
      }
      continue;
    }

    const entry = playerExpandMap.get(log.memberId);
    if (!entry) continue;
    if (pushDir === "left") {
      entry.expandLeftCm += cm;
    } else if (pushDir === "right") {
      entry.expandRightCm += cm;
    } else {
      const half = Math.floor(cm / 2);
      entry.expandLeftCm += half;
      entry.expandRightCm += cm - half;
    }
  }
  const teamIndexMap = new Map(teams.map((t, i) => [t.id, { team: t, idx: i }]));
  type Acc = { expandLeftCm: number; expandRightCm: number; donationWon: number; memberIds: string[] };
  const accMap = new Map<string, Acc>();
  const teamOrder: string[] = [];
  for (const p of seatPlayers) {
    const tid = String(memberTeamAssignments[p.id] || "").trim();
    if (!tid) continue;
    const entry = teamIndexMap.get(tid);
    if (!entry) continue;
    if (!accMap.has(tid)) {
      accMap.set(tid, { expandLeftCm: 0, expandRightCm: 0, donationWon: 0, memberIds: [] });
      teamOrder.push(tid);
    }
    const acc = accMap.get(tid)!;
    const pe = playerExpandMap.get(p.id);
    acc.expandLeftCm += pe?.expandLeftCm || 0;
    acc.expandRightCm += pe?.expandRightCm || 0;
    acc.memberIds.push(p.id);
  }
  return teamOrder.map((tid) => {
    const { team, idx } = teamIndexMap.get(tid)!;
    const acc = accMap.get(tid)!;
    return {
      id: team.id,
      teamName: team.name,
      color: resolveTeamColor(team, idx),
      donationWon: acc.donationWon,
      expandLeftCm: acc.expandLeftCm,
      expandRightCm: acc.expandRightCm,
      memberIds: acc.memberIds,
    };
  });
}

/**
 * 팀전 오버레이 — 멤버 좌석 width 를 팀 단위로 합산한 뒤 전장 cm 에 맞게 양자화.
 * 멤버별 floor 잔여(501/99)가 팀 합에 남지 않게 한다.
 */
export function aggregateHighSocietySeatsByTeam(
  seats: HighSocietySeat[],
  settings: Pick<HighSocietySettings, "matchMode" | "teams" | "memberTeamAssignments">
): HighSocietySeat[] {
  if (settings.matchMode !== "team") return seats;
  const teams = settings.teams || [];
  if (teams.length === 0) return seats;
  const assignments = settings.memberTeamAssignments || {};
  const unassignedTeamId = "__hs_unassigned__";
  const teamMap = new Map<
    string,
    {
      team: HighSocietyTeam | null;
      idx: number;
      seats: HighSocietySeat[];
    }
  >();
  teams.forEach((t, i) => {
    teamMap.set(t.id, { team: t, idx: i, seats: [] });
  });
  let unassignedIdx = teams.length;
  for (const s of seats) {
    const tid = assignments[s.id] || unassignedTeamId;
    let bucket = teamMap.get(tid);
    if (!bucket) {
      bucket = { team: null, idx: unassignedIdx++, seats: [] };
      teamMap.set(tid, bucket);
    }
    bucket.seats.push(s);
  }
  const result: HighSocietySeat[] = [];
  let letterCode = "A".charCodeAt(0);
  let seatIdx = 0;
  const sortedBuckets = Array.from(teamMap.entries()).sort((a, b) => a[1].idx - b[1].idx);
  const totalFieldCm = Math.max(
    1,
    seats.reduce((n, s) => n + Math.max(0, s.widthCm), 0)
  );
  const teamBuckets = sortedBuckets.filter(
    ([tid, bucket]) => bucket.seats.length > 0 && tid !== unassignedTeamId && bucket.team != null
  );
  const rawTeamWidths = teamBuckets.map(([, bucket]) =>
    bucket.seats.reduce((n, s) => n + Math.max(0, s.widthCm), 0)
  );
  const quantizedTeamWidths = quantizeSeatWidthsToFieldCm(rawTeamWidths, totalFieldCm);
  let teamWidthCursor = 0;
  for (const [tid, bucket] of sortedBuckets) {
    if (bucket.seats.length === 0) continue;
    const isUnassigned = tid === unassignedTeamId || bucket.team == null;
    if (isUnassigned) {
      for (const s of bucket.seats) {
        result.push({ ...s, seatIndex: seatIdx++ });
      }
      continue;
    }
    const team = bucket.team!;
    const totalWidth = Math.max(0, quantizedTeamWidths[teamWidthCursor] ?? 0);
    teamWidthCursor += 1;
    const totalExpandL = bucket.seats.reduce((n, s) => n + Math.max(0, s.expandLeftCm || 0), 0);
    const totalExpandR = bucket.seats.reduce((n, s) => n + Math.max(0, s.expandRightCm || 0), 0);
    const totalExpand = bucket.seats.reduce((n, s) => n + Math.max(0, s.expandCm || 0), 0);
    const totalDonation = bucket.seats.reduce((n, s) => n + (Number(s.donationWon) || 0), 0);
    const allElim = totalWidth <= 0;
    const expandDir: "left" | "right" | "both" =
      totalExpandL > 0 && totalExpandR === 0
        ? "left"
        : totalExpandR > 0 && totalExpandL === 0
          ? "right"
          : "both";
    const color = resolveTeamColor(team, bucket.idx);
    const letter = String.fromCharCode(letterCode);
    letterCode += 1;
    const pct = Math.max(0, Math.min(100, (totalWidth / totalFieldCm) * 100));
    result.push({
      id: `team:${team.id}`,
      name: team.name,
      letter,
      color,
      widthCm: totalWidth,
      expandCm: totalExpand,
      expandLeftCm: totalExpandL,
      expandRightCm: totalExpandR,
      expandDir,
      eliminated: allElim,
      seatIndex: seatIdx++,
      donationWon: totalDonation,
      pct,
    });
  }
  return result.length > 0 ? result : seats;
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
    return `상류사회 · 영토만 초기화 (${after.round || 1}라운드 · 영토 기록부·스냅샷 초기화 · 합산·금액 유지)`;
  }
  if (typeof patch.enabled === "boolean" && patch.enabled !== wasOn) {
    return patch.enabled
      ? isHighSocietyReopen(before)
        ? "상류사회 재ON — 기존 영토 유지, cm 조절은 영토 기록부에서만"
        : "상류사회 ON — 영토는 영토 기록부에서만 수동 반영(후원 리스트와 무관)"
      : "상류사회 OFF";
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
