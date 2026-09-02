import { isWeakToonationDonorId, normalizeDonationEventId } from "./apply-donation-state";
import {
  extractReliableToonationExtFromDonorId,
  isReliableToonationExternalId,
} from "./toonation/parse-event";
import type { DonationEvent } from "./types";

/** 이중 경로(서버 WS+브라우저·큐) 단기 차단 창 — 이후 동일 금액 연속 후원은 허용 */
export const DONATION_CONTENT_DEDUPE_TTL_SEC = 3;

/** 동일 메시지 WS 연사(구름하정 등) — bucket·3초 창 밖 ingest 차단 */
export const DONATION_IDENTICAL_MESSAGE_DEDUPE_TTL_SEC = 15;
export const DONATION_IDENTICAL_MESSAGE_NEAR_DUP_MS = 15_000;

/** toon-{realId}-{unique} · reliable ext — ingest 경로마다 at 이 어긋날 수 있음 */
export const SAME_TOONATION_EVENT_NEAR_DUP_MS = 15_000;

/**
 * toona(DIN) bank:sms ingest ↔ youtube 투네 WS 이중 반영 창.
 * 경로 지연이 수십 초~2분인 경우가 많아 3초 창으로는 막히지 않음.
 */
export const CROSS_SOURCE_NEAR_DUP_MS = 180_000;

/** 동일 bank:sms 재전송(푸시 연타) — id만 다른 동일 후원 */
export const BANK_RESEND_NEAR_DUP_MS = 60_000;

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

/** 동일 후원자·금액·대상·메시지(비어 있지 않음) — 연속 WS 연사 dedupe 창 */
export function hasIdenticalMessageDedupeFingerprint(event: {
  donorName?: string;
  name?: string;
  amount?: number;
  target?: string;
  message?: string;
}): boolean {
  return String(event.message || "").trim().length > 0;
}

export function donationContentClaimTtlSec(event: DonationEvent): number {
  return hasIdenticalMessageDedupeFingerprint(event)
    ? DONATION_IDENTICAL_MESSAGE_DEDUPE_TTL_SEC
    : DONATION_CONTENT_DEDUPE_TTL_SEC;
}

/** in-flight 직렬화 — 동일 내용 동시 apply 방지 */
export function donationApplyInFlightKey(userId: string, event: DonationEvent): string {
  if (event.provider === "toonation" && hasIdenticalMessageDedupeFingerprint(event)) {
    return `${userId}:inflight:${donationContentDedupeFingerprint(event)}`;
  }
  return donationApplyPrimaryKey(userId, event);
}

/** weak toon-{real}-{unique} · reliable externalId → 투네 실 id (동일 후원 이중 ingest 차단) */
export function resolveToonationPrimaryExt(event: DonationEvent): string | null {
  if (event.provider !== "toonation") return null;
  const ext = String(event.externalId || "").trim();
  const eventId = normalizeDonationEventId(String(event.id || "").trim());
  const extDonorId = ext ? `toonation:${ext}` : "";
  const fromExt = extractReliableToonationExtFromDonorId(extDonorId);
  if (fromExt) return fromExt;
  const fromEventId = extractReliableToonationExtFromDonorId(eventId);
  if (fromEventId) return fromEventId;
  if (
    ext &&
    isReliableToonationExternalId(ext) &&
    !isWeakToonationDonorId(extDonorId)
  ) {
    return ext.toLowerCase();
  }
  return null;
}

const NEAR_CONTENT_BUCKET_MS = 3_000;

/** Redis·인메모리 — weak id·이중 경로 동일 내용 선점 (투네 실 id 는 primary key) */
export function donationApplyContentKey(userId: string, event: DonationEvent): string | null {
  if (event.provider !== "toonation") return null;
  const fp = donationContentDedupeFingerprint(event);
  if (hasIdenticalMessageDedupeFingerprint(event)) {
    return `${userId}:content:${fp}`;
  }
  if (resolveToonationPrimaryExt(event)) return null;
  const ext = String(event.externalId || "").trim();
  if (isReliableToonationExternalId(ext) && !isWeakToonationDonorId(`toonation:${ext}`)) {
    return null;
  }
  const atMs = Date.parse(String(event.at || ""));
  const bucket = Number.isFinite(atMs)
    ? Math.floor(atMs / NEAR_CONTENT_BUCKET_MS)
    : Math.floor(Date.now() / NEAR_CONTENT_BUCKET_MS);
  return `${userId}:content:${donationContentDedupeFingerprint(event)}:${bucket}`;
}

/** Redis·인메모리 중복 반영 방지용 키 */
export function donationApplyPrimaryKey(userId: string, event: DonationEvent): string {
  const realExt = resolveToonationPrimaryExt(event);
  if (realExt) return `${userId}:toonation:ext:${realExt}`;
  const ext = String(event.externalId || "").trim();
  const eventId = normalizeDonationEventId(String(event.id || "").trim());
  if (eventId) return `${userId}:evt:${eventId.toLowerCase()}`;
  const name = String(event.donorName || "").trim().toLowerCase();
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  const target = event.target === "account" ? "account" : "toon";
  const msg = String(event.message || "").trim();
  return `${userId}:fp:${name}|${amount}|${target}|${msg}|${ext}`;
}
