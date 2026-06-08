import { applyMealBattleDonationToParticipants } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import type { AppState } from "@/types";
import { mapToMember } from "./mapper";
import type { DonationEvent, Donor, DonorAlias } from "./types";

function toEpochMs(input: string): number {
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? ts : Date.now();
}

export type ApplyDonationResult =
  | { ok: true; state: AppState; event: DonationEvent }
  | { ok: false; reason: "unmatched" | "duplicate"; event: DonationEvent };

/** 후원 1건을 AppState(멤버·donors·식사대전)에 반영 — 클라이언트·서버 공통 */
export function applyDonationToAppState(
  currentState: AppState,
  rawEvent: DonationEvent,
  aliases: DonorAlias[] = []
): ApplyDonationResult {
  if ((currentState.donors || []).some((d) => d.id === rawEvent.id)) {
    return { ok: false, reason: "duplicate", event: rawEvent };
  }

  const processedEvent = mapToMember(rawEvent, currentState.members || [], aliases, {
    /** 당분간 멤버 1명 운영 — 계좌 포맷 오류·플레이어 없음도 즉시 반영 후 큐에서 멤버만 검토 */
    autoAssignToonPlayer: true,
  });
  if (!processedEvent.memberId) {
    return { ok: false, reason: "unmatched", event: { ...processedEvent, status: "unmatched" } };
  }

  const newDonor: Donor = {
    id: processedEvent.id,
    name: processedEvent.donorName,
    amount: Math.max(0, Math.round(Number(processedEvent.amount) || 0)),
    memberId: processedEvent.memberId,
    at: processedEvent.at,
    target: processedEvent.target || "toon",
  };
  const atMs = toEpochMs(newDonor.at);

  const updatedMembers = currentState.members.map((member) => {
    if (member.id !== newDonor.memberId) return member;
    const field = newDonor.target === "toon" ? "toon" : "account";
    const nextAccount = field === "account" ? (member.account || 0) + newDonor.amount : (member.account || 0);
    const nextToon = field === "toon" ? (member.toon || 0) + newDonor.amount : (member.toon || 0);
    const isOperating = isOperatingSettlementMember(
      { id: member.id, name: member.name, operating: member.operating, realName: member.realName },
      currentState.memberPositions || null
    );
    return {
      ...member,
      [field]: (member[field] || 0) + newDonor.amount,
      contribution: isOperating ? Math.max(0, Number(member.contribution) || 0) : nextAccount + nextToon,
    };
  });

  const syncMode = currentState.donationSyncMode || "mealBattle";
  const mealParticipants =
    syncMode === "mealBattle"
      ? applyMealBattleDonationToParticipants(
          currentState.mealBattle?.participants || [],
          newDonor.memberId,
          newDonor.amount,
          1,
          atMs
        )
      : (currentState.mealBattle?.participants || []);

  const now = Date.now();
  const updatedState: AppState = {
    ...currentState,
    members: updatedMembers,
    donors: [
      ...(currentState.donors || []),
      {
        id: newDonor.id,
        name: newDonor.name,
        amount: newDonor.amount,
        memberId: newDonor.memberId,
        at: atMs,
        target: newDonor.target,
        ...(processedEvent.memberAutoAssigned ? { memberAutoAssigned: true } : {}),
      },
    ],
    mealBattle: {
      ...currentState.mealBattle,
      participants: mealParticipants,
    },
    donorRankingsUpdatedAt: now,
    updatedAt: now,
  };

  return {
    ok: true,
    state: updatedState,
    event: { ...processedEvent, memberId: processedEvent.memberId, status: "processed" },
  };
}
