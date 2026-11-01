"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_OVERLAY_AMOUNT_UNIT,
  normalizeOverlayAmountUnit,
  readOverlayAmountUnitFromSettings,
} from "@/lib/donation/overlay-amount-unit";
import { shouldSuppressOverlaySseConnection } from "@/lib/overlay-params";
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";
import {
  createStateUpdatedScheduler,
  readOverlayLiveSyncPollMs,
} from "@/lib/overlay-pull-policy";
import { loadStateFromApi } from "@/lib/state";
import { STATE_PICK_OVERLAY } from "@/lib/state-api-pick";

/**
 * 서버 `overlaySettings.amountUnit`을 읽어 후원 알림 단위를 맞춘다.
 * - 초기값: URL `amountUnit`(있으면) → 첫 페인트
 * - 이후: GET pick=overlay + `state_updated` 시 갱신 (서버 값이 우선)
 * - SSE가 꺼진 OBS 등: 라이브 폴링 fallback
 *
 * 페이지에 이미 `useSSEConnection`이 있으면 `refreshAmountUnit`만 그 핸들러에서 호출한다
 * (EventSource 이중 연결 방지).
 */
export function useOverlayAmountUnit(
  userId: string | undefined,
  urlParam?: string | null
): { amountUnit: string; refreshAmountUnit: () => void } {
  const urlUnit = normalizeOverlayAmountUnit(urlParam, "");
  const [amountUnit, setAmountUnit] = useState(
    () => urlUnit || DEFAULT_OVERLAY_AMOUNT_UNIT
  );
  const lastUpdatedAtRef = useRef(0);
  const syncGenRef = useRef(0);

  const syncFromApi = useCallback(
    async (force = false) => {
      const uid = String(userId || "").trim();
      if (!uid) return;
      const gen = ++syncGenRef.current;
      const remote = await loadStateFromApi(uid, {
        pick: STATE_PICK_OVERLAY,
        ...(force || !lastUpdatedAtRef.current
          ? { forceFull: true }
          : { ifUpdatedSince: lastUpdatedAtRef.current }),
      });
      if (gen !== syncGenRef.current) return;
      if (!remote) return;
      const at = Number(remote.updatedAt) || 0;
      if (at > 0) lastUpdatedAtRef.current = at;
      const fromSettings = readOverlayAmountUnitFromSettings(remote.overlaySettings, "");
      if (fromSettings) setAmountUnit(fromSettings);
    },
    [userId]
  );

  useEffect(() => {
    void syncFromApi(true);
  }, [syncFromApi]);

  const scheduler = useMemo(
    () => createStateUpdatedScheduler(() => {
      void syncFromApi(false);
    }),
    [syncFromApi]
  );
  useEffect(() => () => scheduler.cancel(), [scheduler]);

  const refreshAmountUnit = useCallback(() => {
    scheduler.schedule();
  }, [scheduler]);

  useEffect(() => {
    if (!shouldSuppressOverlaySseConnection()) return;
    const uid = String(userId || "").trim();
    if (!uid) return;
    return startStaggeredOverlayPoll(
      () => {
        void syncFromApi(false);
      },
      readOverlayLiveSyncPollMs(),
      `overlay-amount-unit:${uid}`
    );
  }, [syncFromApi, userId]);

  return { amountUnit, refreshAmountUnit };
}
