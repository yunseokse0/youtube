import type { Member } from "@/types";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import type { DonationEvent, DonorAlias } from "./types";

export function normalizeName(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, "");
}

/** 투네 후원 — 메시지에 플레이어 없을 때 기본 배치(첫 일반 멤버) */
export function pickDefaultToonationMember(members: Member[]): Member | undefined {
  if (!Array.isArray(members) || members.length === 0) return undefined;
  const regular = members.find(
    (m) =>
      !isOperatingSettlementMember(
        { id: m.id, name: m.name, operating: m.operating, realName: m.realName },
        null
      )
  );
  return regular ?? members[0];
}

export function resolveMemberLookupName(event: DonationEvent): string {
  const player = String(event.playerName || event.recipientName || "").trim();
  if (player) return player;
  return "";
}

function matchMemberByName(
  lookupName: string,
  members: Member[],
  aliases: DonorAlias[]
): Member | undefined {
  if (!lookupName) return undefined;
  const normalized = normalizeName(lookupName);

  const aliasMatch = aliases.find((a) => normalizeName(a.alias) === normalized);
  if (aliasMatch) {
    return members.find((m) => m.id === aliasMatch.memberId);
  }

  const exact = members.find((m) => m.name === lookupName);
  if (exact) return exact;

  return members.find((m) => normalizeName(m.name) === normalized);
}

export type MapToMemberOptions = {
  /** 플레이어 미지정·멤버 미매칭 시 첫 일반 멤버에 자동 배치(투네·계좌 공통) */
  autoAssignToonPlayer?: boolean;
};

export function mapToMember(
  event: DonationEvent,
  members: Member[],
  aliases: DonorAlias[] = [],
  opts?: MapToMemberOptions
): DonationEvent {
  const lookupName = resolveMemberLookupName(event);
  const matched = matchMemberByName(lookupName, members, aliases);
  if (matched) {
    return { ...event, memberId: matched.id, status: "processed" };
  }

  if (opts?.autoAssignToonPlayer) {
    const fallback = pickDefaultToonationMember(members);
    if (fallback) {
      return {
        ...event,
        memberId: fallback.id,
        memberAutoAssigned: true,
        status: "processed",
      };
    }
  }

  return { ...event, status: "unmatched" };
}
