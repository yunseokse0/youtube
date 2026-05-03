"use client";

import { useEffect, useRef } from "react";

const GOAL_STRETCH_FACTOR = 1.2;
const PATCH_COOLDOWN_MS = 1400;

/** 현재 목표 금액의 20%만큼 상향(원 단위, 최소 +1원) */
export function nextGoalTwentyPercentIncrease(goal: number): number {
  const g = Math.max(1, Math.floor(Number(goal) || 0));
  return Math.max(g + 1, Math.ceil(g * GOAL_STRETCH_FACTOR));
}

type Args = {
  enabled: boolean;
  userId: string;
  presetId?: string | null;
  goalAmount: number;
  liveTotal: number;
  overlayPresets: unknown[] | undefined;
  /** 스냅샷·미준비 등 */
  skipPersist: boolean;
};

/**
 * 후원 합계가 목표 이상이면 해당 오버레이 프리셋의 goal 필드를 자동 상향해 `/api/state`에 반영한다.
 * 비활성: URL에 `goalAutoStretch=0` 또는 `noGoalAutoStretch=true`
 * URL에 `goal=`만 있으면 자동 상향 비활성(통합 오버레이). Prism/OBS(`host`)에서는 준비 후 프리셋 우선이라 예외 처리함.
 */
export function useGoalPresetAutoEscalate(args: Args): void {
  const inFlight = useRef(false);
  const lastPatchAt = useRef(0);

  useEffect(() => {
    if (!args.enabled || args.skipPersist) return;
    if (!args.presetId) return;
    const goal = args.goalAmount;
    if (goal <= 0 || args.liveTotal < goal) return;
    const presets = args.overlayPresets;
    if (!Array.isArray(presets) || presets.length === 0) return;

    const nextGoal = nextGoalTwentyPercentIncrease(goal);
    if (nextGoal <= goal) return;

    const now = Date.now();
    if (now - lastPatchAt.current < PATCH_COOLDOWN_MS) return;
    if (inFlight.current) return;

    inFlight.current = true;
    lastPatchAt.current = now;

    const updated = presets.map((raw) => {
      const x = raw as Record<string, unknown>;
      if (String(x.id || "") !== args.presetId) return raw;
      return { ...x, goal: String(nextGoal) };
    });

    void fetch(`/api/state?user=${encodeURIComponent(args.userId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ overlayPresets: updated }),
    })
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, [
    args.enabled,
    args.skipPersist,
    args.presetId,
    args.goalAmount,
    args.liveTotal,
    args.overlayPresets,
    args.userId,
  ]);
}
