import type { AppState } from "@/types";

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

function normalizeGoalAmount(raw: unknown, fallback = DEFAULT_DONATION_GOAL): number {
  const n = parseGoalAmount(raw);
  if (n == null || n <= 0) return fallback;
  if (n === LEGACY_DONATION_GOAL_30M) return DEFAULT_DONATION_GOAL;
  return n;
}

/** 프리셋 초기 목표(후원 초기화 복원·최소 목표) */
export function parsePresetGoalBaseline(raw: unknown, fallbackGoal?: unknown): number {
  const fromBaseline = parseGoalAmount(raw);
  if (fromBaseline != null && fromBaseline > 0) {
    if (fromBaseline === LEGACY_DONATION_GOAL_30M) return DEFAULT_DONATION_GOAL;
    return fromBaseline;
  }
  const fromGoal = parseGoalAmount(fallbackGoal);
  if (fromGoal != null && fromGoal > 0) {
    if (fromGoal === LEGACY_DONATION_GOAL_30M) return DEFAULT_DONATION_GOAL;
    return fromGoal;
  }
  return DEFAULT_DONATION_GOAL;
}

/** 프리셋 달성 시 자동 상향 증가폭(원) */
export function parsePresetGoalIncreaseStep(raw: unknown): number {
  const n = parseGoalAmount(raw);
  if (n == null || n <= 0) return GOAL_AUTO_INCREASE_STEP;
  return n;
}

export function resolvePresetDonationGoalSettings(p: Record<string, unknown>): {
  baseline: number;
  step: number;
} {
  const baseline = parsePresetGoalBaseline(p.goalBaseline, p.goal);
  const step = parsePresetGoalIncreaseStep(p.goalIncreaseStep);
  return { baseline, step };
}

/**
 * 목표바 ON 프리셋: goalBaseline·goalIncreaseStep 정규화, 상향 이력(goal) 유지.
 * 비어 있거나 3천만 원이면 기본 200만 원으로 맞춤.
 */
export function normalizeOverlayPresetDonationGoals(presets: unknown[]): unknown[] {
  if (!Array.isArray(presets)) return [];
  return presets.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const p = raw as Record<string, unknown>;
    if (!presetShowsDonationGoal(p)) return { ...p };
    const { baseline, step } = resolvePresetDonationGoalSettings(p);
    let goal = normalizeGoalAmount(p.goal, baseline);
    if (goal < baseline) goal = baseline;
    return {
      ...p,
      goal: String(goal),
      goalBaseline: String(baseline),
      goalIncreaseStep: String(step),
    };
  });
}

/** 후원 합계 ≥ 목표 시 +200만 원 자동 상향 */
export function isDonationGoalAutoEscalateEnabled(): boolean {
  return true;
}

/** 멤버 계좌·투네 합계(후원 목표 현재값과 동일) */
export function computeLiveDonationTotalFromMembers(
  members: Array<{ account?: number; toon?: number }> | undefined
): number {
  return (members || []).reduce(
    (sum, m) =>
      sum + Math.max(0, Math.floor(Number(m.account || 0))) + Math.max(0, Math.floor(Number(m.toon || 0))),
    0
  );
}

/**
 * 저장 직전 상태에 목표 자동 상향 반영(관리자 후원 입력·OBS 폴링 공통).
 * OBS 브라우저 소스가 꺼져 있어도 Redis 프리셋 goal 이 200만 원씩 올라간다.
 */
export function applyDonationGoalEscalationToState(state: AppState): AppState {
  if (!isDonationGoalAutoEscalateEnabled()) return state;
  const presets = Array.isArray(state.overlayPresets) ? [...state.overlayPresets] : [];
  if (!presets.length) return state;

  const liveTotal = computeLiveDonationTotalFromMembers(state.members);
  let changed = false;

  const nextPresets = presets.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const p = raw as Record<string, unknown>;
    if (!presetShowsDonationGoal(p)) return raw;
    const { baseline, step } = resolvePresetDonationGoalSettings(p);
    const currentGoal = Math.max(baseline, normalizeGoalAmount(p.goal, baseline));
    const nextGoal = computeEscalatedDonationGoal(currentGoal, liveTotal, baseline, step);
    if (nextGoal <= currentGoal) return raw;
    changed = true;
    return {
      ...p,
      goal: String(nextGoal),
      goalBaseline: String(baseline),
      goalIncreaseStep: String(step),
    };
  });

  if (!changed) return state;
  return {
    ...state,
    overlayPresets: nextPresets as AppState["overlayPresets"],
    updatedAt: Date.now(),
  };
}

