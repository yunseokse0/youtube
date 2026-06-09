import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { readManualSigBroadcastFromState } from "@/lib/manual-sig-broadcast-state";
import { matchSigByAmountAndMessage } from "@/lib/donation/toonation/parse-event";
import type { DonationEvent, QueueSigItem } from "@/lib/donation/types";

export type PlayerDonationAlertPayload = {
  type: "player_donation_alert";
  userId: string;
  eventId: string;
  donorName: string;
  playerName?: string;
  amount: number;
  message: string;
  matchedSigName?: string;
  matchedSigImageUrl?: string;
  isAutoMatched?: boolean;
  at: string;
};

function mapInventoryRowToQueueSig(x: {
  id?: string;
  name?: string;
  price?: number;
  isActive?: boolean;
  soldCount?: number;
  maxCount?: number;
  imageUrl?: string;
}): QueueSigItem | null {
  const id = String(x.id || "").trim();
  const name = String(x.name || "").trim();
  if (!id || !name) return null;
  const imageUrl = String(x.imageUrl || "").trim();
  return {
    id,
    name,
    price: Math.max(0, Math.round(Number(x.price || 0))),
    isActive: Boolean(x.isActive),
    soldCount: Number.isFinite(Number(x.soldCount)) ? Math.max(0, Math.floor(Number(x.soldCount))) : undefined,
    maxCount: Number.isFinite(Number(x.maxCount)) ? Math.max(0, Math.floor(Number(x.maxCount))) : undefined,
    ...(imageUrl ? { imageUrl } : {}),
  };
}

async function sigListSnapshotFromState(userId: string): Promise<QueueSigItem[]> {
  const state = await loadAppStateForUserId(userId);
  const inv = Array.isArray(state.sigInventory) ? state.sigInventory : [];
  return inv
    .map((x) => mapInventoryRowToQueueSig(x))
    .filter((s): s is QueueSigItem => Boolean(s));
}

function resolveMatchedSigImageUrl(
  matchedSigName: string | undefined,
  sigList: QueueSigItem[],
  broadcastSelected: Array<{ name?: string; imageUrl?: string }>
): string | undefined {
  const name = String(matchedSigName || "").trim();
  if (!name) return undefined;
  const fromSnap = sigList.find((s) => s.name === name);
  if (fromSnap?.imageUrl) return fromSnap.imageUrl;
  const fromRound = broadcastSelected.find((s) => String(s.name || "").trim() === name);
  const roundUrl = String(fromRound?.imageUrl || "").trim();
  return roundUrl || undefined;
}

/** 금액·메시지 매칭 + 수동 리롤판 백업 → DonationEvent 확장 */
export async function enrichDonationEventWithSigMatch(
  userId: string,
  event: DonationEvent,
  snapshot?: QueueSigItem[]
): Promise<DonationEvent> {
  const sigList = snapshot?.length ? snapshot : await sigListSnapshotFromState(userId);
  const message = String(event.message || "");
  const { sigName, isAutoMatched } = matchSigByAmountAndMessage(event.amount, message, sigList);

  let matchedSigName = sigName;
  let finalAutoMatched = isAutoMatched;

  const state = await loadAppStateForUserId(userId);
  const selected = readManualSigBroadcastFromState(state)?.selectedSigs || [];

  if (!finalAutoMatched) {
    const roundSig = selected.find((s) => Math.round(Number(s.price || 0)) === event.amount);
    if (roundSig?.name) {
      matchedSigName = String(roundSig.name).trim();
    }
  }

  const matchedSigImageUrl = resolveMatchedSigImageUrl(matchedSigName, sigList, selected);

  return {
    ...event,
    ...(matchedSigName ? { matchedSigName } : {}),
    ...(matchedSigImageUrl ? { matchedSigImageUrl } : {}),
    isAutoMatched: finalAutoMatched,
    sigListSnapshot: event.sigListSnapshot ?? sigList,
  };
}

export async function broadcastPlayerDonationAlert(
  userId: string,
  event: DonationEvent
): Promise<void> {
  const origin = process.env.INTERNAL_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const payload: PlayerDonationAlertPayload = {
    type: "player_donation_alert",
    userId,
    eventId: event.id,
    donorName: event.donorName,
    playerName: event.playerName,
    amount: event.amount,
    message: String(event.message || ""),
    matchedSigName: event.matchedSigName,
    matchedSigImageUrl: event.matchedSigImageUrl,
    isAutoMatched: event.isAutoMatched,
    at: event.at,
  };
  await fetch(`${origin}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}
