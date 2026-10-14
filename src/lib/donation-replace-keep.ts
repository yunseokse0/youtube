/**
 * 브라우저 교체 저장(삭제·나누기·재배치)은 그 탭이 가진 후원 목록으로 서버 장부를 바꾼다.
 * 탭이 아직 못 받은 새 후원(허브·투네가 방금 넣은 것)까지 지우지 않도록,
 * 탭이 지운 ID 목록에 없는 서버 후원은 남긴다.
 */
import { donationHubIdentity } from "@/domain/dedupe/donation-hub-identity";
import type { Donor } from "@/types";

export const MAX_REMOVED_DONOR_IDS = 5_000;

function donorKey(id: unknown): string {
  const raw = String(id || "").trim();
  return (donationHubIdentity(raw) || raw).toLowerCase();
}

export function sanitizeRemovedDonorIds(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, MAX_REMOVED_DONOR_IDS);
}

export function keepServerDonorsUnseenByReplace(
  incoming: Donor[],
  existing: Donor[],
  removedDonorIds: string[]
): { donors: Donor[]; kept: Donor[] } {
  const known = new Set<string>();
  for (const d of incoming) {
    const k = donorKey(d?.id);
    if (k) known.add(k);
  }
  for (const id of removedDonorIds) {
    const k = donorKey(id);
    if (k) known.add(k);
  }
  const kept = existing.filter((d) => {
    const k = donorKey(d?.id);
    return Boolean(k) && !known.has(k);
  });
  if (kept.length === 0) return { donors: incoming, kept };
  return { donors: [...incoming, ...kept], kept };
}
