import type { AppState, ContributionLog, Donor, Member, ZubZubQueueItem } from "@/types";
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
  | {
      action: "claimed";
      queueItem: ZubZubQueueItem;
      bonusDonor: Donor;
      contributionLog: ContributionLog;
    }
  | { action: "skipped"; reason: string };

export function createZubzubBonusContributionLog(
  queueId: string,
  memberId: string,
  amount: number,
  sigName: string,
  at = Date.now()
): ContributionLog {
  const normalizedAmount = Math.max(0, Math.round(Number(amount) || 0));
  return {
    id: `zubzub_bonus_${queueId}`,
    memberId,
    amount: normalizedAmount,
    delta: 1,
    donorName: "대표 시그 줍줍",
    note: `[대표 시그 줍줍] ${sigName} (+${normalizedAmount.toLocaleString()}점)`,
    at,
    isZubzubBonus: true,
    zubzubQueueId: queueId,
  };
}

/** 줍줍이 켜져 있는데 발동하지 않을 때 원인을 서버 로그에서 바로 볼 수 있게 남긴다. */
function logZubzubSkip(reason: string, detail?: Record<string, unknown>): ZubzubHookResult {
  console.log(`[zubzub] skip=${reason}`, detail ?? "");
  return { action: "skipped", reason };
}

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
  const matchedSigName = String(event.matchedSigName || "").trim();
  if (matchedSigName) {
    return {
      isSig: true,
      sigName: matchedSigName,
      sigImageUrl: event.matchedSigImageUrl || undefined,
    };
  }

  // 2. 시그 인벤토리와 금액·메시지 대조. 중복 단가는 이름이 특정될 때만 선택한다.
  const inv = state.sigInventory || [];
  const msg = String(event.message || "").toLowerCase().replace(/\s+/g, "");
  const resolveFromCandidates = (candidates: typeof inv) => {
    const textMatches = candidates.filter((sig) => {
      const name = String(sig.name || "").toLowerCase().replace(/\s+/g, "");
      return name && msg.includes(name);
    });
    if (textMatches.length === 1) return textMatches[0];
    if (candidates.length === 1 && textMatches.length === 0) return candidates[0];
    return undefined;
  };

  // isSigCredit identifies a sig result, but its message is not necessarily the sig name.
  if ((event as { isSigCredit?: boolean }).isSigCredit) {
    const sigPrice = Math.max(0, Math.round(Number(event.sigPrice) || 0));
    const sig = sigPrice > 0
      ? resolveFromCandidates(
          inv.filter((item) => Math.round(Number(item.price) || 0) === sigPrice)
        )
      : undefined;
    return sig
      ? { isSig: true, sigName: sig.name, sigImageUrl: sig.imageUrl || undefined }
      : { isSig: false, sigName: "" };
  }

  // 3. Match a unique price candidate, or disambiguate duplicate prices by message.
  if (inv.length > 0) {
    const priceMatches = amount > 0
      ? inv.filter((sig) => Math.round(Number(sig.price) || 0) === amount)
      : [];
    let sig = resolveFromCandidates(priceMatches);
    if (!sig && priceMatches.length === 0 && msg) {
      const nameMatches = inv.filter((item) => {
        const name = String(item.name || "").toLowerCase().replace(/\s+/g, "");
        return name && msg.includes(name);
      });
      if (nameMatches.length === 1) sig = nameMatches[0];
    }
    if (sig) {
      return {
        isSig: true,
        sigName: sig.name,
        sigImageUrl: sig.imageUrl || undefined,
      };
    }
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
    return logZubzubSkip("no_member_id", { eventId: event.id, amount: event.amount });
  }

  const rep = findRepresentativeMember(state);
  if (!rep) {
    return logZubzubSkip("no_representative_found");
  }

  const minPrice = Math.max(0, Number(state.zubzubSettings?.minSigPrice) || 0);
  const sigInfo = isEligibleSigDonation(event, state, minPrice);
  if (!sigInfo.isSig) {
    return logZubzubSkip("not_a_sig_donation", {
      memberId,
      repId: rep.id,
      amount: Math.max(0, Math.round(Number(event.amount) || 0)),
      minPrice,
      matchedSigName: event.matchedSigName || "",
    });
  }

  const isRepDonation = memberId === rep.id;

  if (isRepDonation) {
    // -------------------------------------------------------------
    // [Case A] 대표 시그 발생 ──▶ 줍줍 큐(Queue)에 적재 (status: WAITING)
    // -------------------------------------------------------------
    console.log("[zubzub] enqueued_waiting", {
      memberId,
      repId: rep.id,
      sigName: sigInfo.sigName,
      bonusAmount: Math.max(0, Math.round(Number(event.amount) || 0)),
    });
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
    // [Case B] 일반 멤버 시그 발생 ──▶ 대기 큐에서 획득 (CLAIMED)
    //   획득 조건: "동일한 시그 = 동일한 후원금액".
    //   후원금액(시그 단가)이 대기 건의 bonusAmount와 같은 건만 획득한다.
    // -------------------------------------------------------------
    const claimAmount = Math.max(0, Math.round(Number(event.amount) || 0));
    const claimedQueue = await claimEarliestWaitingZubzub(
      userId,
      memberId,
      String(event.id || event.externalId || ""),
      claimAmount
    );

    if (!claimedQueue) {
      return logZubzubSkip("no_waiting_queue", { memberId, amount: claimAmount });
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
    const contributionLog = createZubzubBonusContributionLog(
      claimedQueue.id,
      memberId,
      claimedQueue.bonusAmount,
      claimedQueue.sigName
    );

    // 줍줍 금액은 후원 원장에 넣지 않고 기여도 기록부에만 남긴다.
    const currentWaitings = await listWaitingZubzubQueues(userId);

    const nextStateWithContribution: AppState = {
      ...state,
      contributionLogs: [
        ...(state.contributionLogs || []).filter((log) => log.id !== contributionLog.id),
        contributionLog,
      ],
      zubzubWaitingItems: currentWaitings,
      updatedAt: Date.now(),
    };

    const syncedState = syncMemberTotalsFromDonors(nextStateWithContribution);
    const saved = await saveAppStateForRoulette(userId, syncedState);
    await publishSseEvent({
      type: "state_updated",
      userId,
      updatedAt: saved.state.updatedAt,
    });

    // 실시간 SSE 브로드캐스트
    await publishSseEvent({
      type: "zubzub_claimed",
      userId,
      queueItem: claimedQueue,
      memberId,
      memberName,
      bonusAmount: claimedQueue.bonusAmount,
      bonusDonor,
      contributionLog,
      remainingWaitingCount: currentWaitings.length,
      timestamp: Date.now(),
    });

    return { action: "claimed", queueItem: claimedQueue, bonusDonor, contributionLog };
  }
}

