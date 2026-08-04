import type { TimerState } from "@/types";

export function normalizeTimerState(input: unknown, now = Date.now()): TimerState {
  const t = input && typeof input === "object" ? (input as Partial<TimerState>) : {};
  return {
    remainingTime: Number.isFinite(t.remainingTime) ? Math.max(0, Math.floor(t.remainingTime as number)) : 0,
    isActive: Boolean(t.isActive),
    /** lastUpdated 없음 → 0 (Date.now() 대입 시 stale {0,false}가 항상 '최신 정지'로 오인됨) */
    lastUpdated: Number.isFinite(t.lastUpdated) ? Math.max(0, Math.floor(t.lastUpdated as number)) : 0,
  };
}

export function pauseTimer(timer: TimerState): TimerState {
  const now = Date.now();
  const remaining = getEffectiveRemainingTime(timer, now);
  return {
    remainingTime: remaining,
    isActive: false,
    lastUpdated: now,
  };
}

export function resumeTimer(timer: TimerState): TimerState {
  const now = Date.now();
  const remaining = getEffectiveRemainingTime(timer, now);
  return {
    remainingTime: remaining,
    isActive: true,
    lastUpdated: now,
  };
}

export function getEffectiveRemainingTime(timer: TimerState, now = Date.now()): number {
  const base = Math.max(0, Math.floor(timer.remainingTime || 0));
  if (!timer.isActive) return base;
  const anchor = timer.lastUpdated || 0;
  if (anchor <= 0) return base;
  const elapsedSec = Math.max(0, Math.floor((now - anchor) / 1000));
  return Math.max(0, base - elapsedSec);
}

/**
 * 원격 동기화·PATCH 시 generalTimer가 0으로 덮이는 회귀 방지.
 * - 진행 중인 타이머(effective>0)가 stale {0,false} 로 덮일 때 유지
 * - 더 많이 남은 쪽 우선(클라이언트·서버 시계 drift 1초 허용)
 * - **lastUpdated를 now로 재앵커하지 않음** — 폴링마다 재앵커하면 1초에 멈춤
 */
export function mergeGeneralTimerPreferEffective(
  base: TimerState | undefined | null,
  incoming: TimerState | undefined | null,
  now = Date.now()
): TimerState {
  const a = normalizeTimerState(base, now);
  const b = normalizeTimerState(incoming, now);
  const effA = getEffectiveRemainingTime(a, now);
  const effB = getEffectiveRemainingTime(b, now);

  /** 관리자 정지 — lastUpdated가 실값이고 base보다 엄격히 최신이며, 방금(15s) 이내 */
  if (
    effB <= 0 &&
    !b.isActive &&
    (b.lastUpdated || 0) > 0 &&
    (b.lastUpdated || 0) > (a.lastUpdated || 0)
  ) {
    const stopAgeMs = now - (b.lastUpdated || 0);
    if (!(effA > 0 && a.isActive) || stopAgeMs <= 15_000) {
      return b;
    }
  }

  /** 진행 중인 타이머는 stale 원격 {0,false}·낮은 remaining 으로 덮지 않음 (원본 앵커 유지) */
  if (effB <= 0 && effA > 0) {
    return a;
  }

  if (effA > effB + 1) {
    return a;
  }

  if (b.isActive && effB > 0) {
    return b;
  }

  if (a.isActive && effA > 0 && (a.lastUpdated || 0) >= (b.lastUpdated || 0)) {
    return a;
  }

  return b;
}

/** persist/스냅샷용 — 유효 남은 시간을 remainingTime에 고정하고 앵커를 지금으로 맞춤 */
export function snapshotTimerForPersist(timer: TimerState, now = Date.now()): TimerState {
  const normalized = normalizeTimerState(timer, now);
  const remaining = getEffectiveRemainingTime(normalized, now);
  if (!normalized.isActive) {
    return { ...normalized, remainingTime: remaining };
  }
  return {
    remainingTime: remaining,
    isActive: true,
    lastUpdated: now,
  };
}
