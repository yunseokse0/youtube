"use client";

import { useEffect, useRef } from "react";
import {
  computeEscalatedDonationGoal,
  isDonationGoalAutoEscalateEnabled,
  resolvePresetDonationGoalSettings,
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
 * 후원 합계가 목표 이상이면 서버 `/api/overlay/goal-escalate`로 프리셋 goal을 원자적으로 상향한다.
 * 상향량: 프리셋 `goalIncreaseStep`(기본 200만 원). URL에 `goal=` 이 있어도 상향은 계속 동작한다.
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

    const presetRow = (() => {
      const pid = String(args.presetId || "").trim();
      if (pid) {
        const hit = presets.find((raw) => raw && typeof raw === "object" && String((raw as Record<string, unknown>).id || "") === pid);
        if (hit) return hit as Record<string, unknown>;
      }
      if (args.activePreset && typeof args.activePreset === "object") {
        return args.activePreset as Record<string, unknown>;
      }
      return presets.find(
        (raw) =>
          raw &&
          typeof raw === "object" &&
          ((raw as Record<string, unknown>).showGoal === true ||
            (raw as Record<string, unknown>).showGoal === "true")
      ) as Record<string, unknown> | undefined;
    })();
    const { baseline, step } = resolvePresetDonationGoalSettings(presetRow || {});

    const storedGoal = Math.max(baseline, Math.floor(goal));
    const nextGoal = computeEscalatedDonationGoal(storedGoal, args.liveTotal, baseline, step);
    if (nextGoal <= storedGoal) return;

    const now = Date.now();
    if (now - lastPatchAt.current < PATCH_COOLDOWN_MS) return;
    if (inFlight.current) return;

    inFlight.current = true;
    lastPatchAt.current = now;

    void fetch(`/api/overlay/goal-escalate?user=${encodeURIComponent(args.userId)}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presetId: args.presetId || undefined,
        liveTotal: args.liveTotal,
      }),
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