/**
 * 줍줍 건 수동 취소 또는 회수 (Rollback)
 */
export async function revertOrCancelZubzubQueue(
  userId: string,
  queueOrDonorId: string,
  state: AppState
): Promise<{ ok: boolean; newState?: AppState }> {
  const rawQueueId = String(queueOrDonorId || "").replace(/^zubzub_bonus_/, "").trim();
  const queueSuccess = await cancelZubzubQueueItem(userId, rawQueueId);

  // 이미 CLAIMED 되어 donors 에 들어간 경우 해당 bonus donor 제거
  const targetBonusId = `zubzub_bonus_${rawQueueId}`;
  const hadLegacyBonus = (state.donors || []).some(
    (d) => d.id === targetBonusId || d.zubzubQueueId === rawQueueId || d.id === queueOrDonorId
  );
  const hadContributionLog = (state.contributionLogs || []).some(
    (log) =>
      log.isZubzubBonus &&
      (log.id === targetBonusId ||
        log.zubzubQueueId === rawQueueId ||
        log.id === queueOrDonorId)
  );
  const hadBonus = hadLegacyBonus || hadContributionLog;

  if (!queueSuccess && !hadBonus) return { ok: false };

  let nextState = state;
  if (hadBonus) {
    const filteredDonors = (state.donors || []).filter(
      (d) => d.id !== targetBonusId && d.zubzubQueueId !== rawQueueId && d.id !== queueOrDonorId
    );
    const filteredLogs = (state.contributionLogs || []).filter(
      (log) =>
        !log.isZubzubBonus ||
        (log.id !== targetBonusId &&
          log.zubzubQueueId !== rawQueueId &&
          log.id !== queueOrDonorId)
    );
    nextState = syncMemberTotalsFromDonors({
      ...state,
      donors: filteredDonors,
      contributionLogs: filteredLogs,
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
    queueId: rawQueueId,
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
    if (!state) {
      console.log("[zubzub] skip=no_state", { userId });
      return null;
    }
    if (!isZubzubEnabled(state)) {
      console.log("[zubzub] skip=disabled", {
        userId,
        hasSettings: Boolean(state.zubzubSettings),
      });
      return null;
    }
    const enriched = await enrichDonationEventWithSigMatch(userId, event);
    return await processZubzubDonationHook(userId, enriched, state);
  } catch (err) {
    console.error("[zubzub] hook error:", err);
    return null;
  }
}

