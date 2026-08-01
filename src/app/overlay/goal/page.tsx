"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { normalizeDonorsFormat, overlayPresetsStorageKey, type AppState } from "@/lib/state";
import {
  getOverlayUserIdFromSearchParams,
  mergeOverlayPresetsPreferLocal,
  presetToParams,
  resolveGoalFontSizePx,
  resolveGoalTextColor,
  resolveGoalTextOutlineColor,
  resolveGoalTextOutlineWidthPx,
  resolveGoalBarBgColor,
  resolveGoalBarFillColorParam,
  resolveGoalFontFamilyCss,
  resolveGoalBarAnimationMode,
  resolveOverlayTextSharpRender,
  resolveGoalFontWeight,
  resolveLivePresetStyleParam,
  type OverlayPresetLike,
} from "@/lib/overlay-params";
import { subscribeOverlayPresetsLocalUpdated } from "@/lib/broadcast-state-local-sync";
import { GoalBar } from "@/components/GoalBar";
import { useGoalPresetAutoEscalate } from "@/hooks/useGoalPresetAutoEscalate";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { clampWidthToViewport } from "@/lib/overlay-mobile-fit";
import { useOverlayViewportSize } from "@/hooks/useOverlayViewportSize";

export default function GoalOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const { state, ready } = useOverlayRemoteState(userId, { storageDebounceMs: 0 });
  const hostParam = (sp.get("host") || "").toLowerCase();
  const externalHost = hostParam === "prism" || hostParam === "obs" || hostParam === "external";

  const [localPresets, setLocalPresets] = useState<OverlayPresetLike[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const perUserKey = overlayPresetsStorageKey(userId);
      const raw =
        window.localStorage.getItem(perUserKey) ||
        window.localStorage.getItem("excel-broadcast-overlay-presets");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OverlayPresetLike[]) : [];
    } catch {
      return [];
    }
  });
  const readLocalPresets = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const perUserKey = overlayPresetsStorageKey(userId);
      const raw =
        window.localStorage.getItem(perUserKey) ||
        window.localStorage.getItem("excel-broadcast-overlay-presets");
      if (!raw) {
        setLocalPresets([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setLocalPresets(parsed as OverlayPresetLike[]);
    } catch {
      setLocalPresets([]);
    }
  }, [userId]);
  useEffect(() => {
    readLocalPresets();
    const unsubscribe = subscribeOverlayPresetsLocalUpdated(() => readLocalPresets());
    return unsubscribe;
  }, [readLocalPresets]);

  const overlayPresets = useMemo(() => {
    const remote =
      ready && state && Array.isArray(state.overlayPresets)
        ? (state.overlayPresets as OverlayPresetLike[])
        : [];
    return mergeOverlayPresetsPreferLocal(remote, localPresets);
  }, [ready, state, localPresets]);

  const activePreset = useMemo(() => {
    const presets = overlayPresets;
    if (!Array.isArray(presets) || presets.length === 0) return null;
    const isGoalEnabledPreset = (preset: OverlayPresetLike | null | undefined) => {
      if (!preset) return false;
      const goalValue = Number(preset.goal || 0);
      return Boolean(preset.showGoal) || (Number.isFinite(goalValue) && goalValue > 0);
    };
    const firstGoalPreset = presets.find((x) => isGoalEnabledPreset(x)) || null;
    const pId = (sp.get("p") || "").trim();
    if (pId) return presets.find((x) => x.id === pId) || firstGoalPreset || presets[0] || null;
    const preferredId = (state as AppState | null)?.overlaySettings?.currentPresetId;
    if (preferredId) {
      const preferred = presets.find((x) => x.id === preferredId) || null;
      return preferred || firstGoalPreset || presets[0] || null;
    }
    return firstGoalPreset || presets[0] || null;
  }, [overlayPresets, state, sp]);

  const presetParams = useMemo(() => presetToParams(activePreset), [activePreset]);

  const goal = useMemo(() => {
    const fromPreset = Number(activePreset?.goal || 0);
    const presetGoalOk = Number.isFinite(fromPreset) && fromPreset > 0;
    if (externalHost && ready && presetGoalOk) return Math.floor(fromPreset);
    const fromUrl = Number(sp.get("goal"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) return Math.floor(fromUrl);
    if (presetGoalOk) return Math.floor(fromPreset);
    return 0;
  }, [sp, activePreset, externalHost, ready]);

  const goalLabel = (
    resolveLivePresetStyleParam("goalLabel", sp, presetParams, { ready }) ||
    activePreset?.goalLabel ||
    "후원"
  ).trim();
  const amountFormat = useMemo(() => {
    const fromPresetStyle = resolveLivePresetStyleParam("donorsFormat", sp, presetParams, { ready });
    if (fromPresetStyle === "full" || fromPresetStyle === "short") {
      return normalizeDonorsFormat(fromPresetStyle, "short");
    }
    if (ready && state?.donorsFormat) return normalizeDonorsFormat(state.donorsFormat, "short");
    const fromUrl = (sp.get("donorsFormat") || "").trim();
    if (fromUrl === "full" || fromUrl === "short") return fromUrl;
    return normalizeDonorsFormat(activePreset?.donorsFormat, "short");
  }, [sp, presetParams, ready, state?.donorsFormat, activePreset?.donorsFormat]);
  const currencyLocale = (
    resolveLivePresetStyleParam("currencyLocale", sp, presetParams, { ready }) ||
    activePreset?.currencyLocale ||
    "ko-KR"
  ).trim();
  const width = useMemo(() => {
    const fromStyle = resolveLivePresetStyleParam("goalWidth", sp, presetParams, { ready });
    const fromUrl = Number(fromStyle || sp.get("goalWidth"));
    if (Number.isFinite(fromUrl) && fromUrl > 0) {
      return Math.max(260, Math.min(1200, Math.floor(fromUrl)));
    }
    const fromPreset = Number(activePreset?.goalWidth || 0);
    if (Number.isFinite(fromPreset) && fromPreset > 0) {
      return Math.max(260, Math.min(1200, Math.floor(fromPreset)));
    }
    return 560;
  }, [sp, presetParams, ready, activePreset?.goalWidth]);
  const viewportSize = useOverlayViewportSize();
  const responsiveWidth = useMemo(
    () => clampWidthToViewport(width, viewportSize.w),
    [width, viewportSize.w]
  );
  const goalOpacity = useMemo(() => {
    const raw = resolveLivePresetStyleParam("goalOpacity", sp, presetParams, { ready }) || "";
    if (!raw) return 100;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
  }, [sp, presetParams, ready]);
  const goalOpacityAffectsText = useMemo(() => {
    const raw = (resolveLivePresetStyleParam("goalOpacityText", sp, presetParams, { ready }) || "")
      .trim()
      .toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    return false;
  }, [sp, presetParams, ready]);
  const goalTextColor = useMemo(
    () => resolveGoalTextColor(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalFontSizePx = useMemo(
    () => resolveGoalFontSizePx(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalTextOutlineColor = useMemo(
    () => resolveGoalTextOutlineColor(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalTextOutlineWidthPx = useMemo(
    () => resolveGoalTextOutlineWidthPx(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalBarBgColor = useMemo(
    () => resolveGoalBarBgColor(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalBarFillColor = useMemo(
    () => resolveGoalBarFillColorParam(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalFontFamilyCss = useMemo(
    () => resolveGoalFontFamilyCss(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalBarAnimationMode = useMemo(
    () => resolveGoalBarAnimationMode(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const overlayTextSharpRender = useMemo(
    () => resolveOverlayTextSharpRender(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );
  const goalFontWeight = useMemo(
    () => resolveGoalFontWeight(sp, activePreset, { ready }),
    [sp, activePreset, ready]
  );

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
    overlayPresets: overlayPresets as unknown[] | undefined,
    skipPersist: !ready,
  });

  if (!ready) return null;

  return (
    <main className="overlay-root min-h-screen w-full bg-transparent p-4">
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .overlay-root .overlay-goal-bar-widget .overlay-goal-bar-text {
          color: ${goalTextColor} !important;
          -webkit-text-fill-color: ${goalTextColor} !important;
          -webkit-font-smoothing: antialiased;
          text-rendering: ${overlayTextSharpRender ? "geometricPrecision" : "optimizeLegibility"};
          ${goalFontFamilyCss ? `font-family: ${goalFontFamilyCss} !important;` : ""}
        }
      `,
        }}
      />
      <div className="mx-auto flex min-h-[120px] w-full max-w-[100vw] items-center justify-center px-2" style={{ width: responsiveWidth }}>
        {goal > 0 ? (
          <section className="w-full p-0">
            <GoalBar
              current={current}
              goal={goal}
              label={goalLabel}
              width={responsiveWidth}
              opacityPercent={goalOpacity}
              opacityAffectsText={goalOpacityAffectsText}
              textColor={goalTextColor}
              fontSizePx={goalFontSizePx}
              textOutlineColor={goalTextOutlineColor}
              textOutlineWidthPx={goalTextOutlineWidthPx}
              barBgColor={goalBarBgColor}
              barFillColor={goalBarFillColor}
              fontFamilyCss={goalFontFamilyCss}
              animationMode={goalBarAnimationMode}
              fontWeight={goalFontWeight}
              sharpRender={overlayTextSharpRender}
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
