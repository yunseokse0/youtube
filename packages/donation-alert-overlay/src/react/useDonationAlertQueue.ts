"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DONATION_ALERT_DISPLAY_MS } from "../core";
import type { DonationAlertSource } from "../source";
import type { DonationAlertShowItem } from "../types";

export type UseDonationAlertQueueOptions = {
  /** false면 큐·표시 중지 */
  enabled?: boolean;
  /** 테스트 모드 — 고정 카드만 표시, source 무시 */
  testItem?: DonationAlertShowItem | null;
  displayMs?: number;
  /** 실시간 알림 소스 (SSE·폴링·WebSocket 등) */
  source?: DonationAlertSource | null;
  maxSeenIds?: number;
};

export function useDonationAlertQueue(opts: UseDonationAlertQueueOptions = {}) {
  const {
    enabled = true,
    testItem = null,
    displayMs = DONATION_ALERT_DISPLAY_MS,
    source = null,
    maxSeenIds = 200,
  } = opts;

  const [current, setCurrent] = useState<DonationAlertShowItem | null>(null);
  const queueRef = useRef<DonationAlertShowItem[]>([]);
  const showingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const testMode = Boolean(testItem);

  useEffect(() => {
    if (!enabled || !testMode) return;
    setCurrent(testItem);
  }, [enabled, testItem, testMode]);

  const drainQueue = useCallback(() => {
    if (showingRef.current) return;
    const next = queueRef.current.shift();
    if (!next) return;
    showingRef.current = true;
    setCurrent(next);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => {
      hideTimerRef.current = null;
      setCurrent(null);
      showingRef.current = false;
      window.setTimeout(() => drainQueue(), 280);
    }, displayMs);
  }, [displayMs]);

  const enqueueAlert = useCallback(
    (item: DonationAlertShowItem | null) => {
      if (!enabled || !item || testMode) return;
      if (seenIdsRef.current.has(item.id)) return;
      seenIdsRef.current.add(item.id);
      if (seenIdsRef.current.size > maxSeenIds) {
        const keep = Array.from(seenIdsRef.current).slice(-Math.floor(maxSeenIds * 0.6));
        seenIdsRef.current = new Set(keep);
      }
      queueRef.current.push(item);
      drainQueue();
    },
    [drainQueue, enabled, maxSeenIds, testMode]
  );

  const bootstrapSeenIds = useCallback((ids: Iterable<string>) => {
    for (const id of ids) {
      const t = String(id || "").trim();
      if (t) seenIdsRef.current.add(t);
    }
  }, []);

  useEffect(() => {
    if (!enabled || testMode || !source) return;
    return source.subscribe(enqueueAlert);
  }, [enabled, enqueueAlert, source, testMode]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  return {
    current: testMode ? testItem : current,
    enqueueAlert,
    bootstrapSeenIds,
    seenIdsRef,
    testMode,
  };
}
