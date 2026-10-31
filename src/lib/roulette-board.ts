/**
 * Toontation 방식 일반 룰렛 — youtube 프로젝트 구현
 *
 * 정적 아이템(항목)과 동적 슬롯(수동/후원)을 혼합한 룰렛 판.
 * 섹터 맵(부채꼴 각도)과 가중치 기반 무작위 당첨, 후원 연동 자동 칸 추가를 지원.
 */

/** 룰렛 아이템(정적 항목) */
export type RouletteItem = {
  id: string;
  label: string;
  weight: number; // 5단위, 5~10000
  color: string;
  sortOrder: number;
  drawWeight?: number | null; // 지정 시 확률만 사용, null이면 sizeWeight 비율로 폴백
};

/** 동적 슬롯(수동 또는 후원 유래) */
export type RouletteDynamicSlot = {
  id: string;
  rouletteId: string;
  label: string;
  count: number; // 1~10000
  color: string;
  source: "manual" | "donation";
  donationId?: string | null;
  createdAt: number;
  drawWeight?: number | null;
};

/** 룰렛 설정 */
export type RouletteConfig = {
  streamerId: string;
  enabled: boolean;
  minAmount: number; // 룰렛 자동 칸 추가 최소 후원 금액
  cutoffTimestamp: number | null; // 이 시각 이전 후원은 룰렛에서 제외
  thresholdAmount: number | null; // 이 금액 이상 후원 시 자동 칸 추가
  addSlotsPerThreshold: number; // thresholdAmount 당 추가 칸 수
  currentRotationDeg: number;
  updatedAt: number;
};

/** 섹터(부채꼴) */
export type RouletteSector = {
  winnerType: "static" | "dynamic";
  winnerId: string;
  winnerLabel: string;
  color: string;
  sizeWeight: number;
  sectorStartDeg: number;
  sectorEndDeg: number;
  sectorMidDeg: number;
  ref?: RouletteItem | RouletteDynamicSlot;
};

/** 추첨 결과 */
export type RouletteDrawResult = {
  winnerType: string;
  winnerId: string;
  winnerLabel: string;
  color: string;
  sectorStartDeg: number;
  sectorEndDeg: number;
  sectorMidDeg: number;
  turns: number;
  spinTargetDeg: number;
  durationMs: number;
};

/** 팔레트 */
export const ROULETTE_PALETTE: string[] = [
  "#ef4444", "#f97316", "#f59e0b", "#84cc16", "#22c55e", "#10b981",
  "#06b6d4", "#0ea5e9", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899",
];

const DEFAULT_CONFIG: Partial<RouletteConfig> = {
  enabled: true,
  minAmount: 0,
  cutoffTimestamp: null,
  thresholdAmount: null,
  addSlotsPerThreshold: 1,
  currentRotationDeg: 0,
};

/** 정적 아이템 사이즈 가중치 (weight / 5, 최소 1) */
export function sizeWeightForStatic(item: RouletteItem): number {
  return Math.max(1, Math.round(Number(item.weight || 10) / 5));
}

/** 동적 슬롯 사이즈 가중치 (count, 최소 1) */
export function sizeWeightForDynamic(slot: RouletteDynamicSlot): number {
  return Math.max(1, parseInt(String(slot.count || 1), 10) || 1);
}

/** 섹터별 효과적 추첨 가중치 */
export function effectiveDrawWeight(sector: RouletteSector): number {
  const ref = sector.ref;
  const rawDW = ref && typeof (ref as any).drawWeight === "number" ? (ref as any).drawWeight : null;
  if (rawDW != null) return Math.max(0, Number(rawDW));
  if (sector.winnerType === "static") {
    return ref && typeof (ref as RouletteItem).weight === "number"
      ? Math.max(1, Math.round(Number((ref as RouletteItem).weight) / 5))
      : sector.sizeWeight;
  }
  return Math.max(0, Number(sector.sizeWeight) || 0);
}

/** 섹터 맵 구성 (부채꼴 각도) */
export function buildRouletteSectorMap(
  staticItems: RouletteItem[],
  dynamicSlots: RouletteDynamicSlot[]
): RouletteSector[] {
  const sizeEntries: Array<{
    type: "static" | "dynamic";
    id: string;
    label: string;
    color: string;
    sizeWeight: number;
    ref: RouletteItem | RouletteDynamicSlot;
  }> = [];

  for (const it of staticItems || []) {
    sizeEntries.push({
      type: "static",
      id: it.id,
      label: it.label,
      color: it.color,
      sizeWeight: sizeWeightForStatic(it),
      ref: it,
    });
  }
  for (const ds of dynamicSlots || []) {
    sizeEntries.push({
      type: "dynamic",
      id: ds.id,
      label: ds.label,
      color: ds.color,
      sizeWeight: sizeWeightForDynamic(ds),
      ref: ds,
    });
  }

  const totalSizeWeight = sizeEntries.reduce((s, e) => s + e.sizeWeight, 0) || 1;
  const degPerUnit = 360 / totalSizeWeight;
  const sectors: RouletteSector[] = [];
  let acc = 0;

  for (const e of sizeEntries) {
    const start = acc;
    const span = e.sizeWeight * degPerUnit;
    const end = start + span;
    const mid = start + span / 2;
    sectors.push({
      winnerType: e.type,
      winnerId: e.id,
      winnerLabel: e.label,
      color: e.color,
      sizeWeight: e.sizeWeight,
      sectorStartDeg: start,
      sectorEndDeg: end,
      sectorMidDeg: mid,
      ref: e.ref,
    });
    acc = end;
  }
  return sectors;
}

