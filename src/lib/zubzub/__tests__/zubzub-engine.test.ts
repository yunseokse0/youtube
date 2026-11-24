import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AppState, Member } from "@/types";
import type { DonationEvent } from "@/lib/donation/types";
import {
  isZubzubEnabled,
  findRepresentativeMember,
  isEligibleSigDonation,
  processZubzubDonationHook,
  revertOrCancelZubzubQueue,
} from "../zubzub-engine";
import {
  resetInMemoryZubZubQueueForTests,
  getInMemoryZubZubQueueForTests,
} from "../zubzub-repo";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";

// Mock saveAppStateForRoulette and publishSseEvent
vi.mock("@/app/api/roulette/edge-state-store", () => ({
  saveAppStateForRoulette: vi.fn(async (_uid, state) => ({ ok: true, state })),
}));

vi.mock("@/lib/sse-clients-hub", () => ({
  publishSseEvent: vi.fn(async () => {}),
}));

describe("대표 시그 줍줍(ZubZub) 엔진 및 원장 격리 테스트", () => {
  const userId = "test_user";

  const repMember: Member = {
    id: "m_rep",
    name: "자키(대표)",
    account: 100000,
    toon: 0,
    contribution: 100000,
  };

  const memberA: Member = {
    id: "m_jina",
    name: "진아",
    account: 50000,
    toon: 0,
    contribution: 50000,
  };

  const memberB: Member = {
    id: "m_surin",
    name: "수린",
    account: 30000,
    toon: 0,
    contribution: 30000,
  };

  let baseState: AppState;

  beforeEach(() => {
    resetInMemoryZubZubQueueForTests();
    baseState = {
      members: [repMember, memberA, memberB],
      memberPositions: {
        m_rep: "대표",
        m_jina: "부장",
        m_surin: "과장",
      },
      memberPositionMode: "fixed",
      donors: [],
      contributionLogs: [],
      sigInventory: [
        { id: "sig_1", name: "NO BATIDÃO", price: 130000 },
        { id: "sig_2", name: "러브다이브", price: 50000 },
      ] as any,
      zubzubSettings: {
        enabled: true,
        minSigPrice: 50000,
        priorityMode: "fifo",
        representativeMemberId: "m_rep",
      },
      zubzubWaitingItems: [],
    };
  });

  it("1. 줍줍 활성화 및 대표 식별이 정상 작동한다", () => {
    expect(isZubzubEnabled(baseState)).toBe(true);
    const rep = findRepresentativeMember(baseState);
    expect(rep?.id).toBe("m_rep");
    expect(rep?.name).toBe("자키(대표)");
  });

  it("2. 대표 시그니처 후원 발생 시 줍줍 큐에 WAITING으로 적재된다", async () => {
    const repSigEvent = {
      id: "evt_rep_1",
      donorName: "팬클럽회장",
      amount: 130000,
      memberId: "m_rep",
      at: new Date().toISOString(),
      matchedSigName: "NO BATIDÃO",
    } as any as DonationEvent;

    const result = await processZubzubDonationHook(userId, repSigEvent, baseState);
    expect(result.action).toBe("enqueued_waiting");

    if (result.action === "enqueued_waiting") {
      expect(result.queueItem.status).toBe("WAITING");
      expect(result.queueItem.bonusAmount).toBe(130000);
      expect(result.queueItem.sigName).toBe("NO BATIDÃO");
    }

    const waitings = getInMemoryZubZubQueueForTests(userId);
    expect(waitings.length).toBe(1);
    expect(waitings[0]?.status).toBe("WAITING");
  });

  it("3. 일반 멤버가 대표와 동일 금액(동일 시그) 후원 시 대기 중인 줍줍 큐를 획득한다", async () => {
    // 1) 먼저 대표 시그로 큐에 적재
    const repSigEvent = {
      id: "evt_rep_1",
      donorName: "팬클럽회장",
      amount: 130000,
      memberId: "m_rep",
      at: new Date().toISOString(),
      matchedSigName: "NO BATIDÃO",
    } as any as DonationEvent;
    await processZubzubDonationHook(userId, repSigEvent, baseState);

    // 2) 진아(memberA)에게 동일 금액 130,000원 시그 후원 발생
    const memberSigEvent = {
      id: "evt_jina_1",
      donorName: "진아팬",
      amount: 130000,
      memberId: "m_jina",
      at: new Date().toISOString(),
      matchedSigName: "NO BATIDÃO",
    } as any as DonationEvent;

    const claimResult = await processZubzubDonationHook(userId, memberSigEvent, baseState);
    expect(claimResult.action).toBe("claimed");

    if (claimResult.action === "claimed") {
      expect(claimResult.queueItem.status).toBe("CLAIMED");
      expect(claimResult.queueItem.claimedByMemberId).toBe("m_jina");
      expect(claimResult.bonusDonor.amount).toBe(130000); // 대표 시그 금액 복제
      expect(claimResult.bonusDonor.donationExcluded).toBe(true); // 실정산 현금 제외!
      expect(claimResult.bonusDonor.contributionPoints).toBe(130000); // 기여도 점수 반영!
    }

    // 3) 대기 큐 확인: 이제 WAITING 큐가 0개여야 함
    const remainingWaitings = getInMemoryZubZubQueueForTests(userId).filter(
      (x) => x.status === "WAITING"
    );
    expect(remainingWaitings.length).toBe(0);
  });

  it("3-1. 금액이 다른 일반 멤버 시그는 대기 건을 획득하지 못하고 그대로 남는다", async () => {
    // 대표 130,000원 대기 적재
    await processZubzubDonationHook(
      userId,
      {
        id: "evt_rep_x",
        donorName: "팬클럽회장",
        amount: 130000,
        memberId: "m_rep",
        at: new Date().toISOString(),
        matchedSigName: "NO BATIDÃO",
      } as any as DonationEvent,
      baseState
    );

    // 진아가 50,000원 시그 후원 → 금액 불일치로 미획득
    const mismatch = await processZubzubDonationHook(
      userId,
      {
        id: "evt_jina_x",
        donorName: "진아팬",
        amount: 50000,
        memberId: "m_jina",
        at: new Date().toISOString(),
        matchedSigName: "러브다이브",
      } as any as DonationEvent,
      baseState
    );
    expect(mismatch.action).toBe("skipped");
    if (mismatch.action === "skipped") expect(mismatch.reason).toBe("no_waiting_queue");

    // 대기 건은 그대로 WAITING 유지
    const waitings = getInMemoryZubZubQueueForTests(userId).filter(
      (x) => x.status === "WAITING"
    );
    expect(waitings.length).toBe(1);
    expect(waitings[0]?.bonusAmount).toBe(130000);
  });

  it("4. ⭐️ 중요: 복제 보너스는 현금 정산(account, toon)에 0원이며, 랭킹 기여도(contribution)에만 가산된다", () => {
    // 진아에게 130,000원의 ZUBZUB_BONUS Donor 수동 주입
    const bonusDonor: any = {
      id: "zubzub_bonus_test",
      name: "[대표 줍줍] NO BATIDÃO",
      amount: 130000,
      memberId: "m_jina",
      at: Date.now(),
      donationExcluded: true, // 현금 제외 플래그
      contributionPoints: 130000, // 기여도 점수
      isZubzubBonus: true,
    };

    const stateWithBonus = {
      ...baseState,
      donors: [bonusDonor],
    };

    const synced = syncMemberTotalsFromDonors(stateWithBonus);
    const jinaSynced = synced.members.find((m) => m.id === "m_jina");

    // 진아의 기존 account는 0원이어야 함 (bonusDonor가 현금 계좌 정산에 더해지지 않음)
    expect(jinaSynced?.account).toBe(0);
    expect(jinaSynced?.toon).toBe(0);

    // 진아의 기여도 점수에는 130,000점이 정확히 반영되어야 함!
    expect(jinaSynced?.contribution).toBe(130000);
  });

  it("5. 큐에 대기 중인 대표 시그가 없을 때 일반 멤버 시그는 줍줍 스킵된다", async () => {
    const memberSigEvent = {
      id: "evt_jina_2",
      donorName: "진아팬",
      amount: 50000,
      memberId: "m_jina",
      at: new Date().toISOString(),
      matchedSigName: "러브다이브",
    } as any as DonationEvent;

    const result = await processZubzubDonationHook(userId, memberSigEvent, baseState);
    expect(result.action).toBe("skipped");
    if (result.action === "skipped") {
      expect(result.reason).toBe("no_waiting_queue");
    }
  });

  it("6. 수동 취소(Rollback) 시 큐 상태가 CANCELED로 바뀌고 가상 도너가 제거된다", async () => {
    // 1) 큐 추가 및 획득
    const repSigEvent = {
      id: "evt_rep_1",
      donorName: "팬클럽회장",
      amount: 130000,
      memberId: "m_rep",
      at: new Date().toISOString(),
      matchedSigName: "NO BATIDÃO",
    } as any as DonationEvent;
    const enq = await processZubzubDonationHook(userId, repSigEvent, baseState);
    const queueId = (enq as any).queueItem.id;

    const memberSigEvent = {
      id: "evt_jina_1",
      donorName: "진아팬",
      amount: 130000,
      memberId: "m_jina",
      at: new Date().toISOString(),
      matchedSigName: "NO BATIDÃO",
    } as any as DonationEvent;
    const claimedRes = await processZubzubDonationHook(userId, memberSigEvent, baseState);
    const bonusDonor = (claimedRes as any).bonusDonor;

    const stateAfterClaim = {
      ...baseState,
      donors: [bonusDonor],
    };

    // 2) 관리자가 해당 건 취소(Revert)
    const revertRes = await revertOrCancelZubzubQueue(userId, queueId, stateAfterClaim);
    expect(revertRes.ok).toBe(true);
    expect(revertRes.newState?.donors?.length).toBe(0); // bonus donor 제거됨!

    const q = getInMemoryZubZubQueueForTests(userId).find((x) => x.id === queueId);
    expect(q?.status).toBe("CANCELED");
  });
});
