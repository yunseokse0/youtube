import type { Member } from "@/types";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { buildMemberCreationOrderIndex, compareMembersByDonationTotal } from "@/lib/utils";
import { isAccountFormatToken } from "./toonation/parse-event";
import {
  findBestFuzzyNameMatch,
  MEMBER_NAME_FUZZY_AUTO_APPLY_THRESHOLD,
  normalizeComparableName,
  stripHonorificSuffix,
} from "./name-similarity";
import type { DonationEvent, DonorAlias } from "./types";

export function normalizeName(name: string): string {
  return normalizeComparableName(name);
}

/** 투네 후원 — 메시지에 플레이어 없을 때 기본 배치: 운영비 → 대표 → 국고 */
export type PickDefaultToonationMemberOptions = {
  memberPositions?: Record<string, string> | null;
};

/** 이름·실명·직급에 「국고」가 있으면 국고 멤버 */
export function isNationalTreasuryMember(
  m: Pick<Member, "id" | "name" | "realName">,
  memberPositions?: Record<string, string> | null
): boolean {
  const pos = String(memberPositions?.[m.id] || "").trim();
  return (
    /국고/i.test(String(m.name || "")) ||
    /국고/i.test(String(m.realName || "")) ||
    /국고/i.test(pos)
  );
}

export function pickDefaultToonationMember(
  members: Member[],
  opts?: PickDefaultToonationMemberOptions
): Member | undefined {
  if (!Array.isArray(members) || members.length === 0) return undefined;
  const positions = opts?.memberPositions || null;

  const operating = members.find((m) =>
    isOperatingSettlementMember(
      { id: m.id, name: m.name, operating: m.operating, realName: m.realName },
      positions
    )
  );
  if (operating) return operating;

  const representative = members.find(
    (m) => m?.id && String(positions?.[m.id] || "").trim() === "대표"
  );
  if (representative) return representative;

  const treasury = members.find((m) => isNationalTreasuryMember(m, positions));
  if (treasury) return treasury;

  return undefined;
}

function isRepresentativeMember(
  member: Pick<Member, "id">,
  memberPositions?: Record<string, string> | null
): boolean {
  return String(memberPositions?.[member.id] || "").trim() === "대표";
}

/** 후원자명만 있을 때 — 엑셀표 1등(대표·운영비 제외, 후원 총액 1위) */
export function pickTopRankedDonationMember(
  members: Member[],
  memberPositions?: Record<string, string> | null
): Member | undefined {
  if (!Array.isArray(members) || members.length === 0) return undefined;
  const positions = memberPositions || null;
  const orderIndex = buildMemberCreationOrderIndex(members);

  const isOperating = (m: Member) =>
    isOperatingSettlementMember(
      { id: m.id, name: m.name, operating: m.operating, realName: m.realName },
      positions
    );

  const rankable = members.filter(
    (m) => m?.id && !isRepresentativeMember(m, positions) && !isOperating(m)
  );
  if (rankable.length > 0) {
    return [...rankable].sort((a, b) => compareMembersByDonationTotal(a, b, orderIndex))[0];
  }

  const nonOperating = members.filter((m) => m?.id && !isOperating(m));
  if (nonOperating.length > 0) return nonOperating[0];

  return members.find((m) => m?.id);
}

export function resolveMemberLookupName(event: DonationEvent): string {
  const player = String(event.playerName || event.recipientName || "").trim();
  if (player) return player;
  return "";
}

const GENERIC_DONOR_LOOKUP_NAMES = new Set([
  normalizeComparableName("익명"),
  normalizeComparableName("anonymous"),
  normalizeComparableName("후원자"),
  normalizeComparableName("시청자"),
  normalizeComparableName("unknown"),
]);

function isUsefulDonorLookupName(name: string): boolean {
  const stripped = stripHonorificSuffix(name);
  return stripped.length >= 2 && !GENERIC_DONOR_LOOKUP_NAMES.has(stripped);
}

function memberFuzzyCandidates(members: Member[]): { label: string; value: Member }[] {
  return members.flatMap((m) => memberNameCandidates(m).map((label) => ({ label, value: m })));
}

function matchMemberByAliasFuzzy(
  lookupName: string,
  members: Member[],
  aliases: DonorAlias[],
  threshold?: number
): Member | undefined {
  if (!lookupName || aliases.length === 0) return undefined;
  const aliasFuzzy = findBestFuzzyNameMatch(
    lookupName,
    aliases.map((a) => ({ label: a.alias, value: a })),
    threshold
  );
  if (!aliasFuzzy) return undefined;
  return members.find((m) => m.id === aliasFuzzy.item.value.memberId);
}

