"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";
import { getOverlayUserIdFromSearchParams, type OverlayPresetLike } from "@/lib/overlay-params";
import { GoalBar } from "@/components/GoalBar";
import { useGoalPresetAutoEscalate } from "@/hooks/useGoalPresetAutoEscalate";

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);

  useEffect(() => {
    let hasLocalSnapshot = false;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(storageKey(userId));
        if (raw) {
          const local = loadState(userId ?? undefined);
          setState(local);
          lastUpdatedRef.current = local.updatedAt || 0;
          hasLocalSnapshot = true;
        }
      } catch {
        // ignore local read error
      }
    }
    if (!hasLocalSnapshot) {
      const fallback = defaultState();
      setState(fallback);
      // No persisted local snapshot: allow API state to win immediately.
      lastUpdatedRef.current = 0;
    }

    const syncFromApi = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const remote = await loadStateFromApi(userId);
        if (!remote) return;
        const remoteUpdatedAt = remote.updatedAt || 0;
        if (lastUpdatedRef.current <= 0 || remoteUpdatedAt >= lastUpdatedRef.current) {
          lastUpdatedRef.current = remoteUpdatedAt;
          setState(remote);
        }
      } finally {
        syncingRef.current = false;
      }
    };

    void syncFromApi();
    const id = window.setInterval(() => void syncFromApi(), 2500);
    return () => window.clearInterval(id);
  }, [userId]);

  return { state, ready: state !== null };
}

export default function GoalOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useRemoteState(userId);

  const activePreset = useMemo(() => {
    const presets = (state?.overlayPresets || []) as OverlayPresetLike[];
    if (!Array.isArray(presets) || presets.length === 0) return null;
    const isGoalEnabledPreset = (preset: OverlayPresetLike | null | undefined) => {
      if (!preset) return false;
      const goalValue = Number(preset.goal || 0);
      return Boolean(preset.showGoal) || (Number.isFinite(goalValue) && goalValue > 0);
    };
    const firstGoalPreset = presets.find((x) => isGoalEnabledPreset(x)) || null;
    const pId = (sp.get("p") || "").trim();
    if (pId) return presets.find((x) => x.id === pId) || firstGoalPreset || presets[0] || null;
    const preferredId = (state as any)?.overlaySettings?.currentPresetId;
    if (preferredId) {
      const preferred = presets.find((x) => x.id === preferredId) || null;
      return preferred || firstGoalPreset || presets[0] || null;
    }
    return firstGoalPreset || presets[0] || null;
  }, [state, sp]);

  const goal = useMemo(() => {
    const fromUrl = Number(sp.get("goal"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) return Math.floor(fromUrl);
    const fromPreset = Number(activePreset?.goal || 0);
    if (Number.isFinite(fromPreset) && fromPreset > 0) return Math.floor(fromPreset);
    return 0;
  }, [sp, activePreset?.goal]);

  const goalLabel = (sp.get("goalLabel") || activePreset?.goalLabel || "후원").trim();
  const width = useMemo(() => {
    const fromUrl = Number(sp.get("goalWidth"));
    if (Number.isFinite(fromUrl)) return Math.max(260, Math.min(1200, Math.floor(fromUrl)));
    const fromPreset = Number(activePreset?.goalWidth || 0);
    if (Number.isFinite(fromPreset) && fromPreset > 0) return Math.max(260, Math.min(1200, Math.floor(fromPreset)));
    return 560;
  }, [sp, activePreset?.goalWidth]);
  const goalOpacity = useMemo(() => {
    const rawUrl = (sp.get("goalOpacity") || "").trim();
    const rawPreset = String((activePreset as any)?.goalOpacity || "").trim();
    const rawTableOpacityPreset = String((activePreset as any)?.tableBgOpacity || "").trim();
    const raw = rawUrl || rawPreset || rawTableOpacityPreset;
    if (!raw) return 100;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
  }, [sp, activePreset]);
  const goalOpacityAffectsText = useMemo(() => {
    const rawUrl = (sp.get("goalOpacityText") || "").trim().toLowerCase();
    if (rawUrl === "true") return true;
    if (rawUrl === "false") return false;
    const rawPreset = String((activePreset as any)?.goalOpacityText ?? "").trim().toLowerCase();
    if (rawPreset === "true") return true;
    if (rawPreset === "false") return false;
    return false;
  }, [sp, activePreset]);

  const totalCombined = useMemo(
    () => (state?.members || []).reduce((sum, m) => sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)), 0),
    [state?.members]
  );

  // 목표바 현재값은 항상 실시간 후원 합계와 동기화한다.
  const current = Math.max(0, totalCombined);

  const goalPinnedByRawUrl =
    (() => {
      const g = sp.get("goal");
      if (g === null || String(g).trim() === "") return false;
      const n = parseInt(String(g), 10);
      return Number.isFinite(n) && n > 0;
    })();
  useGoalPresetAutoEscalate({
    enabled:
      sp.get("goalAutoStretch") !== "0" &&
      String(sp.get("noGoalAutoStretch") || "").toLowerCase() !== "true" &&
      goal > 0 &&
      !goalPinnedByRawUrl &&
      Boolean(activePreset?.id),
    userId: userId || "finalent",
    presetId: activePreset?.id ?? null,
    goalAmount: goal,
    liveTotal: current,
    overlayPresets: state?.overlayPresets as unknown[] | undefined,
    skipPersist: !ready,
  });

  if (!ready) return null;

  return (
    <main className="min-h-screen w-full bg-transparent p-4">
      <div className="mx-auto flex min-h-[120px] items-center justify-center" style={{ width }}>
        {goal > 0 ? (
          <section className="w-full p-0">
            <GoalBar
              current={current}
              goal={goal}
              label={goalLabel}
              width={width}
              opacityPercent={goalOpacity}
              opacityAffectsText={goalOpacityAffectsText}
            />
          </section>
        ) : (
          <section className="rounded-xl border border-amber-300/50 bg-black/35 px-4 py-2 text-sm font-semibold text-amber-100">
            후원 목표 금액이 설정되지 않았습니다. 백오피스에서 입력해주세요.
          </section>
        )}
      </div>
    </main>
  );
}
