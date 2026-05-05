/** 통합 오버레이 프리셋 목표 자동 상향·후원 초기화용 */

export const GOAL_STRETCH_FACTOR = 1.1;

/** 현재 목표 금액의 약 10% 상향(원 단위, 최소 +1원) — useGoalPresetAutoEscalate와 동일 */
export function nextGoalTenPercentIncrease(goal: number): number {
  const g = Math.max(1, Math.floor(Number(goal) || 0));
  return Math.max(g + 1, Math.ceil(g * GOAL_STRETCH_FACTOR));
}

/**
 * 후원·멤버 초기화 시 오버레이 프리셋의 목표 금액을 되돌린다.
 * `goalBaseline`만 사용한다(자동 상향 직전 스냅샷·관리자가 목표 수정 시 동일 저장).
 * 기준선이 없으면 목표를 건드리지 않는다 — 역함수 체인은 단조가 아니어서 잘못된 값으로 멈출 수 있음.
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
