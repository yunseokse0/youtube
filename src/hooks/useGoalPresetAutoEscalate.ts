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
  activePreset?: unknown;
  goalAmount: number;
  liveTotal: number;
  overlayPresets: unknown[] | undefined;
  /** 스냅샷·미준비 등 */
  skipPersist: boolean;
};

/**
 * 후원 합계가 목표 이상이면 해당 오버레이 프리셋의 goal 필드를 자동 상향해 `/api/state`에 반영한다.
 * 상향량: 고정 **+200만 원**(`GOAL_AUTO_INCREASE_STEP`). URL에 `goal=` 이 있어도 상향은 계속 동작한다.
 */
export function useGoalPresetAutoEscalate(args: Args): void {
  const inFlight = useRef(false);
  const lastPatchAt = useRef(0);

  useEffect(() => {
    if (!isDonationGoalAutoEscalateEnabled()) return;
    if (!args.enabled || args.skipPersist) return;
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

    const targetIndex = (() => {
      if (args.presetId) {
        const idxById = presets.findIndex((raw) => String((raw as Record<string, unknown>)?.id || "") === args.presetId);
        if (idxById >= 0) return idxById;
      }
      if (args.activePreset) {
        const idxByRef = presets.findIndex((raw) => raw === args.activePreset);
        if (idxByRef >= 0) return idxByRef;
      }
      const idxByGoalVisible = presets.findIndex((raw) => {
        const x = raw as Record<string, unknown>;
        return x?.showGoal === true || String(x?.showGoal || "").toLowerCase() === "true";
      });
      if (idxByGoalVisible >= 0) return idxByGoalVisible;
      return 0;
    })();
    const updated = presets.map((raw, idx) => {
      if (idx !== targetIndex) return raw;
      /** 후원 초기화 시 항상 200만 원 기준선으로 복구 */
      return {
        ...(raw as Record<string, unknown>),
        goal: String(nextGoal),
        goalBaseline: String(DEFAULT_DONATION_GOAL),
      };
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
    args.activePreset,
    args.goalAmount,
    args.liveTotal,
    args.overlayPresets,
    args.userId,
  ]);
}
