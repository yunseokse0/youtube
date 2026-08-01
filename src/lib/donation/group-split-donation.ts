import { applyMealBattleDonationToParticipants, mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import type { AppState, Donor, GroupSplitDonationSettings, Member } from "@/types";
import { normalizeDonationEventId, syncMemberTotalsFromDonors } from "./apply-donation-state";
import type { DonationEvent } from "./types";

export type GroupSplitPreview = {
  eligibleMembers: Member[];
  sharePerMember: number;
  remainderDropped: number;
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

export function previewGroupSplitDonation(
  state: AppState,
  amount: number,
  settings?: GroupSplitDonationSettings | null
): GroupSplitPreview {
  const eligibleMembers = resolveGroupSplitEligibleMembers(state, settings);
  const totalAmount = Math.max(0, Math.round(Number(amount) || 0));
  const count = eligibleMembers.length;
  const sharePerMember = count > 0 ? Math.floor(totalAmount / count) : 0;
  const remainderDropped = totalAmount - sharePerMember * count;
  return { eligibleMembers, sharePerMember, remainderDropped, totalAmount };
}

export function groupSplitDonorId(sourceEventId: string, memberId: string): string {
  const baseId = normalizeDonationEventId(String(sourceEventId || "").trim());
  return `${baseId}:split:${memberId}`;
}

export function isGroupSplitDonationApplied(state: AppState, rawEventId: string): boolean {
  const baseId = normalizeDonationEventId(String(rawEventId || "").trim());
  if (!baseId) return false;
  return (state.donors || []).some((donor) => {
    const donorId = normalizeDonationEventId(String(donor.id || "").trim());
    return donorId === baseId || donorId.startsWith(`${baseId}:split:`);
  });
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
      reason: "duplicate" | "no_eligible" | "amount_too_small";
      event: DonationEvent;
      preview?: GroupSplitPreview;
    };

/** 단체짠 — 운영비·제외 멤버를 빼고 잔액을 균등 분배(내림, 나머지 버림) */
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
  if (preview.sharePerMember <= 0) {
    return { ok: false, reason: "amount_too_small", event: rawEvent, preview };
  }

  const target = rawEvent.target || "toon";
  const atMs = (() => {
    const parsed = Date.parse(String(rawEvent.at || ""));
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const message = String(rawEvent.message || "").trim();
  const donorName = String(rawEvent.donorName || "").trim() || "후원";
  const syncMode = currentState.donationSyncMode || "mealBattle";
  const mealRaw = mealBattleUsesRawDonationScore(currentState.mealBattle);
  let mealParticipants = currentState.mealBattle?.participants || [];

  const splitDonors: Donor[] = preview.eligibleMembers.map((member) => ({
    id: groupSplitDonorId(rawEvent.id, member.id),
    name: donorName,
    amount: preview.sharePerMember,
    memberId: member.id,
    at: atMs,
    target,
    ...(message ? { message } : {}),
  }));

  if (syncMode === "mealBattle") {
    for (const donor of splitDonors) {
      mealParticipants = applyMealBattleDonationToParticipants(
        mealParticipants,
        donor.memberId,
        donor.amount,
        1,
        atMs,
        mealRaw
      );
    }
  }

  const now = Date.now();
  const updatedState = syncMemberTotalsFromDonors({
    ...currentState,
    donors: [...(currentState.donors || []), ...splitDonors],
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
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
