import type { AppState, Donor, Member, ZubZubQueueItem } from "@/types";
import type { DonationEvent } from "@/lib/donation/types";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import {
  claimEarliestWaitingZubzub,
  insertZubzubQueueItem,
  listWaitingZubzubQueues,
  cancelZubzubQueueItem,
} from "./zubzub-repo";

export type ZubzubHookResult =
  | { action: "enqueued_waiting"; queueItem: ZubZubQueueItem }
  | { action: "claimed"; queueItem: ZubZubQueueItem; bonusDonor: Donor }
  | { action: "skipped"; reason: string };

/** 줍줍 활성화 여부 확인 */
export function isZubzubEnabled(state: AppState): boolean {
  return Boolean(state?.zubzubSettings?.enabled);
}

/** 대표 멤버 식별 (설정값 우선, 없으면 직급 맵에서 대표 판정, 없으면 첫 번째 멤버) */
export function findRepresentativeMember(state: AppState): Member | undefined {
  if (state?.zubzubSettings?.representativeMemberId) {
    const specified = (state.members || []).find(
      (m) => m.id === state.zubzubSettings?.representativeMemberId
    );
    if (specified) return specified;
  }
  const fromPos = (state.members || []).find((m) => {
    const pos = String(state.memberPositions?.[m.id] || "").trim();
    if (pos === "대표") return true;
    if (pos.includes("부대표")) return false;
    return pos.includes("대표");
  });
  if (fromPos) return fromPos;
  return state.members?.[0];
}

/** 시그니처 후원 여부 및 정보 판별 */
export function isEligibleSigDonation(
  event: DonationEvent,
  state: AppState,
  minPrice: number
): { isSig: boolean; sigName: string; sigImageUrl?: string } {
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  if (amount < minPrice) {
    return { isSig: false, sigName: "" };
  }

  // 1. 이미 매칭된 시그명이 있는 경우 (player-donation-alert / enrichDonationEventWithSigMatch)
  if (event.matchedSigName) {
    return {
      isSig: true,
      sigName: String(event.matchedSigName).trim(),
      sigImageUrl: event.matchedSigImageUrl || undefined,
    };
  }

  // 2. isSigCredit 플래그가 있는 경우
  if ((event as { isSigCredit?: boolean }).isSigCredit && event.sigPrice) {
    return {
      isSig: true,
      sigName: String(event.message || "시그니처").trim() || "시그니처",
    };
  }

  // 3. sigInventory 목록과 금액 또는 메시지 대조
  const inv = state.sigInventory || [];
  if (inv.length > 0) {
    const msg = String(event.message || "").toLowerCase().replace(/\s+/g, "");
    for (const sig of inv) {
      if (!sig.name) continue;
      const price = Math.max(0, Math.round(Number(sig.price) || 0));
      const sigNorm = sig.name.toLowerCase().replace(/\s+/g, "");
      if (price > 0 && price === amount) {
        return {
          isSig: true,
          sigName: sig.name,
          sigImageUrl: sig.imageUrl || undefined,
        };
      }
      if (msg && msg.includes(sigNorm)) {
        return {
          isSig: true,
          sigName: sig.name,
          sigImageUrl: sig.imageUrl || undefined,
        };
      }
    }
  }

  // 4. 최소 시그 금액 기준을 충족하고 단가 이상인 경우 기본 시그로 인정
  if (minPrice > 0 && amount >= minPrice) {
    return {
      isSig: true,
      sigName: String(event.message || "").trim() || "시그니처",
    };
  }

  return { isSig: false, sigName: "" };
}

/**
 * 후원 이벤트 처리 후 호출되는 줍줍 판정 훅
 */
