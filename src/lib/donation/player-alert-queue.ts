import type { PlayerDonationAlertData } from "@/components/donation/PlayerDonationAlertCard";
import { playerFilterMatches } from "@/lib/donation/player-alert-url";
import type { PlayerDonationAlertPayload } from "@/lib/donation/player-donation-alert";
import type { DonationEvent } from "@/lib/donation/types";

export type LiveIncomingEntry = {
  item: PlayerDonationQueueItem;
  seenAt: number;
};

/** 큐에서 빠져도 최소 이 시간(ms) 동안 팝업에 유지 */
export const PLAYER_ALERT_MIN_LIVE_MS = 60_000;

export type PlayerDonationQueueItem = PlayerDonationAlertData & {
  id: string;
  at: string;
};

export function donationEventToQueueItem(event: DonationEvent): PlayerDonationQueueItem {
  return {
    id: event.id,
    at: event.at,
    donorName: event.donorName,
    playerName: event.playerName?.trim() || undefined,
    amount: event.amount,
    message: String(event.message || "").trim(),
    matchedSigName: event.matchedSigName?.trim() || undefined,
    matchedSigImageUrl: event.matchedSigImageUrl?.trim() || undefined,
    isAutoMatched: event.isAutoMatched,
  };
}

export function filterDonationQueueByPlayer(
  items: DonationEvent[],
  playerFilterRaw: string
): PlayerDonationQueueItem[] {
  const filter = String(playerFilterRaw || "").trim();
  return items
    .filter((evt) => {
      if (!filter) return true;
      return playerFilterMatches(filter, evt.playerName);
    })
    .map(donationEventToQueueItem);
}

/** 플레이어 팝업 — 투네·계좌 포함 큐 전체 (투네이션 WS·메시지 파싱 기준) */
export function mapPlayerAlertQueueItems(items: DonationEvent[]): PlayerDonationQueueItem[] {
  return items.map(donationEventToQueueItem);
}

/** @deprecated mapPlayerAlertQueueItems 사용 */
export const mapToonationQueueItems = mapPlayerAlertQueueItems;

export function ssePayloadToQueueItem(alert: Partial<PlayerDonationAlertPayload>): PlayerDonationQueueItem | null {
  const id = String(alert.eventId || "").trim();
  if (!id) return null;
  return {
    id,
    at: String(alert.at || new Date().toISOString()),
    donorName: String(alert.donorName || "").trim() || "후원자",
    playerName: alert.playerName ? String(alert.playerName).trim() : undefined,
    amount: Math.max(0, Math.round(Number(alert.amount || 0))),
    message: String(alert.message || "").trim(),
    matchedSigName: alert.matchedSigName ? String(alert.matchedSigName).trim() : undefined,
    matchedSigImageUrl: alert.matchedSigImageUrl ? String(alert.matchedSigImageUrl).trim() : undefined,
    isAutoMatched: alert.isAutoMatched,
  };
}

/** 실시간 수신 + 큐 목록 병합 (들어온 직후·오버레이 반영 후에도 잠시 표시) */
export function mergePlayerAlertDisplayItems(
  queueItems: PlayerDonationQueueItem[],
  liveIncoming: ReadonlyMap<string, LiveIncomingEntry>,
  minLiveMs: number = PLAYER_ALERT_MIN_LIVE_MS,
  now: number = Date.now()
): PlayerDonationQueueItem[] {
  const byId = new Map<string, PlayerDonationQueueItem>();
  const queueIds = new Set(queueItems.map((item) => item.id));

  for (const [id, entry] of liveIncoming) {
    if (queueIds.has(id) || now - entry.seenAt < minLiveMs) {
      byId.set(id, entry.item);
    }
  }
  for (const item of queueItems) {
    byId.set(item.id, item);
  }

  return Array.from(byId.values()).sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
}

export async function fetchPlayerDonationQueue(userId: string): Promise<DonationEvent[]> {
  const uid = String(userId || "").trim();
  if (!uid) return [];
  try {
    const res = await fetch(`/api/donations/queue?u=${encodeURIComponent(uid)}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json().catch(() => null)) as { items?: DonationEvent[] } | null;
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}
