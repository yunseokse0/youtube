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
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { useOverlayRemoteState } from "@/hooks/useOverlayRemoteState";
import { readObsTextOverlayPollMs } from "@/lib/overlay-pull-policy";
import { STATE_PICK_OBS_TEXT } from "@/lib/state-api-pick";

function ObsTextOverlayInner() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const textId = sp.get(OBS_TEXT_ID_QUERY);
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
    spReady &&
    ready &&
    !readObsTextRegistryFromState(state).instances.some((i) => i.id === textId?.trim());

  const hasVisibleText =
    spReady &&
    ready &&
    config.blocks.some(
      (b) =>
        b.visible !== false &&
        b.segments.some((s) => String(s.text ?? "").trim().length > 0)
    );

  if (!spReady || !ready) {
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
      {ready && !hasVisibleText ? (
        <div className="fixed left-2 top-2 z-50 max-w-[min(92vw,420px)] rounded bg-rose-950/90 px-2 py-1.5 text-[10px] leading-snug text-rose-100">
          표시할 문구가 없습니다. 관리자 → 텍스트 오버레이에서 내용 입력 후 「OBS에 저장」하세요. OBS 브라우저 소스에서
          「현재 페이지 캐시 새로고침」도 해보세요.
        </div>
      ) : null}
      <ObsTextOverlayView key={resolvedInstanceId} config={config} />
    </>
  );
}

export default function ObsTextOverlayPage() {
  return <ObsTextOverlayInner />;
}
