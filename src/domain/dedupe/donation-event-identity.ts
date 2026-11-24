import { extractReliableToonationExtFromDonorId } from "@/lib/donation/toonation/parse-event";
import {
  isWeakToonationDonorId,
  normalizeDonationEventId,
} from "@/domain/dedupe/donation-dedupe.rules";

export type DonationIdentityFields = {
  id?: string;
  provider?: string;
  externalId?: string;
};

export function hasSameDonationUid(idA?: string, idB?: string): boolean {
  const rawA = String(idA || "").trim();
  const rawB = String(idB || "").trim();
  if (!rawA || !rawB) return false;
  if (rawA === rawB) return true;

  const normA = normalizeDonationEventId(rawA).toLowerCase();
  const normB = normalizeDonationEventId(rawB).toLowerCase();
  if (normA && normA === normB) return true;

  const reliableA = extractReliableToonationExtFromDonorId(rawA);
  const reliableB = extractReliableToonationExtFromDonorId(rawB);
  return Boolean(reliableA && reliableB && reliableA.toLowerCase() === reliableB.toLowerCase());
}

export function hasDistinctStrongDonationUids(idA?: string, idB?: string): boolean {
  const rawA = String(idA || "").trim();
  const rawB = String(idB || "").trim();
  if (!rawA || !rawB) return false;
  if (isWeakToonationDonorId(rawA) || isWeakToonationDonorId(rawB)) return false;
  return !hasSameDonationUid(rawA, rawB);
}

export function sameDonationEventIdentity(
  a: DonationIdentityFields,
  b: DonationIdentityFields
): boolean {
  if (hasSameDonationUid(a.id, b.id)) return true;
  if (hasDistinctStrongDonationUids(a.id, b.id)) return false;

  const providerA = String(a.provider || "").trim().toLowerCase();
  const providerB = String(b.provider || "").trim().toLowerCase();
  const externalA = String(a.externalId || "").trim().toLowerCase();
  const externalB = String(b.externalId || "").trim().toLowerCase();
  return Boolean(providerA && providerA === providerB && externalA && externalA === externalB);
}
