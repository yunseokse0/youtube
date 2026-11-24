import { readDonationQueue, writeDonationQueue } from "@/app/api/donations/_shared/queue-store";
import {
  broadcastPlayerDonationAlert,
  enrichDonationEventWithSigMatch,
} from "@/lib/donation/player-donation-alert";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import { isDuplicateDonationEvent } from "@/lib/donation/apply-donation-state";
import { sameDonationEventIdentity } from "@/domain/dedupe/donation-event-identity";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import type { DonationEvent, QueueSigItem } from "../types";

function sigListSnapshotFromState(userId: string): Promise<QueueSigItem[]> {
  return loadAppStateForUserId(userId).then((state) => {
    const inv = Array.isArray(state?.sigInventory) ? state.sigInventory : [];
    return inv
      .filter((x) => Boolean(x && x.id && x.name))
      .map((x) => {
        const imageUrl = String(x.imageUrl || "").trim();
        return {
          id: String(x.id),
          name: String(x.name),
          price: Math.max(0, Math.round(Number(x.price || 0))),
          isActive: Boolean(x.isActive),
          soldCount: Number.isFinite(Number(x.soldCount)) ? Math.max(0, Math.floor(Number(x.soldCount))) : undefined,
          maxCount: Number.isFinite(Number(x.maxCount)) ? Math.max(0, Math.floor(Number(x.maxCount))) : undefined,
          ...(imageUrl ? { imageUrl } : {}),
        };
      })
      .filter((s) => s.id);
  });
}

async function broadcastDonationQueueUpdated(): Promise<void> {
  await publishSseEvent({ type: "donation_queue_updated" as const, at: Date.now() });
}

export async function enqueueDonationEvent(
  userId: string,
  event: DonationEvent,
  opts?: { sigListSnapshot?: QueueSigItem[]; notify?: boolean }
): Promise<boolean> {
  const snapshot = opts?.sigListSnapshot ?? (await sigListSnapshotFromState(userId));
  const withMatch = await enrichDonationEventWithSigMatch(userId, event, snapshot);
  const enriched: DonationEvent = {
    ...withMatch,
    status: "queued",
    sigListSnapshot: withMatch.sigListSnapshot ?? snapshot,
  };
  const state = await loadAppStateForUserId(userId);
  if (state && isDuplicateDonationEvent(state, enriched)) return false;

  const list = await readDonationQueue(userId);
  if (list.some((x) => sameDonationEventIdentity(x, enriched))) return false;
  const withoutDup = list.filter((x) => !sameDonationEventIdentity(x, enriched));
  await writeDonationQueue(userId, [enriched, ...withoutDup]);
  if (opts?.notify !== false) {
    await broadcastPlayerDonationAlert(userId, enriched);
    await broadcastDonationQueueUpdated();
  }
  return true;
}

/** 서버 자동 반영 후 큐에 남은 동일 id 건 제거(클라이언트 2차 반영 방지) */
export async function purgeDonationQueueForEvent(userId: string, event: DonationEvent): Promise<void> {
  const list = await readDonationQueue(userId);
  const next = list.filter((evt) => !sameDonationEventIdentity(evt, event));
  if (next.length !== list.length) await writeDonationQueue(userId, next);
}
