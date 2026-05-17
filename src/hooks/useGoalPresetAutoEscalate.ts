"use client";

import { useEffect, useRef } from "react";
import {
  DEFAULT_DONATION_GOAL,
  computeEscalatedDonationGoal,
  isDonationGoalAutoEscalateEnabled,
} from "@/lib/goal-preset-math";

const PATCH_COOLDOWN_MS = 1400;

export { nextGoalTenPercentIncrease } from "@/lib/goal-preset-math";

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
 * 상향량: 목표 금액과 무관하게 고정 **+200만 원**(`GOAL_AUTO_INCREASE_STEP`).
 * 비활성: URL에 `goalAutoStretch=0` 또는 `noGoalAutoStretch=true`
 * URL에 `goal=`만 있으면 자동 상향 비활성(통합 오버레이). Prism/OBS(`host`)에서는 준비 후 프리셋 우선이라 예외 처리함.
 */
export function useGoalPresetAutoEscalate(args: Args): void {
  const inFlight = useRef(false);
  const lastPatchAt = useRef(0);

  useEffect(() => {
    if (!isDonationGoalAutoEscalateEnabled()) return;
    if (!args.enabled || args.skipPersist) return;
    if (!args.presetId) return;
    const goal = args.goalAmount;
    if (goal <= 0 || args.liveTotal < goal) return;
    const presets = args.overlayPresets;
    if (!Array.isArray(presets) || presets.length === 0) return;

    const storedGoal = Math.max(DEFAULT_DONATION_GOAL, Math.floor(goal));
    const nextGoal = computeEscalatedDonationGoal(storedGoal, args.liveTotal);
    if (nextGoal <= storedGoal) return;

    const now = Date.now();
    if (now - lastPatchAt.current < PATCH_COOLDOWN_MS) return;
    if (inFlight.current) return;

    inFlight.current = true;
    lastPatchAt.current = now;

    const updated = presets.map((raw) => {
      const x = raw as Record<string, unknown>;
      if (String(x.id || "") !== args.presetId) return raw;
      /** 후원 초기화 시 항상 200만 원 기준선으로 복구 */
      return { ...x, goal: String(nextGoal), goalBaseline: String(DEFAULT_DONATION_GOAL) };
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
