import { applyMealBattleDonationToParticipants, mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
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
  return { excludedMemberIds: Array.from(new Set(ids)) };
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

  const atMs = Number.isFinite(Number(donor.at)) ? Math.max(0, Math.floor(Number(donor.at))) : Date.now();
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
        d.id === rawId ? { ...d, donationExcluded: true, groupSplitSource: true } : d
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
    donors: [...(currentState.donors || []), ...splitDonors],
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