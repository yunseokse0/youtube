import { applyMealBattleDonationToParticipants, mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import { buildMemberCreationOrderIndex, compareMembersByDonationTotal } from "@/lib/utils";
import type { AppState, Donor, GroupSplitDonationSettings, Member } from "@/types";
import { normalizeDonationEventId, syncMemberTotalsFromDonors } from "./apply-donation-state";
import type { DonationEvent } from "./types";

export type GroupSplitPreview = {
  eligibleMembers: Member[];
  /** 1인 기본 몫(내림) */
  sharePerMember: number;
  /** 총액 보존 — 첫 분배 대상에 더하는 나머지(원) */
  remainderToFirst: number;
  totalAmount: number;
};

export function normalizeGroupSplitDonationSettings(input: unknown): GroupSplitDonationSettings {
  const v = input && typeof input === "object" ? (input as Partial<GroupSplitDonationSettings>) : {};
  const ids = Array.isArray(v.excludedMemberIds)
    ? v.excludedMemberIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  return {
    excludedMemberIds: Array.from(new Set(ids)),
    autoSplitOnKeyword: v.autoSplitOnKeyword !== false,
  };
}

/** 후원자명·메시지 자동 분배 키워드 — 「단체」는 단체짠 등도 포함 */
export const GROUP_SPLIT_AUTO_KEYWORDS = ["단체", "단짠"] as const;

/** 후원자명·메시지에 단체짠 키워드 포함 여부 */
export function isGroupSplitDonationKeyword(
  event: Pick<DonationEvent, "donorName" | "message">
): boolean {
  const text = `${String(event.donorName || "")} ${String(event.message || "")}`;
  return GROUP_SPLIT_AUTO_KEYWORDS.some((keyword) => text.includes(keyword));
}

/** 자동 스플릿 실패 시 — 대표(지정) → 없으면 후원 순위 1위 */
export function resolveGroupSplitFallbackMemberId(state: AppState): string | null {
  const members = state.members || [];
  const positions = state.memberPositions || {};
  const representative = members.find(
    (m) => m?.id && String(positions[m.id] || "").trim() === "대표"
  );
  if (representative?.id) return representative.id;

  const orderIndex = buildMemberCreationOrderIndex(members);
  const rankable = members.filter((member) => {
    if (!member?.id) return false;
    return !isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      positions
    );
  });
  if (rankable.length === 0) return null;
  const sorted = [...rankable].sort((a, b) => compareMembersByDonationTotal(a, b, orderIndex));
  return sorted[0]?.id || null;
}

export function shouldAutoGroupSplitDonation(
  event: Pick<DonationEvent, "donorName" | "message">,
  settings?: GroupSplitDonationSettings | null
): boolean {
  const cfg = normalizeGroupSplitDonationSettings(settings);
  if (!cfg.autoSplitOnKeyword) return false;
  return isGroupSplitDonationKeyword(event);
}

export function resolveGroupSplitEligibleMembers(
  state: AppState,
  settings?: GroupSplitDonationSettings | null
): Member[] {
  const normalized = normalizeGroupSplitDonationSettings(settings);
  const excluded = new Set(normalized.excludedMemberIds);
  return (state.members || []).filter((member) => {
    if (!member?.id) return false;
    if (excluded.has(member.id)) return false;
    return !isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      state.memberPositions || null
    );
  });
}

/** 총액 합이 정확히 total과 같도록 n등분 (나머지 원은 첫 멤버에 가산) */
export function computeGroupSplitAmounts(totalAmount: number, memberCount: number): number[] {
  const total = Math.max(0, Math.round(Number(totalAmount) || 0));
  if (memberCount <= 0) return [];
  const base = Math.floor(total / memberCount);
  if (base <= 0) return [];
  const remainder = total - base * memberCount;
  return Array.from({ length: memberCount }, (_, i) => base + (i === 0 ? remainder : 0));
}

export function previewGroupSplitDonation(
  state: AppState,
  amount: number,
  settings?: GroupSplitDonationSettings | null
): GroupSplitPreview {
  const eligibleMembers = resolveGroupSplitEligibleMembers(state, settings);
  const totalAmount = Math.max(0, Math.round(Number(amount) || 0));
  const count = eligibleMembers.length;
  const sharePerMember = count > 0 ? Math.floor(totalAmount / count) : 0;
  const remainderToFirst = totalAmount - sharePerMember * count;
  return { eligibleMembers, sharePerMember, remainderToFirst, totalAmount };
}