/**
 * 현재 목표 금액에 고정 200만 원을 더한 다음 목표(원).
 * (함수명 `nextGoalTenPercentIncrease`는 호환용)
 */
export function nextGoalTenPercentIncrease(goal: number, step: number = GOAL_AUTO_INCREASE_STEP): number {
  const g = Math.max(1, Math.floor(Number(goal) || 0));
  const s = Math.max(1, Math.floor(Number(step) || GOAL_AUTO_INCREASE_STEP));
  return g + s;
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
export function unwindGoalForDonationReset(
  currentGoal: number,
  maxSteps = 8,
  step: number = GOAL_AUTO_INCREASE_STEP
): number {
  let cur = Math.max(0, Math.floor(Number(currentGoal) || 0));
  if (cur <= 1) return cur;
  const s = Math.max(1, Math.floor(Number(step) || GOAL_AUTO_INCREASE_STEP));
  for (let i = 0; i < maxSteps; i++) {
    const pred = cur - s;
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

/** 후원·멤버 초기화 패치 — 이때만 서버가 goal 을 기준선(200만)으로 되돌릴 수 있음 */
export function isDonationInitGoalResetPatch(patch: {
  donors?: unknown;
  members?: Array<{ account?: number; toon?: number }>;
  overlayPresets?: unknown;
}): boolean {
  if (!Array.isArray(patch.donors) || patch.donors.length > 0) return false;
  if (!Array.isArray(patch.members)) return false;
  const membersZeroed = patch.members.every(
    (m) => Math.max(0, Math.floor(Number(m?.account || 0))) === 0 && Math.max(0, Math.floor(Number(m?.toon || 0))) === 0
  );
  if (!membersZeroed) return false;
  if (!Array.isArray(patch.overlayPresets)) return false;
  return patch.overlayPresets.some((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const p = raw as Record<string, unknown>;
    if (!presetShowsDonationGoal(p)) return false;
    const g = parseGoalAmount(p.goal);
    const b = parseGoalAmount(p.goalBaseline ?? DEFAULT_DONATION_GOAL);
    return g != null && b != null && g === b;
  });
}

/**
 * 오래된 관리자 탭 저장이 자동 상향된 goal(4M…)을 2M으로 덮어쓰지 않게 id별 max(goal) 병합.
 */
export function mergeOverlayPresetsPreservingEscalatedGoals(
  basePresets: unknown[] | undefined,
  patchPresets: unknown[] | undefined
): unknown[] {
  if (!Array.isArray(patchPresets)) return Array.isArray(basePresets) ? basePresets : [];
  const baseById = new Map<string, Record<string, unknown>>();
  for (const raw of basePresets || []) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const id = String(p.id || "").trim();
    if (id) baseById.set(id, p);
  }
  const baselineStr = String(DEFAULT_DONATION_GOAL);
  const stepStr = String(GOAL_AUTO_INCREASE_STEP);
  return patchPresets.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const p = { ...(raw as Record<string, unknown>) };
    if (!presetShowsDonationGoal(p)) return p;
    const id = String(p.id || "").trim();
    const prev = id ? baseById.get(id) : undefined;
    const { baseline: patchBaseline, step: patchStep } = resolvePresetDonationGoalSettings(p);
    const prevSettings = prev ? resolvePresetDonationGoalSettings(prev) : { baseline: DEFAULT_DONATION_GOAL, step: GOAL_AUTO_INCREASE_STEP };
    const patchGoal = normalizeGoalAmount(p.goal, patchBaseline);
    const prevGoal = prev ? normalizeGoalAmount(prev.goal, prevSettings.baseline) : patchBaseline;
    const maxGoal = Math.max(prevGoal, patchGoal);
    const baseline = patchBaseline || prevSettings.baseline;
    const step = patchStep || prevSettings.step;
    if (maxGoal > patchGoal) {
      return {
        ...p,
        goal: String(maxGoal),
        goalBaseline: String(p.goalBaseline ?? prev?.goalBaseline ?? baseline),
        goalIncreaseStep: String(p.goalIncreaseStep ?? prev?.goalIncreaseStep ?? step),
      };
    }
    if (!String(p.goalBaseline ?? "").trim()) {
      p.goalBaseline = String(prev?.goalBaseline ?? baseline);
    }
    if (!String(p.goalIncreaseStep ?? "").trim()) {
      p.goalIncreaseStep = String(prev?.goalIncreaseStep ?? stepStr);
    }
    return p;
  });
}
