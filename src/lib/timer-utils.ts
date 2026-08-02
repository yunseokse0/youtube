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
 */
function snapshotActiveTimer(timer: TimerState, eff: number, now: number): TimerState {
  if (!timer.isActive || eff <= 0) return timer;
  return { remainingTime: eff, isActive: true, lastUpdated: now };
}

export function mergeGeneralTimerPreferEffective(
  base: TimerState | undefined | null,
  incoming: TimerState | undefined | null,
  now = Date.now()
): TimerState {
  const a = normalizeTimerState(base, now);
  const b = normalizeTimerState(incoming, now);
  const effA = getEffectiveRemainingTime(a, now);
  const effB = getEffectiveRemainingTime(b, now);

  /** 관리자 정지 — incoming 정지가 base 스냅샷보다 엄격히 최신이고, 방금(15s) 이내 */
  if (effB <= 0 && !b.isActive && (b.lastUpdated || 0) > (a.lastUpdated || 0)) {
    const stopAgeMs = now - (b.lastUpdated || 0);
    if (!(effA > 0 && a.isActive) || stopAgeMs <= 15_000) {
      return b;
    }
  }

  /** 진행 중인 타이머는 stale 원격 {0,false}·낮은 remaining 으로 덮지 않음 */
  if (effB <= 0 && effA > 0) {
    return snapshotActiveTimer(a, effA, now);
  }

  if (effA > effB + 1) {
    return snapshotActiveTimer(a, effA, now);
  }

  if (b.isActive && effB > 0) {
    return { remainingTime: effB, isActive: true, lastUpdated: now };
  }

  return b;
}

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
