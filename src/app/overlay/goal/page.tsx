"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeDonorsFormat, type AppState } from "@/lib/state";
import { getOverlayUserIdFromSearchParams, type OverlayPresetLike } from "@/lib/overlay-params";
import { GoalBar } from "@/components/GoalBar";
import { useGoalPresetAutoEscalate } from "@/hooks/useGoalPresetAutoEscalate";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";

export default function GoalOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useOverlayRemoteState(userId, { storageDebounceMs: 0 });
  const hostParam = (sp.get("host") || "").toLowerCase();
  const externalHost = hostParam === "prism" || hostParam === "obs" || hostParam === "external";

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
    const fromPreset = Number(activePreset?.goal || 0);
    const presetGoalOk = Number.isFinite(fromPreset) && fromPreset > 0;
    if (externalHost && ready && presetGoalOk) return Math.floor(fromPreset);
    const fromUrl = Number(sp.get("goal"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) return Math.floor(fromUrl);
    if (presetGoalOk) return Math.floor(fromPreset);
    return 0;
  }, [sp, activePreset, externalHost, ready]);

  const goalLabel = (sp.get("goalLabel") || activePreset?.goalLabel || "후원").trim();
  const amountFormat = useMemo(() => {
    if (ready && state?.donorsFormat) return normalizeDonorsFormat(state.donorsFormat, "short");
    const fromUrl = (sp.get("donorsFormat") || "").trim();
    if (fromUrl === "full" || fromUrl === "short") return fromUrl;
    return normalizeDonorsFormat(activePreset?.donorsFormat, "short");
  }, [sp, ready, state?.donorsFormat, activePreset?.donorsFormat]);
  const currencyLocale = (sp.get("currencyLocale") || activePreset?.currencyLocale || "ko-KR").trim();
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
  const goalTextColor = useMemo(() => {
    const fromPreset = String((activePreset as any)?.goalTextColor || "").trim();
    if (externalHost && ready && /^#[0-9a-fA-F]{3,8}$/.test(fromPreset)) return fromPreset;
    const fromUrl = (sp.get("goalTextColor") || "").trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(fromUrl)) return fromUrl;
    if (/^#[0-9a-fA-F]{3,8}$/.test(fromPreset)) return fromPreset;
    return "#fff7fb";
  }, [sp, activePreset, externalHost, ready]);
  const goalFontSizePx = useMemo(() => {
    const parse = (raw: string) => {
      const n = parseInt(raw, 10);
      return Number.isFinite(n) && n > 0 ? Math.max(10, Math.min(48, n)) : undefined;
    };
    const fromPreset = String((activePreset as any)?.goalFontSize || "").trim();
    if (externalHost && ready && fromPreset) {
      const n = parse(fromPreset);
      if (n != null) return n;
    }
    const fromUrl = (sp.get("goalFontSize") || "").trim();
    if (fromUrl) {
      const n = parse(fromUrl);
      if (n != null) return n;
    }
    if (fromPreset) return parse(fromPreset);
    return undefined;
  }, [sp, activePreset, externalHost, ready]);

  const totalCombined = useMemo(
    () => (state?.members || []).reduce((sum, m) => sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)), 0),
    [state?.members]
  );

  // 목표바 현재값은 항상 실시간 후원 합계와 동기화한다.
  const current = Math.max(0, totalCombined);

  useGoalPresetAutoEscalate({
    enabled: goal > 0 && Boolean(activePreset?.id),
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
              textColor={goalTextColor}
              fontSizePx={goalFontSizePx}
              amountFormat={amountFormat}
              locale={currencyLocale}
            />
          </section>
        ) : (
          <section className="rounded-xl border border-amber-300/50 bg-transparent px-4 py-2 text-sm font-semibold text-amber-100 md:bg-black/35">
            후원 목표 금액이 설정되지 않았습니다. 백오피스에서 입력해주세요.
          </section>
        )}
      </div>
    </main>
  );
}
