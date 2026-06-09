import { readDonationQueue, writeDonationQueue } from "@/app/api/donations/_shared/queue-store";
import {
  broadcastPlayerDonationAlert,
  enrichDonationEventWithSigMatch,
} from "@/lib/donation/player-donation-alert";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import type { DonationEvent, QueueSigItem } from "../types";

function sigListSnapshotFromState(userId: string): Promise<QueueSigItem[]> {
  return loadAppStateForUserId(userId).then((state) => {
    const inv = Array.isArray(state.sigInventory) ? state.sigInventory : [];
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
  const origin = process.env.INTERNAL_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
  await fetch(`${origin}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "donation_queue_updated", at: Date.now() }),
  }).catch(() => {});
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
  const list = await readDonationQueue(userId);
  const externalKey =
    enriched.provider && enriched.externalId
      ? `${enriched.provider}:${String(enriched.externalId).trim()}`
      : "";
  const isDup = list.some((x) => {
    if (x.id === enriched.id) return true;
    if (!externalKey) return false;
    return `${x.provider}:${String(x.externalId || "").trim()}` === externalKey;
  });
  if (isDup) {
    return false;
  }
  const withoutDup = list.filter(
    (x) =>
      x.id !== enriched.id &&
      (!externalKey || `${x.provider}:${String(x.externalId || "").trim()}` !== externalKey)
  );
  await writeDonationQueue(userId, [enriched, ...withoutDup]);
  if (opts?.notify !== false) {
    await broadcastPlayerDonationAlert(userId, enriched);
    await broadcastDonationQueueUpdated();
  }
  return true;
}
