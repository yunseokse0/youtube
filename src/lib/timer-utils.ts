import type { TimerState } from "@/types";

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
  return {
    remainingTime: Math.max(0, Math.floor(timer.remainingTime || 0)),
    isActive: true,
    lastUpdated: Date.now(),
  };
}

export function getEffectiveRemainingTime(timer: TimerState, now = Date.now()): number {
  const base = Math.max(0, Math.floor(timer.remainingTime || 0));
  if (!timer.isActive) return base;
  const elapsedSec = Math.max(0, Math.floor((now - (timer.lastUpdated || now)) / 1000));
  return Math.max(0, base - elapsedSec);
}