/** 가중치 기반 무작위 당첨 추첨 */
export function weightedRouletteDraw(
  staticItems: RouletteItem[],
  dynamicSlots: RouletteDynamicSlot[]
): RouletteSector | null {
  const sectors = buildRouletteSectorMap(staticItems, dynamicSlots);
  if (sectors.length === 0) return null;

  const weighted = [];
  let totalDraw = 0;
  for (const s of sectors) {
    const eff = effectiveDrawWeight(s);
    weighted.push({ sector: s, eff });
    totalDraw += eff;
  }

  const pack = (s: RouletteSector) => ({
    winnerType: s.winnerType,
    winnerId: s.winnerId,
    winnerLabel: s.winnerLabel,
    color: s.color,
    sizeWeight: s.sizeWeight,
    sectorStartDeg: s.sectorStartDeg,
    sectorEndDeg: s.sectorEndDeg,
    sectorMidDeg: s.sectorMidDeg,
  });

  if (totalDraw <= 0) {
    return pack(sectors[Math.floor(Math.random() * sectors.length)]);
  }

  let r = Math.random() * totalDraw;
  for (const w of weighted) {
    if (r < w.eff) return pack(w.sector);
    r -= w.eff;
  }
  return pack(sectors[sectors.length - 1]);
}

/** 스핀 결과 생성 (turns, spinTargetDeg, durationMs 포함) */
export function buildSpinResult(
  winner: RouletteSector,
  durationMs: number = 3500
): RouletteDrawResult {
  const turns = 6 + Math.floor(Math.random() * 3);
  const spinTargetDeg = turns * 360 + (360 - winner.sectorMidDeg);
  return {
    winnerType: winner.winnerType,
    winnerId: winner.winnerId,
    winnerLabel: winner.winnerLabel,
    color: winner.color,
    sectorStartDeg: winner.sectorStartDeg,
    sectorEndDeg: winner.sectorEndDeg,
    sectorMidDeg: winner.sectorMidDeg,
    turns,
    spinTargetDeg,
    durationMs,
  };
}

/** 후원 금액에 따른 자동 칸 추가 개수 계산 */
export function calcAutoAddSlots(
  donationAmount: number,
  config: Pick<
    RouletteConfig,
    "enabled" | "thresholdAmount" | "addSlotsPerThreshold" | "minAmount" | "cutoffTimestamp"
  >
): { addCount: number; skipped: boolean; reason?: string } {
  if (!config.enabled) {
    return { addCount: 0, skipped: true, reason: "disabled" };
  }
  if (donationAmount < (config.minAmount ?? 0)) {
    return { addCount: 0, skipped: true, reason: "below_min_amount" };
  }
  if (config.cutoffTimestamp != null) {
    // cutoffTimestamp는 호출 측에서 donation.createdAt 과 비교해 전달된다고 가정
    // 여기서는 amount 기반만 처리
  }
  const thr = config.thresholdAmount;
  if (!thr || thr <= 0) {
    return { addCount: 0, skipped: true, reason: "no_threshold" };
  }
  if (donationAmount < thr) {
    return { addCount: 0, skipped: true, reason: "below_threshold" };
  }
  const times = Math.floor(donationAmount / thr);
  const addCount = Math.max(0, times) * Math.max(1, config.addSlotsPerThreshold ?? 1);
  return { addCount, skipped: false };
}

/** 색상 검증 */
export function isValidRouletteColor(color: string): boolean {
  const palette = new Set(ROULETTE_PALETTE.map((c) => c.toLowerCase()));
  if (palette.has(color.toLowerCase())) return true;
  return /^#([0-9a-fA-F]{3}){1,2}$/.test(color);
}

/** 기본 설정 병합 */
export function mergeRouletteConfig(
  partial: Partial<RouletteConfig>
): RouletteConfig {
  return { ...DEFAULT_CONFIG, ...partial } as RouletteConfig;
}

/** 후원 이벤트 → 동적 슬롯 추가 후보 라벨 생성 */
export function buildDonationSlotLabel(
  nickname: string,
  amount: number
): string {
  const label = String(nickname || "익명")
    .trim()
    .replace(/님$/, "")
    .slice(0, 40) || "익명";
  return label;
}
