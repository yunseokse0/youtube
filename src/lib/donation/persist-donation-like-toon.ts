import { saveAppStateForRoulette, type DonorsPersistMode } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { getServerMemoryAppState } from "@/lib/server-memory-app-state";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import { isDuplicateDonationEvent } from "@/lib/donation/apply-donation-state";
import { syncHighSocietyMemberWidthSnapshotInState } from "@/lib/high-society";
import type { DonationEvent } from "@/lib/donation/types";
import type { AppState } from "@/types";

export type DonationAppliedSseHint = {
  donorName: string;
  amount: number;
  target: "account" | "toon";
  memberName?: string;
};

async function broadcastDonationStateUpdated(
  updatedAt: number,
  donorRankingsUpdatedAt?: number,
  donationApplied?: DonationAppliedSseHint
): Promise<void> {
  await publishSseEvent({
    type: "state_updated" as const,
    updatedAt,
    ...(typeof donorRankingsUpdatedAt === "number" && donorRankingsUpdatedAt > 0
      ? { donorRankingsUpdatedAt }
      : {}),
    ...(donationApplied ? { donationApplied } : {}),
  });
}

export type PersistDonationStateOptions = {
  mode?: DonorsPersistMode;
  donationApplied?: DonationAppliedSseHint;
  /** add 모드에서 중복 검증용 (투네·수동 apply) */
  verifyEvent?: DonationEvent;
};

/**
 * 후원 mutation 공통 저장 — coalesce + saveAppStateForRoulette + SSE.
 * 투네·apply·삭제·나누기가 동일 Redis 경로를 탄다.
 */
export async function persistDonationStateToServer(
  userId: string,
  nextState: AppState,
  opts?: PersistDonationStateOptions
): Promise<{ ok: true; state: AppState } | { ok: false }> {
  const mode = opts?.mode ?? "add";
  const stateToSave = syncHighSocietyMemberWidthSnapshotInState(nextState);
  const persisted = await saveAppStateForRoulette(userId, stateToSave, { donorsMode: mode });

  if (opts?.verifyEvent && mode === "add") {
    /** reload(coalesce) 레이스로 verify 실패 → persist_failed 는 저장됐는데 UI 미반영 */
    const memSaved = getServerMemoryAppState(userId);
    const ok =
      isDuplicateDonationEvent(persisted, opts.verifyEvent) ||
      (memSaved ? isDuplicateDonationEvent(memSaved, opts.verifyEvent) : false);
    if (!ok) {
      const verify = await loadAppStateForUserId(userId);
      if (!verify || !isDuplicateDonationEvent(verify, opts.verifyEvent)) return { ok: false };
    }
  }

  await broadcastDonationStateUpdated(
    persisted.updatedAt,
    persisted.donorRankingsUpdatedAt,
    opts?.donationApplied
  );
  return { ok: true, state: persisted };
}

/**
 * 투네·수동 apply — add 모드 + donationApplied SSE.
 */
export async function persistDonationApplyLikeToonation(
  userId: string,
  appliedState: AppState,
  event: DonationEvent
): Promise<{ ok: true; state: AppState } | { ok: false }> {
  const member = (appliedState.members || []).find((m) => m.id === event.memberId);
  return persistDonationStateToServer(userId, appliedState, {
    mode: "add",
    verifyEvent: event,
    donationApplied: {
      donorName: event.donorName,
      amount: event.amount,
      target: event.target === "account" ? "account" : "toon",
      memberName: member?.name || undefined,
    },
  });
}
