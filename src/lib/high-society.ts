import type { Member } from "@/types";

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

export type HighSocietySeatLetter = "A" | "B" | "C" | "D";

/** 룰 기반 좌석(장벽 안 A→D 고정 순서) */
export type HighSocietySeat = {
  letter: HighSocietySeatLetter;
  id: string;
  name: string;
  /** 라운드 후원(원) — 1만원 미만 버림 전 원본 */
  donationWon: number;
  /** floor(후원/1만)×5cm */
  expandCm: number;
  /** 현재 가로 영토(cm) */
  widthCm: number;
  pct: number;
  color: string;
  /** 영토 0 → 방석 */
  eliminated: boolean;
  expandDir: "right" | "both" | "left";
};

export type HighSocietyPushSplit = {
  /** B가 왼쪽으로 쓸 비율 0..1 (나머지는 오른쪽) */
  bLeft: number;
  /** C가 왼쪽으로 쓸 비율 0..1 */
  cLeft: number;
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
/** 기본 전장 가로 — 4인 균등 시작 300cm */
export const HIGH_SOCIETY_DEFAULT_FIELD_CM = 1200;

export const HIGH_SOCIETY_SEAT_COLORS = ["#2563eb", "#16a34a", "#ca8a04", "#dc2626"] as const;
export const HIGH_SOCIETY_SEAT_LETTERS: HighSocietySeatLetter[] = ["A", "B", "C", "D"];

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

/**
 * 인접 경계 순이동 적용.
 * net > 0 → 왼쪽 좌석이 오른쪽에서 뺏음 / net < 0 → 오른쪽이 왼쪽에서 뺏음.
 * 뺏을 양이 없으면(상대 0) 남는 푸시는 소멸(벽/방석).
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

/**
 * 룰 기반 영토 해상.
 * - 시작: 균등 분할 (세로 고정, 가로만 변동)
 * - A는 오른쪽만 / D는 왼쪽만 / B·C는 split 비율로 좌·우 분배
 * - 확장량만큼 해당 방향 인접 영토 축소
 */
export function resolveHighSocietyField(opts: {
  players: Array<{ id: string; name: string; donationWon: number }>;
  fieldCm?: number;
  split?: Partial<HighSocietyPushSplit>;
}): {
  seats: HighSocietySeat[];
  fieldCm: number;
  startCm: number;
  leader: HighSocietySeat | null;
  cushion: HighSocietySeat[];
} {
  const fieldCm = Math.max(4, opts.fieldCm ?? HIGH_SOCIETY_DEFAULT_FIELD_CM);
  const startCm = fieldCm / 4;
  const bLeft = clamp01(opts.split?.bLeft ?? 0.5);
  const cLeft = clamp01(opts.split?.cLeft ?? 0.5);

  const filled = HIGH_SOCIETY_SEAT_LETTERS.map((letter, i) => {
    const p = opts.players[i];
    const donationWon = Math.max(0, Number(p?.donationWon || 0));
    return {
      letter,
      id: p?.id ? String(p.id) : `seat-${letter}`,
      name: p?.name?.trim() || `플레이어 ${letter}`,
      donationWon,
      expandCm: donationToExpandCm(donationWon),
      expandDir: (letter === "A" ? "right" : letter === "D" ? "left" : "both") as
        | "right"
        | "both"
        | "left",
      color: HIGH_SOCIETY_SEAT_COLORS[i]!,
    };
  });

  const aR = filled[0]!.expandCm;
  const bL = filled[1]!.expandCm * bLeft;
  const bR = filled[1]!.expandCm * (1 - bLeft);
  const cL = filled[2]!.expandCm * cLeft;
  const cR = filled[2]!.expandCm * (1 - cLeft);
  const dL = filled[3]!.expandCm;

  // 경계 순압력: +면 왼쪽 확장
  const netAB = aR - bL;
  const netBC = bR - cL;
  const netCD = cR - dL;

  const widths = [startCm, startCm, startCm, startCm];
  // 바깥쪽(벽 쪽) 경계부터 적용 → 중앙이 남은 여유를 흡수
  applyBoundaryNet(widths, 0, 1, netAB);
  applyBoundaryNet(widths, 2, 3, netCD);
  applyBoundaryNet(widths, 1, 2, netBC);

  // 부동소수 보정: 합 = fieldCm
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
    leader: alive[0] ?? null,
    cushion: seats.filter((s) => s.eliminated),
  };
}

/** 멤버 배열 앞 4명(운영비 제외)을 A→D 좌석에 매핑 */
export function buildHighSocietyFieldFromMembers(
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>,
  opts?: { fieldCm?: number; split?: Partial<HighSocietyPushSplit> }
) {
  const playable = members
    .filter((m) => !m.operating)
    .slice(0, 4)
    .map((m) => ({
      id: String(m.id),
      name: String(m.name || "").trim() || "멤버",
      donationWon: memberTotal(m),
    }));
  return resolveHighSocietyField({
    players: playable,
    fieldCm: opts?.fieldCm,
    split: opts?.split,
  });
}

/** 운영비 제외 멤버의 계좌+투네 합으로 영토 점유율 계산 (보조 게이지용) */
export function buildHighSocietyTerritory(
  members: Array<Pick<Member, "id" | "name" | "account" | "toon" | "operating">>
): { slices: HighSocietyTerritorySlice[]; total: number; leader: HighSocietyTerritorySlice | null } {
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

export type HighSocietyBarStyle = "field" | "share" | "lanes" | "chevron" | "race";

export const HIGH_SOCIETY_BAR_STYLES: Array<{
  id: HighSocietyBarStyle;
  label: string;
  desc: string;
}> = [
  {
    id: "field",
    label: "전장(룰)",
    desc: "장벽 · A→D 연속 영토 · 1만=5cm",
  },
  { id: "share", label: "점유 스트립", desc: "후원 비율로 한 줄 분할" },
  { id: "lanes", label: "레인(경사)", desc: "멤버별 가로 게이지 · 사선" },
  { id: "chevron", label: "쉐브론", desc: "기울어진 점유 스트립" },
  { id: "race", label: "레이스", desc: "1위=풀바 기준 상대 진행도" },
];

export function parseHighSocietyBarStyle(raw: string | null | undefined): HighSocietyBarStyle {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "lanes" || v === "lane" || v === "stacked") return "lanes";
  if (v === "chevron" || v === "skew") return "chevron";
  if (v === "race" || v === "relative") return "race";
  if (v === "share" || v === "pct" || v === "ratio") return "share";
  return "field";
}

export function parseHighSocietySplit(
  bLeftRaw: string | null | undefined,
  cLeftRaw: string | null | undefined
): HighSocietyPushSplit {
  const parse = (raw: string | null | undefined, fallback: number) => {
    if (raw == null || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    // 0~100 → 비율, 0~1 → 그대로
    return clamp01(n > 1 ? n / 100 : n);
  };
  return { bLeft: parse(bLeftRaw, 0.5), cLeft: parse(cLeftRaw, 0.5) };
}

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
