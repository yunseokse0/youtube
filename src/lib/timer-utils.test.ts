import { describe, expect, it, vi } from "vitest";
import {
  getEffectiveRemainingTime,
  mergeGeneralTimerPreferEffective,
  resumeTimer,
} from "./timer-utils";
import type { TimerState } from "@/types";

describe("mergeGeneralTimerPreferEffective", () => {
  it("keeps running timer when incoming stale reset is {0,false}", () => {
    const now = 1_000_000;
    const running: TimerState = {
      remainingTime: 600,
      isActive: true,
      lastUpdated: now - 120_000,
    };
    const stale: TimerState = {
      remainingTime: 0,
      isActive: false,
      lastUpdated: now - 500_000,
    };
    const merged = mergeGeneralTimerPreferEffective(running, stale, now);
    expect(getEffectiveRemainingTime(merged, now)).toBe(480);
    expect(merged.isActive).toBe(true);
  });

  it("keeps running timer when incoming {0,false} has no lastUpdated", () => {
    const now = 1_500_000;
    const running: TimerState = {
      remainingTime: 300,
      isActive: true,
      lastUpdated: now - 30_000,
    };
    const stale: TimerState = {
      remainingTime: 0,
      isActive: false,
      lastUpdated: 0,
    };
    const merged = mergeGeneralTimerPreferEffective(running, stale, now);
    expect(getEffectiveRemainingTime(merged, now)).toBe(270);
    expect(merged.isActive).toBe(true);
  });

  it("accepts fresh admin stop {0,false} with newer lastUpdated", () => {
    const now = 2_000_000;
    const running: TimerState = {
      remainingTime: 600,
      isActive: true,
      lastUpdated: now - 60_000,
    };
    const stopped: TimerState = {
      remainingTime: 0,
      isActive: false,
      lastUpdated: now - 100,
    };
    const merged = mergeGeneralTimerPreferEffective(running, stopped, now);
    expect(getEffectiveRemainingTime(merged, now)).toBe(0);
    expect(merged.isActive).toBe(false);
  });

  it("prefers higher effective remaining when both active", () => {
    const now = 3_000_000;
    const local: TimerState = {
      remainingTime: 300,
      isActive: true,
      lastUpdated: now - 5_000,
    };
    const remote: TimerState = {
      remainingTime: 600,
      isActive: true,
      lastUpdated: now - 120_000,
    };
    const merged = mergeGeneralTimerPreferEffective(local, remote, now);
    expect(getEffectiveRemainingTime(merged, now)).toBeGreaterThan(400);
  });

  it("does not re-anchor lastUpdated so frequent merges keep counting down", () => {
    const start = 5_000_000;
    let timer: TimerState = {
      remainingTime: 5,
      isActive: true,
      lastUpdated: start,
    };
    for (let ms = 100; ms <= 5000; ms += 100) {
      const now = start + ms;
      timer = mergeGeneralTimerPreferEffective(timer, { ...timer }, now);
    }
    expect(getEffectiveRemainingTime(timer, start + 5000)).toBe(0);
    expect(timer.lastUpdated).toBe(start);
  });

  it("rejects fake fresh stop with lastUpdated=0 even if Date.now-like defaults appear", () => {
    const now = 6_000_000;
    const running: TimerState = {
      remainingTime: 120,
      isActive: true,
      lastUpdated: now - 10_000,
    };
    const fakeStop: TimerState = {
      remainingTime: 0,
      isActive: false,
      lastUpdated: 0,
    };
    const merged = mergeGeneralTimerPreferEffective(running, fakeStop, now);
    expect(merged.isActive).toBe(true);
    expect(getEffectiveRemainingTime(merged, now)).toBe(110);
  });

  it("keeps local paused timer when remote stale reset is {0,false}", () => {
    const now = 7_000_000;
    const paused: TimerState = {
      remainingTime: 3500,
      isActive: false,
      lastUpdated: now - 2_000,
    };
    const staleZero: TimerState = {
      remainingTime: 0,
      isActive: false,
      lastUpdated: now - 5_000,
    };
    const merged = mergeGeneralTimerPreferEffective(paused, staleZero, now);
    expect(merged.isActive).toBe(false);
    expect(getEffectiveRemainingTime(merged, now)).toBe(3500);
  });

  it("accepts admin 0-minute reset over paused overlay timer when incoming is newer", () => {
    const now = 7_500_000;
    const paused: TimerState = {
      remainingTime: 3538,
      isActive: false,
      lastUpdated: now - 120_000,
    };
    const adminReset: TimerState = {
      remainingTime: 0,
      isActive: false,
      lastUpdated: now - 100,
    };
    const merged = mergeGeneralTimerPreferEffective(paused, adminReset, now);
    expect(getEffectiveRemainingTime(merged, now)).toBe(0);
    expect(merged.isActive).toBe(false);
  });

  it("accepts explicit pause patch over running server timer", () => {
    const now = 8_000_000;
    const running: TimerState = {
      remainingTime: 3600,
      isActive: true,
      lastUpdated: now - 10_000,
    };
    const pausedPatch: TimerState = {
      remainingTime: 3590,
      isActive: false,
      lastUpdated: now - 100,
    };
    const merged = mergeGeneralTimerPreferEffective(running, pausedPatch, now);
    expect(merged.isActive).toBe(false);
    expect(getEffectiveRemainingTime(merged, now)).toBe(3590);
  });

  it("accepts admin resume over overlay running ahead on stale anchor", () => {
    const now = 9_000_000;
    const staleRunning: TimerState = {
      remainingTime: 477,
      isActive: true,
      lastUpdated: now - 120_000,
    };
    const adminResumed: TimerState = {
      remainingTime: 300,
      isActive: true,
      lastUpdated: now - 200,
    };
    const merged = mergeGeneralTimerPreferEffective(staleRunning, adminResumed, now);
    expect(merged.isActive).toBe(true);
    expect(getEffectiveRemainingTime(merged, now)).toBe(300);
  });

  it("accepts delayed admin stop {0,false} over overlay still running", () => {
    const now = 10_000_000;
    const staleRunning: TimerState = {
      remainingTime: 600,
      isActive: true,
      lastUpdated: now - 90_000,
    };
    const stopped: TimerState = {
      remainingTime: 0,
      isActive: false,
      lastUpdated: now - 20_000,
    };
    const merged = mergeGeneralTimerPreferEffective(staleRunning, stopped, now);
    expect(merged.isActive).toBe(false);
    expect(getEffectiveRemainingTime(merged, now)).toBe(0);
  });
});

describe("resumeTimer", () => {
  it("uses effective remaining, not stale remainingTime field", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const paused: TimerState = {
      remainingTime: 600,
      isActive: true,
      lastUpdated: 4_000,
    };
    const resumed = resumeTimer(paused);
    expect(resumed.remainingTime).toBe(594);
    expect(resumed.isActive).toBe(true);
    vi.useRealTimers();
  });
});
