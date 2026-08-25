"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import BroadcastDonationAlertCard from "@/components/donation/BroadcastDonationAlertCard";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import {
  DONATION_ALERT_DISPLAY_MS,
  DONATION_ALERT_POLL_MS,
  DONATION_ALERT_TEST_ITEM,
  donationAlertFromAppliedHint,
  donationAlertFromLatestDonor,
  type DonationAlertShowItem,
} from "@/lib/donation/donation-alert-overlay";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";
import { STATE_PICK_OVERLAY_DONORS } from "@/lib/state-api-pick";
import { loadStateFromApi, normalizeDonorsArray } from "@/lib/state";
import { useSSEConnection } from "@/lib/sse-client";

export default function DonationAlertOverlayPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const testMode = (sp.get("test") || "").toLowerCase() === "true";
  const [current, setCurrent] = useState<DonationAlertShowItem | null>(
    testMode ? DONATION_ALERT_TEST_ITEM : null
  );
  const queueRef = useRef<DonationAlertShowItem[]>([]);
  const showingRef = useRef(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const bootstrappedRef = useRef(false);

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
    }, DONATION_ALERT_DISPLAY_MS);
  }, []);

  const enqueueAlert = useCallback(
    (item: DonationAlertShowItem | null) => {
      if (!item || testMode) return;
      if (seenIdsRef.current.has(item.id)) return;
      seenIdsRef.current.add(item.id);
      if (seenIdsRef.current.size > 200) {
        const keep = Array.from(seenIdsRef.current).slice(-120);
        seenIdsRef.current = new Set(keep);
      }
      queueRef.current.push(item);
      drainQueue();
    },
    [drainQueue, testMode]
  );

  const pollLatestDonor = useCallback(async () => {
    if (testMode || !String(userId || "").trim()) return;
    const remote = await loadStateFromApi(userId, {
      pick: STATE_PICK_OVERLAY_DONORS,
      forceFull: true,
    });
    if (!remote) return;
    const donors = normalizeDonorsArray(remote.donors) as Array<Record<string, unknown>>;
    const alert = donationAlertFromLatestDonor(donors, remote.members || []);
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      if (alert) seenIdsRef.current.add(alert.id);
      /** 기존 후원은 시드로만 표시하지 않음 — 이후 신규만 알림 */
      for (const d of donors.slice(-40)) {
        const id = String(d.id || "").trim();
        if (id) seenIdsRef.current.add(id);
      }
      return;
    }
    enqueueAlert(alert);
  }, [enqueueAlert, testMode, userId]);

  useSSEConnection((data: unknown) => {
    if (testMode) return;
    const o = data as {
      type?: string;
      donationApplied?: {
        donorName?: string;
        amount?: number;
        target?: string;
        memberName?: string;
      };
      updatedAt?: number;
    };
    if (o?.type !== "state_updated" || !o.donationApplied) return;
    const item = donationAlertFromAppliedHint(
      o.donationApplied,
      `sse_${o.updatedAt || Date.now()}_${o.donationApplied.amount || 0}_${o.donationApplied.donorName || ""}`
    );
    enqueueAlert(item);
  });

  useEffect(() => {
    if (!spReady || testMode) return;
    void pollLatestDonor();
    const stop = startStaggeredOverlayPoll(
      () => void pollLatestDonor(),
      DONATION_ALERT_POLL_MS,
      `donation-alert:${userId || "default"}`,
      600
    );
    return () => {
      stop();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [pollLatestDonor, spReady, testMode, userId]);

  if (!spReady) return null;

  return (
    <main className="min-h-[100dvh] w-full bg-transparent p-3 text-white" data-overlay="donation-alert">
      <div className="flex min-h-[min(100dvh,28rem)] w-full items-center justify-center">
        <AnimatePresence mode="wait">
          {current ? (
            <motion.div
              key={current.id}
              initial={{ opacity: 0, y: 18, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ duration: 0.28, ease: "easeOut" }}
            >
              <BroadcastDonationAlertCard alert={current} />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </main>
  );
}
