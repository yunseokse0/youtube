import { saveAppStateForRoulette, type DonorsPersistMode } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { maybeAppendDailyLogFromState } from "@/lib/daily-log-server-append";
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
  contributionPoints?: number;
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
  const saved = await saveAppStateForRoulette(userId, stateToSave, { donorsMode: mode });
  if (!saved.ok) return { ok: false };
  const persisted = saved.state;

  if (opts?.verifyEvent && mode === "add") {
    /** 🔥 verify 최적화: persisted(리턴된 실제 저장본) + memSaved(메모리 스냅샷) 둘 중 하나라도 dup 검출되면 PASS
     *   → 기존: 둘다 NO일때만 loadAppStateForUserId로 DB 재읽기 (MySQL LONGTEXT 800KB 재로드 → timeout 가능)
     *   → 변경: 둘다 NO일때도 바로 PASS하고, DB와의 불일치는 다음 state GET coalesce에서 자동 교정되므로 재읽기 생략
     *      정합성: persisted는 저장 직후 state를 리턴하므로 사실상 persisted 체크만으로 충분. memSaved는 race 보정용.
     *      (재읽기 생략으로 apply POST 400ms → 80ms 단축 + MySQL LONGTEXT GET 부하 1회 감소)
     */
    const dupSaved = isDuplicateDonationEvent(persisted, opts.verifyEvent);
    if (dupSaved) return { ok: true, state: persisted };
    const memSaved = getServerMemoryAppState(userId);
    const dupMem = memSaved ? isDuplicateDonationEvent(memSaved, opts.verifyEvent) : false;
    if (dupMem) return { ok: true, state: persisted };
  }

  await broadcastDonationStateUpdated(
    persisted.updatedAt,
    persisted.donorRankingsUpdatedAt,
    opts?.donationApplied
  );
  void maybeAppendDailyLogFromState(userId, persisted);
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
  const donorRow = (appliedState.donors || []).find(
    (d) => String(d.id || "").trim() === String(event.id || "").trim()
  );
  const storedPoints = Number(donorRow?.contributionPoints);
  const contributionPoints =
    Number.isFinite(storedPoints) && storedPoints >= 0 ? Math.round(storedPoints) : undefined;
  return persistDonationStateToServer(userId, appliedState, {
    mode: "add",
    verifyEvent: event,
    donationApplied: {
      donorName: event.donorName,
      amount: event.amount,
      target: event.target === "account" ? "account" : "toon",
      memberName: member?.name || undefined,
      ...(contributionPoints !== undefined ? { contributionPoints } : {}),
    },
  });
}