/** 메시지·플레이어 필드에서 멤버 매칭 후보(앞쪽 우선) — `익명` 등 일반 토큰 제외 */
export function resolveMemberLookupCandidates(event: DonationEvent): string[] {
  const out: string[] = [];
  const push = (raw?: string) => {
    const t = String(raw || "")
      .trim()
      .replace(/[,.:;!?~]+$/g, "")
      .trim();
    if (!t || out.includes(t)) return;
    if (!isUsefulDonorLookupName(t)) return;
    out.push(t);
  };
  push(event.playerName);
  push(event.recipientName);
  const msg = String(event.message || "").trim();
  if (msg) {
    for (const tok of msg.split(/\s+/).filter(Boolean)) {
      if (isAccountFormatToken(tok)) continue;
      push(tok);
    }
  }
  return out;
}

/** 후원자명 — 플레이어·메시지 매칭 실패 시 유사 일치 후보 */
export function resolveDonorLookupCandidate(event: DonationEvent): string | undefined {
  const donor = String(event.donorName || "").trim();
  return isUsefulDonorLookupName(donor) ? donor : undefined;
}

function resolveAllMemberLookupCandidates(event: DonationEvent): string[] {
  const out = resolveMemberLookupCandidates(event);
  const donor = resolveDonorLookupCandidate(event);
  if (donor && !out.includes(donor)) out.push(donor);
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

/** 공백 없는 메시지·부분 문자열까지 후보 토큰 추출 */
function extractMessageLookupTokens(message: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const t = String(raw || "")
      .trim()
      .replace(/[,.:;!?~]+$/g, "")
      .trim();
    if (!t || !isUsefulDonorLookupName(t)) return;
    const key = normalizeName(t);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  const raw = String(message || "").trim();
  if (!raw) return out;
  for (const tok of raw.split(/\s+/).filter(Boolean)) {
    if (isAccountFormatToken(tok)) continue;
    push(tok);
  }
  const compact = normalizeName(raw);
  if (compact.length >= 2) {
    const maxLen = Math.min(8, compact.length);
    for (let len = 2; len <= maxLen; len += 1) {
      for (let i = 0; i <= compact.length - len; i += 1) {
        push(compact.slice(i, i + len));
      }
    }
  }
  return out.slice(0, 48);
}

/** 메시지 토큰·부분 문자열 유사 일치 — `홍스`↔`홍쓰`, 공백 없는 닉 포함 */
function matchMemberByMessageFuzzy(
  message: string,
  members: Member[],
  aliases: DonorAlias[],
  threshold = MEMBER_NAME_FUZZY_AUTO_APPLY_THRESHOLD
): Member | undefined {
  const tokens = extractMessageLookupTokens(message);
  if (tokens.length === 0) return undefined;
  const fuzzyCandidates = memberFuzzyCandidates(members);
  let best: { member: Member; score: number } | null = null;
  for (const token of tokens) {
    const aliasMatch = matchMemberByAliasFuzzy(token, members, aliases, threshold);
    if (aliasMatch) {
      const score = 1;
      if (!best || score > best.score) best = { member: aliasMatch, score };
      continue;
    }
    const fuzzy = findBestFuzzyNameMatch(token, fuzzyCandidates, threshold);
    if (!fuzzy) continue;
    if (!best || fuzzy.score > best.score) {
      best = { member: fuzzy.item.value, score: fuzzy.score };
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

  const aliasFuzzy = matchMemberByAliasFuzzy(lookupName, members, aliases, undefined);
  if (aliasFuzzy) return aliasFuzzy;

  const exact = members.find((m) => m.name === lookupName || m.realName === lookupName);
  if (exact) return exact;

  const normalizedMatch = members.find((m) =>
    memberNameCandidates(m).some(
      (label) => normalizeName(label) === normalized || stripHonorificSuffix(label) === stripped
    )
  );
  if (normalizedMatch) return normalizedMatch;

  /** `태호` → `BT태호`, `BT태호` ⊃ `태호` — 접두·접미·포함 유사 일치 */
  if (normalized.length >= 2) {
    let partialBest: { member: Member; score: number } | null = null;
    for (const member of members) {
      for (const label of memberNameCandidates(member)) {
        const memberNorm = normalizeName(label);
        if (!memberNorm) continue;
        const memberCore = memberNorm.replace(/^bt(?=[가-힣])/, "") || memberNorm;
        const lookupCore = normalized.replace(/^bt(?=[가-힣])/, "") || normalized;

        let score = 0;
        if (memberNorm.endsWith(normalized) || memberNorm.endsWith(lookupCore)) {
          score = Math.max(normalized.length, lookupCore.length) / memberNorm.length;
        } else if (normalized.endsWith(memberNorm) || lookupCore.endsWith(memberCore)) {
          score = memberNorm.length / Math.max(normalized.length, lookupCore.length);
        } else if (
          memberNorm.includes(normalized) ||
          normalized.includes(memberNorm) ||
          memberCore.includes(lookupCore) ||
          lookupCore.includes(memberCore)
        ) {
          score =
            (Math.min(normalized.length, memberNorm.length) / Math.max(normalized.length, memberNorm.length)) *
            0.92;
        }
        if (score >= 0.35 && (!partialBest || score > partialBest.score)) {
          partialBest = { member, score };
        }
      }
    }
    if (partialBest) return partialBest.member;
  }

  const fuzzyCandidates = members.flatMap((m) =>
    memberNameCandidates(m).map((label) => ({ label, value: m }))
  );
  const fuzzy = findBestFuzzyNameMatch(lookupName, fuzzyCandidates);
  return fuzzy?.item.value;
}

/** 완화 fuzzy·별칭 유사 일치 — 자동 반영·미매칭 제안 공통 */
function matchMemberByRelaxedFuzzy(
  lookupName: string,
  members: Member[],
  aliases: DonorAlias[],
  threshold = MEMBER_NAME_FUZZY_AUTO_APPLY_THRESHOLD
): Member | undefined {
  if (!lookupName) return undefined;

  const aliasMatch = matchMemberByAliasFuzzy(lookupName, members, aliases, threshold);
  if (aliasMatch) return aliasMatch;

  const fuzzy = findBestFuzzyNameMatch(lookupName, memberFuzzyCandidates(members), threshold);
  return fuzzy?.item.value;
}

export type MapToMemberOptions = {
  /** 유사 일치 실패 시 운영비→대표→국고 자동 배치 */
  autoAssignToonPlayer?: boolean;
  memberPositions?: Record<string, string> | null;
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

  const messageFuzzyMatched = matchMemberByMessageFuzzy(event.message || "", members, aliases);
  if (messageFuzzyMatched) {
    return {
      ...event,
      memberId: messageFuzzyMatched.id,
      memberFuzzyMatched: true,
      status: "processed",
    };
  }

  const candidates = resolveAllMemberLookupCandidates(event);
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

  /** 엄격 매칭 실패 시 — 완화 유사 일치로 자동 반영 */
  for (const lookupName of candidates) {
    const relaxed = matchMemberByRelaxedFuzzy(lookupName, members, aliases);
    if (relaxed) {
      return {
        ...event,
        memberId: relaxed.id,
        playerName: event.playerName || lookupName,
        memberFuzzyMatched: true,
        status: "processed",
      };
    }
  }

  /**
   * 유사 일치로도 못 찾으면 운영비 → 대표 → 국고 순으로 반영.
   * (자동 반영 옵션이 켜진 서버/관리자 경로)
   */
  if (opts?.autoAssignToonPlayer) {
    const fallback = pickDefaultToonationMember(members, {
      memberPositions: opts.memberPositions,
    });
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

/** 미매칭 UI — 멤버 드롭다운 기본값 제안(자동 반영 아님) */
export function suggestMemberForDonationEvent(
  event: DonationEvent,
  members: Member[],
  aliases: DonorAlias[] = [],
  memberPositions?: Record<string, string> | null
): Member | undefined {
  if (!Array.isArray(members) || members.length === 0) return undefined;
  const msgMatch = matchMemberByMessageContains(event.message || "", members);
  if (msgMatch) return msgMatch;
  const msgFuzzy = matchMemberByMessageFuzzy(event.message || "", members, aliases);
  if (msgFuzzy) return msgFuzzy;
  for (const lookupName of resolveAllMemberLookupCandidates(event)) {
    const exact = matchMemberByName(lookupName, members, aliases);
    if (exact) return exact;
    const relaxed = matchMemberByRelaxedFuzzy(lookupName, members, aliases);
    if (relaxed) return relaxed;
  }
  return pickDefaultToonationMember(members, { memberPositions });
}
