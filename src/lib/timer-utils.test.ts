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
