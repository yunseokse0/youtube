"use client";

import { useMemo } from "react";
import {
  AnimatedDonationAlertOverlay,
  useDonationAlertQueue,
} from "@donation-alert-overlay/react";
import {
  DONATION_ALERT_TEST_ITEM,
  donationAlertFromAppliedHint,
} from "@donation-alert-overlay/core";
import { useClientOnlySearchParams } from "@/hooks/useClientOnlySearchParams";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { createYoutubeBroadcastDonationAlertSource } from "@/lib/donation-alert/youtube-broadcast-source";
import { useSSEConnection } from "@/lib/sse-client";

export default function DonationAlertOverlayPage() {
  const { params: sp, ready: spReady } = useClientOnlySearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const testMode = (sp.get("test") || "").toLowerCase() === "true";

  const source = useMemo(() => {
    if (testMode || !userId) return null;
    return createYoutubeBroadcastDonationAlertSource({ userId });
  }, [testMode, userId]);

  const { current, enqueueAlert } = useDonationAlertQueue({
    enabled: spReady,
    testItem: testMode ? DONATION_ALERT_TEST_ITEM : null,
    source,
  });

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
    enqueueAlert(
      donationAlertFromAppliedHint(
        o.donationApplied,
        `sse_${o.updatedAt || Date.now()}_${o.donationApplied.amount || 0}_${o.donationApplied.donorName || ""}`
      )
    );
  });

  if (!spReady) return null;

  return <AnimatedDonationAlertOverlay current={current} />;
}
