"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ObsTextOverlayView } from "@/components/obs-text/ObsTextOverlayView";
import {
  OBS_TEXT_ID_QUERY,
  readObsTextOverlayFromState,
} from "@/lib/obs-text-overlay";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { STATE_PICK_OBS_TEXT } from "@/lib/state-api-pick";

function ObsTextOverlayInner() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const textId = sp.get(OBS_TEXT_ID_QUERY);
  const { state, ready } = useOverlayRemoteState(userId, {
    statePick: STATE_PICK_OBS_TEXT,
  });

  const config = useMemo(
    () => readObsTextOverlayFromState(state, textId),
    [state, textId]
  );

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-white/40 text-sm">
        …
      </div>
    );
  }

  return <ObsTextOverlayView config={config} />;
}

export default function ObsTextOverlayPage() {
  return (
    <Suspense fallback={null}>
      <ObsTextOverlayInner />
    </Suspense>
  );
}
