import type { Member } from "@/types";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { isAccountFormatToken } from "./toonation/parse-event";
import {
  findBestFuzzyNameMatch,
  normalizeComparableName,
  stripHonorificSuffix,
} from "./name-similarity";
import type { DonationEvent, DonorAlias } from "./types";

export function normalizeName(name: string): string {
  return normalizeComparableName(name);
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

/** 메시지·플레이어 필드에서 멤버 매칭 후보(앞쪽 우선) */
export function resolveMemberLookupCandidates(event: DonationEvent): string[] {
  const out: string[] = [];
  const push = (raw?: string) => {
    const t = String(raw || "")
      .trim()
      .replace(/[,.:;!?~]+$/g, "")
      .trim();
    if (!t || out.includes(t)) return;
    out.push(t);
  };
  push(event.playerName);
  push(event.recipientName);
  const msg = String(event.message || "").trim();
  if (!msg) return out;
  for (const tok of msg.split(/\s+/).filter(Boolean)) {
    if (isAccountFormatToken(tok)) continue;
    push(tok);
  }
  return out;
}

function memberNameCandidates(member: Member): string[] {
  const out = new Set<string>();
  const push = (v?: string) => {
    const s = String(v || "").trim();
    if (s) out.add(s);
  };
  push(member.name);
  push(member.realName);
  return Array.from(out);
}

function matchMemberByMessageContains(message: string, members: Member[]): Member | undefined {
  const raw = String(message || "").trim();
  if (!raw) return undefined;
  const normalizedMessage = normalizeName(raw);
  let best: { member: Member; score: number } | null = null;
  for (const member of members) {
    for (const label of memberNameCandidates(member)) {
      const trimmed = String(label || "").trim();
      if (trimmed.length < 2) continue;
      const normalizedLabel = normalizeName(trimmed);
      if (!normalizedLabel) continue;
      const matched =
        raw.includes(trimmed) ||
        normalizedMessage.includes(normalizedLabel) ||
        raw.includes(stripHonorificSuffix(trimmed));
      if (!matched) continue;
      const score = normalizedLabel.length;
      if (!best || score > best.score) {
        best = { member, score };
      }
    }
  }
  return best?.member;
}

function matchMemberByName(
  lookupName: string,
  members: Member[],
  aliases: DonorAlias[]
): Member | undefined {
  if (!lookupName) return undefined;
  const normalized = normalizeName(lookupName);
  const stripped = stripHonorificSuffix(lookupName);

  const aliasMatch = aliases.find(
    (a) =>
      normalizeName(a.alias) === normalized ||
      stripHonorificSuffix(a.alias) === stripped
  );
  if (aliasMatch) {
    return members.find((m) => m.id === aliasMatch.memberId);
  }

  const exact = members.find((m) => m.name === lookupName || m.realName === lookupName);
  if (exact) return exact;

  const normalizedMatch = members.find((m) =>
    memberNameCandidates(m).some(
      (label) => normalizeName(label) === normalized || stripHonorificSuffix(label) === stripped
    )
  );
  if (normalizedMatch) return normalizedMatch;

  const fuzzyCandidates = members.flatMap((m) =>
    memberNameCandidates(m).map((label) => ({ label, value: m }))
  );
  const fuzzy = findBestFuzzyNameMatch(lookupName, fuzzyCandidates);
  return fuzzy?.item.value;
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
  const messageMatched = matchMemberByMessageContains(event.message || "", members);
  if (messageMatched) {
    return {
      ...event,
      memberId: messageMatched.id,
      status: "processed",
    };
  }

  const candidates = resolveMemberLookupCandidates(event);
  for (const lookupName of candidates) {
    const matched = matchMemberByName(lookupName, members, aliases);
    if (matched) {
      return {
        ...event,
        memberId: matched.id,
        playerName: event.playerName || lookupName,
        status: "processed",
      };
    }
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
