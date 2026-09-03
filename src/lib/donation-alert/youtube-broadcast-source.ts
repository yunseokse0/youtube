/**
 * youtube(본 프로젝트) 방송 상태 API 폴링 → DonationAlertSource.
 * SSE는 페이지에서 enqueueAlert로 연결 (useSSEConnection).
 */
import {
  donationAlertsFromUnseenDonors,
  DONATION_ALERT_POLL_MS,
  seedSeenDonorIds,
} from "@donation-alert-overlay/core";
import type { DonationAlertSource } from "@donation-alert-overlay/source";
import type { DonationRecordRef } from "@donation-alert-overlay";
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";
import { STATE_PICK_OVERLAY_DONORS } from "@/lib/state-api-pick";
import { loadStateFromApi, normalizeDonorsArray } from "@/lib/state";

export type YoutubeBroadcastDonationAlertSourceOptions = {
  userId: string;
  pollMs?: number;
};

export function createYoutubeBroadcastDonationAlertSource(
  opts: YoutubeBroadcastDonationAlertSourceOptions
): DonationAlertSource {
  const userId = String(opts.userId || "").trim();
  const pollMs = opts.pollMs ?? DONATION_ALERT_POLL_MS;
  const seenIds = new Set<string>();
  let bootstrapped = false;
  let lastSyncedUpdatedAt = 0;

  return {
    subscribe(onAlert) {
      if (!userId) return () => {};

      const poll = async (opts?: { forceFull?: boolean }) => {
        const forceFull = Boolean(opts?.forceFull) || lastSyncedUpdatedAt <= 0;
        const remote = await loadStateFromApi(userId, {
          pick: STATE_PICK_OVERLAY_DONORS,
          ifUpdatedSince: forceFull ? 0 : lastSyncedUpdatedAt,
          forceFull,
        });
        /** 304 — 신규 후원 없음 */
        if (!remote) return;
        const rev = Math.max(
          Number(remote.updatedAt || 0),
          Number(remote.donorRankingsUpdatedAt || 0)
        );
        if (rev > 0) lastSyncedUpdatedAt = Math.max(lastSyncedUpdatedAt, rev);
        const donors = normalizeDonorsArray(remote.donors) as DonationRecordRef[];
        const members = remote.members || [];
        if (!bootstrapped) {
          bootstrapped = true;
          seedSeenDonorIds(donors, seenIds);
          return;
        }
        const fresh = donationAlertsFromUnseenDonors(donors, members, seenIds);
        for (const item of fresh) onAlert(item);
      };

      void poll({ forceFull: true });
      const stopPoll = startStaggeredOverlayPoll(
        () => void poll(),
        pollMs,
        `donation-alert:${userId}`,
        600
      );

      return () => stopPoll();
    },
  };
}
