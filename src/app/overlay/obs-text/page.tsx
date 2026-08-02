"use client";

import { useEffect, useMemo } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import { ObsTextOverlayView } from "@/components/obs-text/ObsTextOverlayView";
import {
  OBS_TEXT_ID_QUERY,
  hasObsTextRegistryInState,
  readObsTextOverlayFromState,
  readObsTextRegistryFromState,
  resolveObsTextInstanceId,
} from "@/lib/obs-text-overlay";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { readObsTextOverlayPollMs } from "@/lib/overlay-pull-policy";
import { STATE_PICK_OBS_TEXT } from "@/lib/state-api-pick";

function ObsTextOverlayInner({ userId }: { userId: string }) {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const textId = sp.get(OBS_TEXT_ID_QUERY);
  const hostObs = isOverlayBroadcastHost(sp);
  const { state, resync } = useOverlayRemoteState(userId, {
    statePick: STATE_PICK_OBS_TEXT,
    skipLocalSnapshot: true,
    forceInitialFull: true,
    overlayPollMs: readObsTextOverlayPollMs(),
  });

  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) void resync({ forceFull: true });
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [resync]);

  useEffect(() => {
    if (!hostObs) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void resync({ forceFull: true }), 400);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [hostObs, resync]);

  const resolvedInstanceId = useMemo(
    () => resolveObsTextInstanceId(readObsTextRegistryFromState(state), textId),
    [state, textId]
  );

  const config = useMemo(
    () => readObsTextOverlayFromState(state, textId),
    [state, textId]
  );

  const canDisplay = state != null && hasObsTextRegistryInState(state);

  if (!spReady || !canDisplay) {
    return hostObs ? null : (
      <div className="fixed inset-0 flex items-center justify-center text-white/40 text-sm">
        …
      </div>
    );
  }

  return (
    <ObsTextOverlayView
      key={`${userId}:${resolvedInstanceId}`}
      config={config}
    />
  );
}

export default function ObsTextOverlayPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  if (!spReady) return null;
  return <ObsTextOverlayInner key={userId} userId={userId} />;
}
