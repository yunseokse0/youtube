import type {
  AppState,
  Donor,
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

/** 룰: 1만원 = 5cm */
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

/** 룰4: 1만원 단위만 인정 (16900 → 10000) 후 ×5cm */
export function donationToExpandCm(won: number): number {
  const units = Math.floor(Math.max(0, won) / HIGH_SOCIETY_WON_PER_UNIT);
  return units * HIGH_SOCIETY_CM_PER_UNIT;
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

export function defaultHighSocietySettings(): HighSocietySettings {
  return {
    enabled: false,
    seatMemberIds: [],
    /** 시스템 기본: 가운데도 한쪽(오른쪽)만 */
    defaultMiddlePush: "right",
    defaultBPush: "right",
    defaultCPush: "right",
    barStyle: "flat",
    round: 1,
    fieldCm: HIGH_SOCIETY_DEFAULT_FIELD_CM,
  };
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
  const fieldCm = Math.max(4, Math.floor(Number(v.fieldCm) || HIGH_SOCIETY_DEFAULT_FIELD_CM));
  return {
    enabled: Boolean(v.enabled),
    seatMemberIds,
    defaultMiddlePush: middle,
    defaultBPush: middle,
    defaultCPush: middle,
    barStyle: bar,
    round,
    fieldCm,
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
  if (ids.length >= 2) {
    const picked = ids
      .map((sid) => {
        const m = byId.get(sid);
        if (!m || m.operating) return null;
        return { id: m.id, name: m.name, donationWon: m.donationWon };
      })
      .filter((x): x is { id: string; name: string; donationWon: number } => Boolean(x))
      .slice(0, HIGH_SOCIETY_MAX_SEATS);
    if (picked.length >= 2) return picked;
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
  donors: Array<Pick<Donor, "memberId" | "amount" | "hsPushDir" | "donationExcluded">>;
  settings: HighSocietySettings;
}): HighSocietyPlayerInput[] {
  const { seatPlayers, donors, settings } = opts;
  const n = seatPlayers.length;
  const middleDir = resolveSystemMiddlePushDir(settings);

  return seatPlayers.map((player, i) => {
    const dir = seatExpandDirForIndex(i, n);
    const rows = (donors || []).filter(
      (d) =>
        String(d.memberId || "") === player.id &&
        d.donationExcluded !== true &&
        Math.max(0, Number(d.amount) || 0) > 0
    );

    if (rows.length === 0) {
      const cm = donationToExpandCm(player.donationWon);
      if (dir === "right") return { ...player, expandLeftCm: 0, expandRightCm: cm };
      if (dir === "left") return { ...player, expandLeftCm: cm, expandRightCm: 0 };
      const lr = pushDirToLeftRight(cm, middleDir);
      return { ...player, expandLeftCm: lr.left, expandRightCm: lr.right };
    }

    let left = 0;
    let right = 0;
    let won = 0;
    for (const d of rows) {
      const amount = Math.max(0, Math.round(Number(d.amount) || 0));
      won += amount;
      const cm = donationToExpandCm(amount);
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
      donationWon: won || player.donationWon,
      expandLeftCm: left,
      expandRightCm: right,
    };
  });
}

/** AppState 기준 영토 해상 (좌석·후원 방향 반영) */
export function buildHighSocietyFieldFromAppState(
  state: Pick<AppState, "members" | "donors" | "highSocietySettings">
) {
  const settings = normalizeHighSocietySettings(state.highSocietySettings);
  const seatPlayers = resolveHighSocietySeatMembers(state.members || [], settings.seatMemberIds);
  const players = aggregateSeatPushesFromDonors({
    seatPlayers,
    donors: state.donors || [],
    settings,
  });
  return {
    ...resolveHighSocietyField({ players, fieldCm: settings.fieldCm }),
    settings,
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
