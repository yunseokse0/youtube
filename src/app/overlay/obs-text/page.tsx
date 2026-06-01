"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ObsTextOverlayView } from "@/components/obs-text/ObsTextOverlayView";
import {
  OBS_TEXT_ID_QUERY,
  readObsTextOverlayFromState,
  readObsTextRegistryFromState,
  resolveObsTextInstanceId,
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
    skipLocalSnapshot: true,
    forceInitialFull: true,
  });

  const resolvedInstanceId = useMemo(
    () => resolveObsTextInstanceId(readObsTextRegistryFromState(state), textId),
    [state, textId]
  );

  const config = useMemo(
    () => readObsTextOverlayFromState(state, textId),
    [state, textId]
  );

  const textIdMiss =
    Boolean(textId?.trim()) &&
    ready &&
    !readObsTextRegistryFromState(state).instances.some((i) => i.id === textId?.trim());

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center text-white/40 text-sm">
        …
      </div>
    );
  }

  return (
    <>
      {textIdMiss ? (
        <div className="fixed left-2 top-2 z-50 rounded bg-amber-900/90 px-2 py-1 text-[10px] text-amber-100">
          textId 없음 → 첫 번째 오버레이 표시 중. 관리자에서 「OBS에 저장」 후 URL을 확인하세요.
        </div>
      ) : null}
      <ObsTextOverlayView
        key={`${resolvedInstanceId}-${config.revision ?? 0}`}
        config={config}
      />
    </>
  );
}

export default function ObsTextOverlayPage() {
  return (
    <Suspense fallback={null}>
      <ObsTextOverlayInner />
    </Suspense>
  );
}
