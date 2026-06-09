"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PlayerDonationQueueSideStack from "@/components/donation/PlayerDonationQueueSideStack";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import type { PlayerDonationAlertPayload } from "@/lib/donation/player-donation-alert";
import {
  fetchPlayerDonationQueue,
  mapPlayerAlertQueueItems,
  mergePlayerAlertDisplayItems,
  PLAYER_ALERT_MIN_LIVE_MS,
  ssePayloadToQueueItem,
  type LiveIncomingEntry,
  type PlayerDonationQueueItem,
} from "@/lib/donation/player-alert-queue";
import { PLAYER_ALERT_PREVIEW_STACK } from "@/lib/donation/player-alert-preview";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { useSSEConnection } from "@/lib/sse-client";

const HIGHLIGHT_MS = 5000;
const LIVE_PRUNE_MS = 10_000;

export default function PlayerAlertWebPopupPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const previewMode = sp.get("preview") === "1" || sp.get("preview") === "true";
  const [queueItems, setQueueItems] = useState<PlayerDonationQueueItem[]>([]);
  const [liveIncoming, setLiveIncoming] = useState<Map<string, LiveIncomingEntry>>(() => new Map());
  const [liveTick, setLiveTick] = useState(0);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState(false);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(() => new Set());
  const highlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fetchQueueRef = useRef<(() => Promise<void>) | null>(null);

  const rememberLiveIncoming = useCallback((item: PlayerDonationQueueItem) => {
    const seenAt = Date.now();
    setLiveIncoming((prev) => {
      const next = new Map(prev);
      next.set(item.id, { item, seenAt });
      return next;
    });
  }, []);

  const flashHighlight = useCallback((ids: string[]) => {
    const next = ids.filter(Boolean);
    if (next.length === 0) return;
    setHighlightedIds((prev) => {
      const merged = new Set(prev);
      for (const id of next) merged.add(id);
      return merged;
    });
    for (const id of next) {
      const existing = highlightTimersRef.current.get(id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        setHighlightedIds((prev) => {
          const copy = new Set(prev);
          copy.delete(id);
          return copy;
        });
        highlightTimersRef.current.delete(id);
      }, HIGHLIGHT_MS);
      highlightTimersRef.current.set(id, timer);
    }
  }, []);

  const loadQueue = useCallback(async () => {
    if (previewMode) return;
    setQueueLoading(true);
    setQueueError(false);
    try {
      const raw = await fetchPlayerDonationQueue(userId);
      setQueueItems(mapPlayerAlertQueueItems(raw));
    } catch {
      setQueueError(true);
    } finally {
      setQueueLoading(false);
    }
  }, [previewMode, userId]);

  fetchQueueRef.current = loadQueue;

  useEffect(() => {
    if (previewMode) return;
    void loadQueue();
  }, [loadQueue, previewMode]);

  useEffect(() => {
    if (previewMode) return;
    const interval = window.setInterval(() => setLiveTick((t) => t + 1), LIVE_PRUNE_MS);
    return () => window.clearInterval(interval);
  }, [previewMode]);

  useEffect(() => {
    const timers = highlightTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  const onSseMessage = useCallback(
    (data: unknown) => {
      if (previewMode) return;
      const o = data as { type?: string; userId?: string };
      if (o?.type === "donation_queue_updated") {
        void fetchQueueRef.current?.();
        return;
      }
      if (o?.type !== "player_donation_alert") return;
      const alert = o as Partial<PlayerDonationAlertPayload>;
      if (userId && alert.userId && alert.userId !== userId) return;

      const liveItem = ssePayloadToQueueItem(alert);
      if (liveItem) {
        rememberLiveIncoming(liveItem);
        flashHighlight([liveItem.id]);
      }
      void fetchQueueRef.current?.();
    },
    [flashHighlight, previewMode, rememberLiveIncoming, userId]
  );

  const { connected } = useSSEConnection(onSseMessage);

  const visibleStack = useMemo(() => {
    if (previewMode) return PLAYER_ALERT_PREVIEW_STACK;
    void liveTick;
    return mergePlayerAlertDisplayItems(queueItems, liveIncoming, PLAYER_ALERT_MIN_LIVE_MS);
  }, [liveIncoming, liveTick, previewMode, queueItems]);

  if (!spReady) {
    return <main className="min-h-screen bg-slate-900" />;
  }

  return (
    <main className="relative min-h-screen bg-gradient-to-br from-slate-900 via-slate-950 to-black text-white">
      <div className="pointer-events-none fixed left-3 top-3 z-40 max-w-[15rem] rounded-lg border border-white/10 bg-black/50 px-2.5 py-2 text-[11px] text-slate-400 backdrop-blur-sm">
        <p className="font-semibold text-slate-200">시그 후원 알림</p>
        <p className="mt-0.5">
          {previewMode ? (
            <span className="text-sky-300">미리보기 · {visibleStack.length}건</span>
          ) : (
            <>표시 {visibleStack.length}건</>
          )}
        </p>
        {!previewMode ? (
          <p className={connected ? "text-emerald-400" : "text-amber-400"}>
            {connected ? "실시간 연결됨" : "연결 중…"}
            {queueLoading ? " · 갱신 중" : ""}
          </p>
        ) : null}
        {!previewMode && queueError ? (
          <p className="mt-1 text-red-400">대기 목록을 불러오지 못했습니다.</p>
        ) : null}
        {!previewMode && !queueLoading && visibleStack.length === 0 ? (
          <p className="mt-1 text-slate-500">후원 대기 중…</p>
        ) : null}
      </div>

      <PlayerDonationQueueSideStack
        items={visibleStack}
        userId={userId}
        highlightedIds={highlightedIds}
      />
    </main>
  );
}
