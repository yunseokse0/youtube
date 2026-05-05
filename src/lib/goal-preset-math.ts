/** 통합 오버레이 프리셋 목표 자동 상향·후원 초기화용 */

export const GOAL_STRETCH_FACTOR = 1.1;

/** 현재 목표 금액의 약 10% 상향(원 단위, 최소 +1원) — useGoalPresetAutoEscalate와 동일 */
export function nextGoalTenPercentIncrease(goal: number): number {
  const g = Math.max(1, Math.floor(Number(goal) || 0));
  return Math.max(g + 1, Math.ceil(g * GOAL_STRETCH_FACTOR));
}

/**
 * nextGoalTenPercentIncrease(g) === target 인 g (단조 증가 전제 시 유일).
 */
export function findLargestPredecessorForTarget(target: number): number | null {
  const T = Math.floor(Number(target) || 0);
  if (T <= 1) return null;
  let lo = 1;
  let hi = T - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const fm = nextGoalTenPercentIncrease(mid);
    if (fm < T) lo = mid + 1;
    else if (fm > T) hi = mid - 1;
    else return mid;
  }
  return null;
}

/**
 * 자동 상향만 거친 목표를 역으로 여러 단계 되돌린다(기준선 없을 때 폴백).
 * 수학적 역함수 체인은 사용자가 수동으로 목표를 바꾼 뒤에는 정확하지 않을 수 있어 상한만 둔다.
 */
/** 자동 상향만 역추정할 때 최대 단계(과도하게 과거로 당기지 않도록 상한) */
export function unwindGoalForDonationReset(currentGoal: number, maxSteps = 8): number {
  let cur = Math.max(0, Math.floor(Number(currentGoal) || 0));
  if (cur <= 1) return cur;
  for (let i = 0; i < maxSteps; i++) {
    const pred = findLargestPredecessorForTarget(cur);
    if (pred === null || pred >= cur) break;
    cur = pred;
  }
  return Math.max(0, cur);
}

/**
 * 후원·멤버 초기화 시 오버레이 프리셋의 목표 금액을 되돌린다.
 * `goalBaseline`만 신뢰한다(자동 상향 직전 스냅샷·관리자에서 목표 수정 시 동일 저장).
 * 없으면 목표 숫자는 유지 — 역추적은 세션 시작 목표를 알 수 없어 오차가 큼.
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
