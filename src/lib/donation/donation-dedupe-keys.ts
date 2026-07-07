import { isWeakToonationDonorId, normalizeDonationEventId } from "./apply-donation-state";
import { isReliableToonationExternalId } from "./toonation/parse-event";
import type { DonationEvent } from "./types";

/** Redis·인메모리 중복 반영 방지용 키 */
export function donationApplyPrimaryKey(userId: string, event: DonationEvent): string {
  const ext = String(event.externalId || "").trim();
  const extDonorId = ext && event.provider ? `${event.provider}:${ext}` : "";
  if (
    event.provider === "toonation" &&
    isReliableToonationExternalId(ext) &&
    !isWeakToonationDonorId(extDonorId)
  ) {
    return `${userId}:toonation:ext:${ext.toLowerCase()}`;
  }
  const eventId = normalizeDonationEventId(String(event.id || "").trim());
  if (eventId) return `${userId}:evt:${eventId.toLowerCase()}`;
  const name = String(event.donorName || "").trim().toLowerCase();
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  const target = event.target === "account" ? "account" : "toon";
  const msg = String(event.message || "").trim();
  return `${userId}:fp:${name}|${amount}|${target}|${msg}|${ext}`;
}