export function groupSplitDonorId(sourceEventId: string, memberId: string): string {
  const baseId = normalizeDonationEventId(String(sourceEventId || "").trim());
  return `${baseId}:split:${memberId}`;
}

export function isGroupSplitDonationApplied(state: AppState, rawEventId: string): boolean {
  const baseId = normalizeDonationEventId(String(rawEventId || "").trim());
  if (!baseId) return false;
  return countGroupSplitParts(state, rawEventId) > 0;
}

export function countGroupSplitParts(state: AppState, rawEventId: string): number {
  const baseId = normalizeDonationEventId(String(rawEventId || "").trim());
  if (!baseId) return 0;
  const prefix = `${baseId}:split:`;
  return (state.donors || []).filter((donor) => {
    const donorId = normalizeDonationEventId(String(donor.id || "").trim());
    return donorId.startsWith(prefix);
  }).length;
}

export function isGroupSplitPartDonor(donor: Donor): boolean {
  return Boolean(donor.groupSplit) || String(donor.id || "").includes(":split:");
}

/** donorsReplace 가 필요한 단체짠 나누기(분배 행·원본 제외 플래그) */
export function isGroupSplitDonorListMutation(donors: Donor[] | undefined): boolean {
  const rows = donors || [];
  if (rows.some((d) => isGroupSplitPartDonor(d))) return true;
  return rows.some((d) => d.groupSplitSource === true);
}

