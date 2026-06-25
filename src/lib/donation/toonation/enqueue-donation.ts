import { readDonationQueue, writeDonationQueue } from "@/app/api/donations/_shared/queue-store";
import {
  broadcastPlayerDonationAlert,
  enrichDonationEventWithSigMatch,
} from "@/lib/donation/player-donation-alert";
import { isDuplicateDonationEvent, normalizeDonationEventId } from "@/lib/donation/apply-donation-state";
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
  const state = await loadAppStateForUserId(userId);
  if (isDuplicateDonationEvent(state, enriched)) return false;

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

/** 서버 자동 반영 후 큐에 남은 동일 id 건 제거(클라이언트 2차 반영 방지) */
export async function purgeDonationQueueForEvent(userId: string, event: DonationEvent): Promise<void> {
  const eventId = String(event.id || "").trim();
  const baseId = normalizeDonationEventId(eventId);
  const externalKey =
    event.provider && event.externalId
      ? `${event.provider}:${String(event.externalId).trim()}`
      : "";
  const keys = new Set<string>();
  if (eventId) keys.add(eventId);
  if (baseId) keys.add(baseId);
  if (externalKey) keys.add(externalKey);
  if (baseId) keys.add(`toonation:${baseId.replace(/^toonation:/i, "")}`);
  const list = await readDonationQueue(userId);
  const next = list.filter((evt) => {
    const evtId = String(evt.id || "").trim();
    const evtBase = normalizeDonationEventId(evtId);
    if (keys.has(evtId) || keys.has(evtBase)) return false;
    const evtExt =
      evt.provider && evt.externalId ? `${evt.provider}:${String(evt.externalId).trim()}` : "";
    if (evtExt && keys.has(evtExt)) return false;
    return true;
  });
  if (next.length !== list.length) await writeDonationQueue(userId, next);
}
