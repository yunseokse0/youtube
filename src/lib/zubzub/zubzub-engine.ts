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
  at = Date.now(),
  options?: {
    doubleContribution?: boolean;
    multiplier?: number;
    baseSigPrice?: number;
    isManualClaim?: boolean;
  }
): ContributionLog {
  const basePrice = Math.max(0, Math.round(Number(options?.baseSigPrice ?? amount) || 0));
  const mult = Math.max(
    1,
    Math.min(10, Math.round(Number(options?.multiplier ?? (options?.doubleContribution === false ? 1 : 2)) || 2))
  );
  const totalAmount = Math.max(0, Math.round(Number(amount) || 0));
  return {
    id: `zubzub_bonus_${queueId}`,
    memberId,
    amount: totalAmount,
    baseSigPrice: basePrice,
    multiplier: mult,
    delta: 1,
    donorName: "대표 시그 줍줍",
    note: `[대표 시그 줍줍] ${sigName} (+${totalAmount.toLocaleString()}점${mult > 1 ? ` [${mult}배 적용]` : ""})`,
    at,
    isZubzubBonus: true,
    zubzubQueueId: queueId,
    ...(options?.isManualClaim ? { isManualClaim: true } : {}),
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

/** 시그니처 후원 여부 및 정보 판별 (줍줍 전용: 단순 텍스트 후원은 줍줍 출력 차단, 시그가 있는 것만 허용) */
export function isEligibleSigDonation(
  event: DonationEvent,
  state: AppState,
  minPrice: number
): { isSig: boolean; sigName: string; sigImageUrl?: string } {
  const amount = Math.max(0, Math.round(Number(event.amount) || 0));
  if (amount < minPrice) {
    return { isSig: false, sigName: "" };
  }

  const inv = state.sigInventory || [];
  const msg = String(event.message || "").toLowerCase().replace(/\s+/g, "");

  // 1. isSigCredit: 룰렛/크레딧 등 시스템에서 이미 확정된 시그니처 당첨 건
  if ((event as { isSigCredit?: boolean }).isSigCredit) {
    const sigPrice = Math.max(0, Math.round(Number(event.sigPrice) || 0));
    const targetPrice = sigPrice > 0 ? sigPrice : amount;
    const candidates = inv.filter((item) => Math.round(Number(item.price) || 0) === targetPrice);
    const textMatches = candidates.filter((sig) => {
      const name = String(sig.name || "").toLowerCase().replace(/\s+/g, "");
      return name && msg.includes(name);
    });
    const sig =
      textMatches.length === 1
        ? textMatches[0]
        : candidates.length === 1
          ? candidates[0]
          : undefined;
    if (sig) {
      return { isSig: true, sigName: sig.name, sigImageUrl: sig.imageUrl || undefined };
    }
    const matchedSigName = String(event.matchedSigName || "").trim();
    if (matchedSigName) {
      return {
        isSig: true,
        sigName: matchedSigName,
        sigImageUrl: event.matchedSigImageUrl || undefined,
      };
    }
    return { isSig: false, sigName: "" };
  }

  // 2. 명시적 시그니처 플랫폼 페이로드 (투네이션 시그니처 탭 후원 등)
  if ((event as { isSignature?: boolean }).isSignature) {
    const matchedSigName = String(event.matchedSigName || "").trim();
    if (matchedSigName) {
      return {
        isSig: true,
        sigName: matchedSigName,
        sigImageUrl: event.matchedSigImageUrl || undefined,
      };
    }
    const priceMatches = inv.filter((sig) => Math.round(Number(sig.price) || 0) === amount);
    if (priceMatches.length === 1) {
      return {
        isSig: true,
        sigName: priceMatches[0]!.name,
        sigImageUrl: priceMatches[0]!.imageUrl || undefined,
      };
    }
  }

  // 3. 메시지에 실제 시그명이 포함되어 있는 경우 (시그 후원)
  if (inv.length > 0 && msg) {
    const textMatches = inv.filter((sig) => {
      const rawName = String(sig.name || "");
      const normName = rawName.toLowerCase().replace(/\s+/g, "");
      if (normName && msg.includes(normName)) return true;
      const stripped = normName
        .replace(/시그(니처)?/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .trim();
      if (stripped.length >= 2 && msg.includes(stripped)) return true;
      return false;
    });

    if (textMatches.length > 0) {
      // 금액과 일치하는 텍스트 매칭 시그 우선
      const priceAndTextMatches = textMatches.filter(
        (sig) => Math.round(Number(sig.price) || 0) === amount
      );
      if (priceAndTextMatches.length === 1) {
        return {
          isSig: true,
          sigName: priceAndTextMatches[0]!.name,
          sigImageUrl: priceAndTextMatches[0]!.imageUrl || undefined,
        };
      }
      if (textMatches.length === 1) {
        return {
          isSig: true,
          sigName: textMatches[0]!.name,
          sigImageUrl: textMatches[0]!.imageUrl || undefined,
        };
      }
    }
  }

  // 4. matchedSigName이 있는 경우:
  const matchedSigName = String(event.matchedSigName || "").trim();
  if (matchedSigName) {
    const normMatched = matchedSigName.toLowerCase().replace(/\s+/g, "");
    if (msg) {
      // 메시지가 존재하는 경우: 메시지에 실제 matchedSigName이 포함되어 있어야 시그로 인정!
      if (normMatched && msg.includes(normMatched)) {
        return {
          isSig: true,
          sigName: matchedSigName,
          sigImageUrl: event.matchedSigImageUrl || undefined,
        };
      }
      const stripped = normMatched
        .replace(/시그(니처)?/g, "")
        .replace(/\([^)]*\)/g, "")
        .replace(/\[[^\]]*\]/g, "")
        .trim();
      if (stripped.length >= 2 && msg.includes(stripped)) {
        return {
          isSig: true,
          sigName: matchedSigName,
          sigImageUrl: event.matchedSigImageUrl || undefined,
        };
      }
      // 메시지가 존재하지만 시그명이 포함되어 있지 않음 (예: "자키", "이나", "화이팅" 등)
      // -> 금액만으로 자동 추정된 단순 텍스트 후원이므로 줍줍 대상에서 제외!
      return { isSig: false, sigName: "" };
    }
    // 메시지가 아예 없는 경우:
    // 금액만으로 자동 추정(isAutoMatched)된 무메시지 후원이면 텍스트 후원이므로 제외!
    if ((event as { isAutoMatched?: boolean }).isAutoMatched) {
      return { isSig: false, sigName: "" };
    }
    // 테스트 등에서 mock 이벤트로 직접 matchedSigName을 부여한 경우 허용
    return {
      isSig: true,
      sigName: matchedSigName,
      sigImageUrl: event.matchedSigImageUrl || undefined,
    };
  }

  // 시그명이 전혀 없는 단순 텍스트/금액 후원은 줍줍 대상 제외
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

    const multiplier = Math.max(
      1,
      Math.min(
        10,
        Math.round(
          Number(state.zubzubSettings?.multiplier) ||
            (state.zubzubSettings?.doubleContribution === false ? 1 : 2)
        )
      )
    );
    const isDouble = multiplier > 1;
    const baseSigPrice = claimedQueue.bonusAmount;
    // 일반 멤버의 시그 후원 자체로 1배(baseSigPrice)가 이미 donors 원장에 기록되므로,
    // 총합 배율이 multiplier가 되도록 추가 지급하는 보너스 기여도는 baseSigPrice * (multiplier - 1) 입니다.
    // (예: 2배 설정 시 +1배 보너스 → 본인 후원 1배 + 보너스 1배 = 총 2배!)
    // (예: 3배 설정 시 +2배 보너스 → 본인 후원 1배 + 보너스 2배 = 총 3배!)
    // (예: 1배 설정 시 +0배 보너스 → 본인 후원 1배 + 보너스 0배 = 총 1배!)
    const bonusPoints = baseSigPrice * Math.max(0, multiplier - 1);

    const bonusDonor: Donor = {
      id: `zubzub_bonus_${claimedQueue.id}`,
      name: `[대표 줍줍] ${claimedQueue.sigName}`,
      donorName: `대표 시그 줍줍`,
      amount: claimedQueue.bonusAmount,
      memberId,
      at: Date.now(),
      message: `[대표 시그 줍줍] ${claimedQueue.sigName} (+${bonusPoints.toLocaleString()}점${multiplier > 1 ? ` [${multiplier}배 적용]` : ""})`,
      
      // 실정산 현금 합산 제외!
      donationExcluded: true,
      isSigCredit: true,
      sigPrice: baseSigPrice,
      contributionPoints: bonusPoints, // 랭킹 기여도 추가 보너스 점수
      zubzubMultiplier: multiplier,
      isZubzubBonus: true,
      zubzubQueueId: claimedQueue.id,
      provider: "zubzub_bonus",
      externalId: claimedQueue.id,
    };
    const contributionLog = createZubzubBonusContributionLog(
      claimedQueue.id,
      memberId,
      bonusPoints,
      claimedQueue.sigName,
      Date.now(),
      {
        doubleContribution: isDouble,
        multiplier,
        baseSigPrice,
        isManualClaim: false,
      }
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

