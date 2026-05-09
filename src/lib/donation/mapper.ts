import type { Member } from "@/types";
import type { DonationEvent, DonorAlias } from "./types";

export function normalizeName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, "");
}

export function mapToMember(
  event: DonationEvent,
  members: Member[],
  aliases: DonorAlias[] = []
): DonationEvent {
  const normalized = normalizeName(event.donorName);

  const aliasMatch = aliases.find((a) => normalizeName(a.alias) === normalized);
  if (aliasMatch) {
    return { ...event, memberId: aliasMatch.memberId, status: "processed" };
  }

  const exact = members.find((m) => m.name === event.donorName);
  if (exact) return { ...event, memberId: exact.id, status: "processed" };

  const fuzzy = members.find((m) => normalizeName(m.name) === normalized);
  if (fuzzy) return { ...event, memberId: fuzzy.id, status: "processed" };

  return { ...event, status: "unmatched" };
}
