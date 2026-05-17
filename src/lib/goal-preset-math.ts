/** 통합 오버레이 프리셋 목표 자동 상향·후원 초기화용 */

/** 기본 후원 목표·초기화 기준선(원) */
export const DEFAULT_DONATION_GOAL = 2_000_000;

/** 예전 3천만 원 목표 — 로드 시 {@link DEFAULT_DONATION_GOAL} 로 맞춤 */
const LEGACY_DONATION_GOAL_30M = 30_000_000;

/** 100% 달성 시 목표에 더하는 고정 금액(원) — 기본 목표와 동일(200만 원씩 상향) */
export const GOAL_AUTO_INCREASE_STEP = 2_000_000;

function presetShowsDonationGoal(p: Record<string, unknown>): boolean {
  return p.showGoal === true || p.showGoal === "true" || p.showGoal === 1 || p.showGoal === "1";
}

function parseGoalAmount(raw: unknown): number | null {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function normalizeGoalAmount(raw: unknown): number {
  const n = parseGoalAmount(raw);
  if (n == null || n <= 0) return DEFAULT_DONATION_GOAL;
  if (n === LEGACY_DONATION_GOAL_30M) return DEFAULT_DONATION_GOAL;
  return n;
}

/**
 * 목표바 ON 프리셋: 기준선(goalBaseline)은 200만 원, 현재 goal 은 상향 이력 유지(4M·6M…).
 * 비어 있거나 3천만 원이면 200만 원으로 맞춤.
 */
export function normalizeOverlayPresetDonationGoals(presets: unknown[]): unknown[] {
  if (!Array.isArray(presets)) return [];
  const baselineStr = String(DEFAULT_DONATION_GOAL);
  return presets.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const p = raw as Record<string, unknown>;
    if (!presetShowsDonationGoal(p)) return { ...p };
    let goal = normalizeGoalAmount(p.goal);
    if (goal < DEFAULT_DONATION_GOAL) goal = DEFAULT_DONATION_GOAL;
    return { ...p, goal: String(goal), goalBaseline: baselineStr };
  });
}

/** 후원 합계 ≥ 목표 시 +200만 원 자동 상향 */
export function isDonationGoalAutoEscalateEnabled(): boolean {
  return true;
}

/**
 * 현재 목표 금액에 고정 200만 원을 더한 다음 목표(원).
 * (함수명 `nextGoalTenPercentIncrease`는 호환용)
 */
export function nextGoalTenPercentIncrease(goal: number): number {
  const g = Math.max(1, Math.floor(Number(goal) || 0));
  return g + GOAL_AUTO_INCREASE_STEP;
}

/**
 * 후원 합계가 목표를 넘길 때마다 200만 원씩 올린 최종 목표.
 * 한 번에 여러 단계(예: 2M→6M)를 밀어넣어야 할 때도 연속 반영.
 */
export function computeEscalatedDonationGoal(
  currentGoal: number,
  liveTotal: number,
  baseline: number = DEFAULT_DONATION_GOAL,
  step: number = GOAL_AUTO_INCREASE_STEP
): number {
  let g = Math.max(baseline, Math.floor(Number(currentGoal) || 0));
  if (g < baseline) g = baseline;
  const total = Math.max(0, Math.floor(Number(liveTotal) || 0));
  let guard = 0;
  while (total >= g && guard < 64) {
    g += step;
    guard += 1;
  }
  return g;
}

/**
 * 자동 상향이 항상 고정 200만 원이므로, 역으로는 동일 스텝을 최대 `maxSteps`번 뺀 값.
 * (수동으로 목표를 바꾼 뒤에는 실제 이력과 다를 수 있음)
 */
export function unwindGoalForDonationReset(currentGoal: number, maxSteps = 8): number {
  let cur = Math.max(0, Math.floor(Number(currentGoal) || 0));
  if (cur <= 1) return cur;
  for (let i = 0; i < maxSteps; i++) {
    const pred = cur - GOAL_AUTO_INCREASE_STEP;
    if (pred < 1) break;
    cur = pred;
  }
  return Math.max(0, cur);
}

/**
 * 후원·멤버 초기화 시 오버레이 프리셋의 목표 금액을 되돌린다.
 * `goalBaseline`이 있으면 그 값으로 복구한다. 없으면 현재 `goal` 숫자는 그대로 둔다.
 */
export function resetOverlayPresetsGoalForDonationInit(presets: unknown[] | undefined): unknown[] {
  if (!Array.isArray(presets)) return [];
  return presets.map((raw) => {
    const p = raw as Record<string, unknown>;
    const baselineRaw = p.goalBaseline;
    const hasBaseline = baselineRaw != null && String(baselineRaw).trim() !== "";
    if (!hasBaseline) return { ...p };
    return { ...p, goal: String(baselineRaw) };
  });
}
