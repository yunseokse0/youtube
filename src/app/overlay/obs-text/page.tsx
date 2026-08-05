"use client";

import { useEffect, useMemo, useRef } from "react";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import { ObsTextOverlayView } from "@/components/obs-text/ObsTextOverlayView";
import {
  OBS_TEXT_ID_QUERY,
  hasObsTextRegistryInState,
  obsTextConfigSyncSignature,
  readObsTextOverlayFromState,
  readObsTextRegistryFromState,
  resolveObsTextInstanceId,
  type ObsTextOverlayConfig,
} from "@/lib/obs-text-overlay";
import {
  getOverlayUserIdFromSearchParams,
  isOverlayBroadcastHost,
} from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { readObsTextOverlayPollMs } from "@/lib/overlay-pull-policy";
import { STATE_PICK_OBS_TEXT } from "@/lib/state-api-pick";

function ObsTextOverlayInner({
  userId,
  textId,
  hostObs,
}: {
  userId: string;
  textId: string | null;
  hostObs: boolean;
}) {
  const { state, resync } = useOverlayRemoteState(userId, {
    statePick: STATE_PICK_OBS_TEXT,
    skipLocalSnapshot: true,
    forceInitialFull: true,
    overlayPollMs: readObsTextOverlayPollMs(),
  });

  /** 한 번이라도 그린 설정은 폴링 공백·빈 응답에도 유지(OBS 깜빡임 방지) */
  const lastConfigRef = useRef<ObsTextOverlayConfig | null>(null);
  const lastConfigSigRef = useRef("");
  const lastInstanceIdRef = useRef("default");

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

  const liveConfig = useMemo(() => {
    if (!state || !hasObsTextRegistryInState(state)) return null;
    return readObsTextOverlayFromState(state, textId);
  }, [state, textId]);

  const liveInstanceId = useMemo(
    () => resolveObsTextInstanceId(readObsTextRegistryFromState(state), textId),
    [state, textId]
  );

  if (liveConfig) {
    const sig = obsTextConfigSyncSignature(liveConfig);
    if (sig !== lastConfigSigRef.current) {
      lastConfigRef.current = liveConfig;
      lastConfigSigRef.current = sig;
      lastInstanceIdRef.current = liveInstanceId;
    }
  }

  const config = lastConfigRef.current;
  const resolvedInstanceId = lastInstanceIdRef.current;

  if (!config) {
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
  const textId = sp.get(OBS_TEXT_ID_QUERY);
  const hostObs = isOverlayBroadcastHost(sp);
  if (!spReady) return null;
  return (
    <ObsTextOverlayInner
      key={userId}
      userId={userId}
      textId={textId}
      hostObs={hostObs}
    />
  );
}
