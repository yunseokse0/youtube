import { isWeakToonationDonorId, normalizeDonationEventId } from "./apply-donation-state";
import { isReliableToonationExternalId } from "./toonation/parse-event";
import type { DonationEvent } from "./types";

/** 이중 경로(서버 WS+브라우저 릴레이) 단기 차단 창 — 이후 동일 금액 연속 후원은 허용 */
export const DONATION_CONTENT_DEDUPE_TTL_SEC = 3;

/** 후원자·금액·대상·메시지 기준 내용 키 (건별 unique id 와 무관) */
export function donationContentDedupeFingerprint(event: {
  donorName?: string;
  name?: string;
  amount?: number;
  target?: string;
  message?: string;
}): string {
  const name = String(event.donorName ?? event.name ?? "")
    .trim()
    .toLowerCase();
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  const target = event.target === "toon" ? "toon" : "account";
  const msg = String(event.message || "")
    .trim()
    .toLowerCase();
  return `${name}|${amount}|${target}|${msg}`;
}

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

/**
 * weak/unique fallback id 경로용 — 동일 내용 단기 선점 키.
 * 서버 WS·브라우저 릴레이가 서로 다른 fp- id 로 들어와도 한 번만 반영.
 */
export function donationApplyContentKey(userId: string, event: DonationEvent): string | null {
  const ext = String(event.externalId || "").trim();
  const extDonorId = ext && event.provider ? `${event.provider}:${ext}` : "";
  if (
    event.provider === "toonation" &&
    isReliableToonationExternalId(ext) &&
    !isWeakToonationDonorId(extDonorId)
  ) {
    /** reliable 실 id 는 primary 키로 이미 막힘 */
    return null;
  }
  const name = String(event.donorName || "").trim();
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  if (!name && amount <= 0) return null;
  return `${userId}:content:${donationContentDedupeFingerprint(event)}`;
}
