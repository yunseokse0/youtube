"use client";

import { useEffect, useMemo } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import { ObsTextOverlayView } from "@/components/obs-text/ObsTextOverlayView";
import {
  OBS_TEXT_ID_QUERY,
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

function ObsTextOverlayInner() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const textId = sp.get(OBS_TEXT_ID_QUERY);
  const hostObs = isOverlayBroadcastHost(sp);
  const { state, ready, resync } = useOverlayRemoteState(userId, {
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
    const onVis = () => {
      if (document.visibilityState === "visible") void resync({ forceFull: true });
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [hostObs, resync]);

  const resolvedInstanceId = useMemo(
    () => resolveObsTextInstanceId(readObsTextRegistryFromState(state), textId),
    [state, textId]
  );

  const config = useMemo(
    () => readObsTextOverlayFromState(state, textId),
    [state, textId]
  );

  if (!spReady || !ready) {
    return hostObs ? null : (
      <div className="fixed inset-0 flex items-center justify-center text-white/40 text-sm">
        …
      </div>
    );
  }

  return (
    <>
      <ObsTextOverlayView
        key={`${resolvedInstanceId}:${config.revision ?? 0}`}
        config={config}
      />
    </>
  );
}

export default function ObsTextOverlayPage() {
  return <ObsTextOverlayInner />;
}
