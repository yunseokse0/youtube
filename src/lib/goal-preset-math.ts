/** 통합 오버레이 프리셋 목표 자동 상향·후원 초기화용 */

/** 기본 후원 목표 금액(원) */
export const DEFAULT_DONATION_GOAL = 2_000_000;

/** 예전에 쓰이던 3천만 원 목표 — 로드 시 {@link DEFAULT_DONATION_GOAL} 로 맞춤 */
const LEGACY_DONATION_GOAL_30M = 30_000_000;

/** 100% 달성 시 목표에 더하는 고정 금액(원) — 1천만 원 미만·이상 공통 */
export const GOAL_AUTO_INCREASE_STEP = 2_000_000;

/** 프리셋 goal·goalBaseline 문자열 정규화(3천만 → 200만) */
export function normalizeDonationGoalField(raw: unknown): string | undefined {
  const v = String(raw ?? "").trim().replace(/,/g, "");
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n === LEGACY_DONATION_GOAL_30M) return String(DEFAULT_DONATION_GOAL);
  return v;
}

/** 오버레이 프리셋 배열의 목표 금액 필드 정규화 */
export function normalizeOverlayPresetDonationGoals(presets: unknown[]): unknown[] {
  if (!Array.isArray(presets)) return [];
  return presets.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const p = raw as Record<string, unknown>;
    const next = { ...p };
    const goal = normalizeDonationGoalField(p.goal);
    if (goal !== undefined) next.goal = goal;
    const baseline = normalizeDonationGoalField(p.goalBaseline);
    if (baseline !== undefined) next.goalBaseline = baseline;
    return next;
  });
}

/**
 * 현재 목표 금액에 고정 200만 원을 더한 다음 목표(원, 내림).
 * `useGoalPresetAutoEscalate`와 동일. (함수명 `nextGoalTenPercentIncrease`는 호환용)
 */
export function nextGoalTenPercentIncrease(goal: number): number {
  const g = Math.max(1, Math.floor(Number(goal) || 0));
  return g + GOAL_AUTO_INCREASE_STEP;
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