function donorAtMs(donor: { at?: number | string }): number {
  const raw = donor.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function eventAtMs(event: Pick<DonationEvent, "at">): number {
  const parsed = Date.parse(String(event.at || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/** 동일 후원(다른 id)이 이미 단체짠 됐는지 — 큐 자동반영 + 미매칭 수동 중복 방지 */
export function hasGroupSplitSignatureForDonation(
  state: AppState,
  event: Pick<DonationEvent, "id" | "donorName" | "amount" | "at">
): boolean {
  if (isGroupSplitDonationApplied(state, event.id)) return true;
  const name = String(event.donorName || "").trim();
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  if (!name || amount <= 0) return false;
  const atMs = eventAtMs(event);
  for (const d of state.donors || []) {
    if (!isGroupSplitSourceDonor(state, d)) continue;
    if (String(d.name || "").trim() !== name) continue;
    if (Math.round(Number(d.amount) || 0) !== amount) continue;
    if (Math.abs(donorAtMs(d) - atMs) <= 120_000) return true;
  }
  const splitParts = (state.donors || []).filter(
    (d) => isGroupSplitPartDonor(d) && String(d.name || "").trim() === name
  );
  if (splitParts.length >= 2) {
    const sum = splitParts.reduce((s, d) => s + Math.round(Number(d.amount) || 0), 0);
    if (sum === amount && splitParts.some((d) => Math.abs(donorAtMs(d) - atMs) <= 120_000)) {
      return true;
    }
  }
  return false;
}

/** 미매칭 단체짠 — 다른 id로 이미 1행 반영된 후원 찾기 */
export function findDonorRowForGroupSplitEvent(
  state: AppState,
  event: Pick<DonationEvent, "id" | "donorName" | "amount" | "at">
): Donor | null {
  const eventId = normalizeDonationEventId(String(event.id || "").trim());
  if (eventId) {
    const direct = (state.donors || []).find(
      (d) => normalizeDonationEventId(String(d.id || "")) === eventId
    );
    if (direct && !isGroupSplitPartDonor(direct)) return direct;
  }
  const name = String(event.donorName || "").trim();
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  if (!name || amount <= 0) return null;
  const atMs = eventAtMs(event);
  for (const d of state.donors || []) {
    if (isGroupSplitPartDonor(d)) continue;
    if (isGroupSplitSourceDonor(state, d)) continue;
    if (Math.round(Number(d.amount) || 0) !== amount) continue;
    if (String(d.name || "").trim() !== name) continue;
    if (Math.abs(donorAtMs(d) - atMs) <= 120_000) return d;
  }
  return null;
}

/** 단체짠 — 신규 행 추가 vs 기존 1행 나누기 자동 선택 */
export function applyGroupSplitFromEventOnState(
  state: AppState,
  event: DonationEvent,
  settings?: GroupSplitDonationSettings | null
): ApplyGroupSplitDonationResult {
  if (hasGroupSplitSignatureForDonation(state, event)) {
    return { ok: false, reason: "duplicate", event };
  }
  const existing = findDonorRowForGroupSplitEvent(state, event);
  if (existing) {
    if (isGroupSplitDonationApplied(state, existing.id)) {
      return { ok: false, reason: "duplicate", event };
    }
    return splitExistingDonorInAppState(state, existing.id, settings);
  }
  return applyGroupSplitDonationToAppState(state, event, settings);
}

export function isGroupSplitSourceDonor(state: AppState, donor: Donor): boolean {
  if (isGroupSplitPartDonor(donor)) return false;
  if (donor.groupSplitSource === true || donor.donationExcluded === true) return true;
  return isGroupSplitDonationApplied(state, donor.id);
}

export type ApplyGroupSplitDonationResult =
  | {
      ok: true;
      state: AppState;
      event: DonationEvent;
      donors: Donor[];
      preview: GroupSplitPreview;
    }
  | {
      ok: false;
      reason: "duplicate" | "no_eligible" | "amount_too_small" | "not_found" | "already_split_part";
      event?: DonationEvent;
      preview?: GroupSplitPreview;
    };

function donationEventFromDonor(donor: Donor): DonationEvent {
  const atMs = Number(donor.at);
  return {
    id: donor.id,
    provider: /^toonation:/i.test(String(donor.id || "")) ? "toonation" : "bank",
    externalId: String(donor.id || "").replace(/^toonation:/i, ""),
    donorName: donor.name,
    amount: donor.amount,
    at: new Date(Number.isFinite(atMs) ? atMs : Date.now()).toISOString(),
    target: donor.target || "toon",
    ...(donor.message ? { message: donor.message } : {}),
    status: "processed",
  };
}

function buildGroupSplitDonorRows(
  sourceId: string,
  donorName: string,
  eligibleMembers: Member[],
  amounts: number[],
  atMs: number,
  target: Donor["target"],
  message?: string
): Donor[] {
  return eligibleMembers.map((member, idx) => ({
    id: groupSplitDonorId(sourceId, member.id),
    name: donorName,
    amount: amounts[idx]!,
    memberId: member.id,
    at: atMs,
    target: target || "toon",
    groupSplit: true,
    ...(message ? { message } : {}),
  }));
}

function applyMealBattleForGroupSplit(
  state: AppState,
  removed: { memberId: string; amount: number; atMs: number } | null,
  added: Array<{ memberId: string; amount: number; atMs: number }>
): AppState["mealBattle"] {
  const syncMode = state.donationSyncMode || "mealBattle";
  if (syncMode !== "mealBattle") return state.mealBattle;
  const mealRaw = mealBattleUsesRawDonationScore(state.mealBattle);
  let participants = state.mealBattle?.participants || [];
  if (removed?.memberId && removed.amount > 0) {
    participants = applyMealBattleDonationToParticipants(
      participants,
      removed.memberId,
      removed.amount,
      -1,
      removed.atMs,
      mealRaw
    );
  }
  for (const row of added) {
    participants = applyMealBattleDonationToParticipants(
      participants,
      row.memberId,
      row.amount,
      1,
      row.atMs,
      mealRaw
    );
  }
  return { ...state.mealBattle, participants };
}

/** 후원자 리스트 1행 → 원본은 후원 제외 유지 + 멤버 수만큼 `:split:` 행 추가 (원자적) */
export function splitExistingDonorInAppState(
  currentState: AppState,
  donorId: string,
  settings?: GroupSplitDonationSettings | null
): ApplyGroupSplitDonationResult {
  const rawId = String(donorId || "").trim();
  if (!rawId || rawId.includes(":split:")) {
    return { ok: false, reason: "already_split_part" };
  }

  const donor = (currentState.donors || []).find((d) => d.id === rawId);
  if (!donor) {
    return { ok: false, reason: "not_found" };
  }

  if (isGroupSplitDonationApplied(currentState, rawId)) {
    return { ok: false, reason: "duplicate", event: donationEventFromDonor(donor) };
  }

  const preview = previewGroupSplitDonation(currentState, donor.amount, settings);
  if (preview.eligibleMembers.length === 0) {
    return { ok: false, reason: "no_eligible", event: donationEventFromDonor(donor), preview };
  }

  const amounts = computeGroupSplitAmounts(donor.amount, preview.eligibleMembers.length);
  if (amounts.length === 0) {
    return { ok: false, reason: "amount_too_small", event: donationEventFromDonor(donor), preview };
  }

  /**
   * 분배 실행 시각을 씀 — 원본 at(리셋 이전)를 물리면 서버 filter 에 걸려
   * 나누기 직후 후원·엑셀이 전부 비는 것처럼 초기화된다.
   */
  const atMs = Date.now();
  const splitDonors = buildGroupSplitDonorRows(
    rawId,
    donor.name,
    preview.eligibleMembers,
    amounts,
    atMs,
    donor.target,
    donor.message
  );

  const mealBattle = applyMealBattleForGroupSplit(
    currentState,
    { memberId: donor.memberId, amount: donor.amount, atMs },
    splitDonors.map((d) => ({ memberId: d.memberId, amount: d.amount, atMs }))
  );

  const now = Date.now();
  const updatedState = syncMemberTotalsFromDonors({
    ...currentState,
    donors: [
      ...(currentState.donors || []).map((d) =>
        d.id === rawId
          ? { ...d, donationExcluded: true, groupSplitSource: true, at: atMs }
          : d
      ),
      ...splitDonors,
    ],
    mealBattle,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    state: updatedState,
    event: donationEventFromDonor(donor),
    donors: splitDonors,
    preview,
  };
}

/** 단체짠 — 후원 총액 유지, 멤버 배분만 변경(운영비·제외 멤버 제외) */
export function applyGroupSplitDonationToAppState(
  currentState: AppState,
  rawEvent: DonationEvent,
  settings?: GroupSplitDonationSettings | null
): ApplyGroupSplitDonationResult {
  if (isGroupSplitDonationApplied(currentState, rawEvent.id)) {
    return { ok: false, reason: "duplicate", event: rawEvent };
  }

  const preview = previewGroupSplitDonation(currentState, rawEvent.amount, settings);
  if (preview.eligibleMembers.length === 0) {
    return { ok: false, reason: "no_eligible", event: rawEvent, preview };
  }

  const amounts = computeGroupSplitAmounts(rawEvent.amount, preview.eligibleMembers.length);
  if (amounts.length === 0) {
    return { ok: false, reason: "amount_too_small", event: rawEvent, preview };
  }

  const atMs = (() => {
    const parsed = Date.parse(String(rawEvent.at || ""));
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const message = String(rawEvent.message || "").trim();
  const donorName = String(rawEvent.donorName || "").trim() || "후원";
  const totalAmount = Math.max(0, Math.round(Number(rawEvent.amount) || 0));

  const sourceDonor: Donor = {
    id: rawEvent.id,
    name: donorName,
    amount: totalAmount,
    memberId: preview.eligibleMembers[0]!.id,
    at: atMs,
    target: rawEvent.target || "toon",
    donationExcluded: true,
    groupSplitSource: true,
    ...(message ? { message } : {}),
  };

  const splitDonors = buildGroupSplitDonorRows(
    rawEvent.id,
    donorName,
    preview.eligibleMembers,
    amounts,
    atMs,
    rawEvent.target,
    message || undefined
  );

  let mealBattle = currentState.mealBattle;
  if ((currentState.donationSyncMode || "mealBattle") === "mealBattle") {
    const mealRaw = mealBattleUsesRawDonationScore(currentState.mealBattle);
    let participants = currentState.mealBattle?.participants || [];
    for (const donor of splitDonors) {
      participants = applyMealBattleDonationToParticipants(
        participants,
        donor.memberId,
        donor.amount,
        1,
        atMs,
        mealRaw
      );
    }
    mealBattle = { ...currentState.mealBattle, participants };
  }

  const now = Date.now();
  const updatedState = syncMemberTotalsFromDonors({
    ...currentState,
    donors: [...(currentState.donors || []), sourceDonor, ...splitDonors],
    mealBattle,
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  });

  return {
    ok: true,
    state: updatedState,
    event: { ...rawEvent, status: "processed" },
    donors: splitDonors,
    preview,
  };
}