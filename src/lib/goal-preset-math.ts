/** 통합 오버레이 프리셋 목표 자동 상향·후원 초기화용 */

/** 기본·강제 후원 목표 금액(원) */
export const DEFAULT_DONATION_GOAL = 2_000_000;

/** true: 목표바 프리셋 goal·goalBaseline 을 항상 {@link DEFAULT_DONATION_GOAL} 로 고정, 자동 상향 비활성 */
export const DONATION_GOAL_FORCE_LOCK = true;

/** 100% 달성 시 목표에 더하는 고정 금액(원) — 1천만 원 미만·이상 공통 */
export const GOAL_AUTO_INCREASE_STEP = 2_000_000;

function presetShowsDonationGoal(p: Record<string, unknown>): boolean {
  return p.showGoal === true || p.showGoal === "true" || p.showGoal === 1 || p.showGoal === "1";
}

/** 오버레이 프리셋 목표 금액 — {@link DONATION_GOAL_FORCE_LOCK} 시 목표바 ON 프리셋을 200만 원으로 강제 */
export function normalizeOverlayPresetDonationGoals(presets: unknown[]): unknown[] {
  if (!Array.isArray(presets)) return [];
  const forced = String(DEFAULT_DONATION_GOAL);
  return presets.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const p = raw as Record<string, unknown>;
    if (!DONATION_GOAL_FORCE_LOCK) return { ...p };
    if (!presetShowsDonationGoal(p)) return { ...p };
    return { ...p, goal: forced, goalBaseline: forced };
  });
}

export function isDonationGoalAutoEscalateEnabled(): boolean {
  return !DONATION_GOAL_FORCE_LOCK;
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