export async function processZubzubDonationHook(
  userId: string,
  event: DonationEvent,
  state: AppState
): Promise<ZubzubHookResult> {
  if (!isZubzubEnabled(state)) {
    return { action: "skipped", reason: "zubzub_disabled" };
  }

  const memberId = String(event.memberId || "").trim();
  if (!memberId) {
    return { action: "skipped", reason: "no_member_id" };
  }

  const rep = findRepresentativeMember(state);
  if (!rep) {
    return { action: "skipped", reason: "no_representative_found" };
  }

  const minPrice = Math.max(0, Number(state.zubzubSettings?.minSigPrice) || 0);
  const sigInfo = isEligibleSigDonation(event, state, minPrice);
  if (!sigInfo.isSig) {
    return { action: "skipped", reason: "not_a_sig_donation" };
  }

  const isRepDonation = memberId === rep.id;

  if (isRepDonation) {
    // -------------------------------------------------------------
    // [Case A] 대표 시그 발생 ──▶ 줍줍 큐(Queue)에 적재 (status: WAITING)
    // -------------------------------------------------------------
    const queueId = `zb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const bonusAmount = Math.max(0, Math.round(Number(event.amount) || 0));

    const queueItem = await insertZubzubQueueItem(userId, {
      id: queueId,
      triggerDonationId: String(event.id || event.externalId || queueId),
      sigName: sigInfo.sigName,
      sigImageUrl: sigInfo.sigImageUrl,
      bonusAmount,
    });

    // AppState 스냅샷 갱신
    const currentWaitings = await listWaitingZubzubQueues(userId);
    const updatedState: AppState = {
      ...state,
      zubzubWaitingItems: currentWaitings,
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, updatedState);

    // 실시간 SSE 알림 (오버레이 및 어드민 UI 갱신)
    await publishSseEvent({
      type: "zubzub_waiting",
      userId,
      queueItem,
      waitingCount: currentWaitings.length,
      timestamp: Date.now(),
    });

    return { action: "enqueued_waiting", queueItem };
  } else {
    // -------------------------------------------------------------
    // [Case B] 일반 멤버 시그 발생 ──▶ 대기 큐에서 선착순 획득 (CLAIMED)
    // -------------------------------------------------------------
    const claimedQueue = await claimEarliestWaitingZubzub(
      userId,
      memberId,
      String(event.id || event.externalId || "")
    );

    if (!claimedQueue) {
      return { action: "skipped", reason: "no_waiting_queue" };
    }

    // ⭐️ 복제 보너스 Donor 생성 (실정산 격리 보장!)
    const claimingMember = (state.members || []).find((m) => m.id === memberId);
    const memberName = claimingMember?.name || "멤버";

    const bonusDonor: Donor = {
      id: `zubzub_bonus_${claimedQueue.id}`,
      name: `[대표 줍줍] ${claimedQueue.sigName}`,
      donorName: `대표 시그 줍줍`,
      amount: claimedQueue.bonusAmount,
      memberId,
      at: Date.now(),
      message: `[대표 시그 줍줍] ${claimedQueue.sigName} (+${claimedQueue.bonusAmount.toLocaleString()}점)`,
      
      // 실정산 현금 합산 제외!
      donationExcluded: true,
      isSigCredit: true,
      sigPrice: claimedQueue.bonusAmount,
      contributionPoints: claimedQueue.bonusAmount, // 랭킹 기여도 점수에만 100% 반영
      isZubzubBonus: true,
      zubzubQueueId: claimedQueue.id,
      provider: "zubzub_bonus",
      externalId: claimedQueue.id,
    };

    // state.donors 에 보너스 추가 및 기여도 랭킹 재계산
    const nextDonors = [...(state.donors || []), bonusDonor];
    const currentWaitings = await listWaitingZubzubQueues(userId);

    const nextStateWithDonors: AppState = {
      ...state,
      donors: nextDonors,
      zubzubWaitingItems: currentWaitings,
      updatedAt: Date.now(),
    };

    const syncedState = syncMemberTotalsFromDonors(nextStateWithDonors);
    await saveAppStateForRoulette(userId, syncedState);

    // 실시간 SSE 브로드캐스트
    await publishSseEvent({
      type: "zubzub_claimed",
      userId,
      queueItem: claimedQueue,
      memberId,
      memberName,
      bonusAmount: claimedQueue.bonusAmount,
      bonusDonor,
      remainingWaitingCount: currentWaitings.length,
      timestamp: Date.now(),
    });

    return { action: "claimed", queueItem: claimedQueue, bonusDonor };
  }
}

/**
 * 줍줍 건 수동 취소 또는 회수 (Rollback)
 */
export async function revertOrCancelZubzubQueue(
  userId: string,
  queueId: string,
  state: AppState
): Promise<{ ok: boolean; newState?: AppState }> {
  const success = await cancelZubzubQueueItem(userId, queueId);
  if (!success) return { ok: false };

  // 이미 CLAIMED 되어 donors 에 들어간 경우 해당 bonus donor 제거
  const targetBonusId = `zubzub_bonus_${queueId}`;
  const hadBonus = (state.donors || []).some(
    (d) => d.id === targetBonusId || d.zubzubQueueId === queueId
  );

  let nextState = state;
  if (hadBonus) {
    const filteredDonors = (state.donors || []).filter(
      (d) => d.id !== targetBonusId && d.zubzubQueueId !== queueId
    );
    nextState = syncMemberTotalsFromDonors({
      ...state,
      donors: filteredDonors,
      updatedAt: Date.now(),
    });
  }

  const currentWaitings = await listWaitingZubzubQueues(userId);
  nextState = {
    ...nextState,
    zubzubWaitingItems: currentWaitings,
    updatedAt: Date.now(),
  };

  await saveAppStateForRoulette(userId, nextState);
  await publishSseEvent({
    type: "zubzub_canceled",
    userId,
    queueId,
    waitingCount: currentWaitings.length,
    timestamp: Date.now(),
  });

  return { ok: true, newState: nextState };
}

/**
 * 인제스트 후원 이벤트 발생 시 안전하게 줍줍 훅 호출
 */
export async function maybeProcessZubzubDonation(
  userId: string,
  event: DonationEvent
): Promise<ZubzubHookResult | null> {
  try {
    const { loadAppStateForUserId } = await import("@/lib/app-state-server-load");
    const { enrichDonationEventWithSigMatch } = await import("@/lib/donation/player-donation-alert");
    const state = await loadAppStateForUserId(userId);
    if (!state || !isZubzubEnabled(state)) return null;
    const enriched = await enrichDonationEventWithSigMatch(userId, event);
    return await processZubzubDonationHook(userId, enriched, state);
  } catch (err) {
    console.error("[zubzub] hook error:", err);
    return null;
  }
}

