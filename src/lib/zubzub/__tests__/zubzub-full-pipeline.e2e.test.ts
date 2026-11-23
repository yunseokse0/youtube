import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AppState, Member, Donor } from "@/types";
import type { DonationEvent } from "@/lib/donation/types";
import {
  resetInMemoryZubZubQueueForTests,
  getInMemoryZubZubQueueForTests,
  listWaitingZubzubQueues,
  cancelAllWaitingZubzub,
} from "../zubzub-repo";
import {
  processZubzubDonationHook,
  revertOrCancelZubzubQueue,
  isZubzubEnabled,
  findRepresentativeMember,
} from "../zubzub-engine";
import { applyDonationToAppState } from "@/domain/contribution/apply-donation.usecases";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";
import { applySettlementResetToState } from "@/lib/settlement-reset-apply";

// Mock external persistence and SSE
vi.mock("@/app/api/roulette/edge-state-store", () => ({
  saveAppStateForRoulette: vi.fn(async (_uid, state) => ({ ok: true, state })),
}));

vi.mock("@/lib/sse-clients-hub", () => ({
  publishSseEvent: vi.fn(async () => {}),
}));

describe("🚀 로컬 후원 파이프라인 연계 줍줍 E2E 종합 시뮬레이션", () => {
  const userId = "test_streamer";

  let currentState: AppState;

  const jakiRep: Member = {
    id: "m_jaki",
    name: "자키",
    account: 0,
    toon: 0,
    contribution: 0,
    operating: false,
  };

  const jinaMember: Member = {
    id: "m_jina",
    name: "진아",
    account: 0,
    toon: 0,
    contribution: 0,
    operating: false,
  };

  const surinMember: Member = {
    id: "m_surin",
    name: "수린",
    account: 0,
    toon: 0,
    contribution: 0,
    operating: false,
  };

  beforeEach(() => {
    resetInMemoryZubZubQueueForTests();
    currentState = {
      members: [jakiRep, jinaMember, surinMember],
      memberPositions: {
        m_jaki: "대표",
        m_jina: "부장",
        m_surin: "과장",
      },
      memberPositionMode: "fixed",
      donors: [],
      contributionLogs: [],
      sigInventory: [
        { id: "sig_1", name: "NO BATIDÃO", price: 130000 },
        { id: "sig_2", name: "러브다이브", price: 50000 },
      ],
      zubzubSettings: {
        enabled: true,
        minSigPrice: 50000,
        priorityMode: "fifo",
        representativeMemberId: "m_jaki",
      },
      zubzubWaitingItems: [],
    };
  });

  it("Step 1: 후원 유입 파이프라인 및 대표 시그 줍줍 대기(WAITING) 적재 시뮬레이션", async () => {
    // [후원 1] 대표(자키)에게 130,000원 'NO BATIDÃO' 시그 후원 인제스트 발생
    const repDonationEvent: DonationEvent = {
      id: "evt_rep_batidao",
      donorName: "자키회장",
      amount: 130000,
      memberId: "m_jaki",
      target: "account",
      at: new Date().toISOString(),
      message: "자키 대표님 NO BATIDÃO 가자!",
      matchedSigName: "NO BATIDÃO",
    };

    // 1. 기존 후원 적립 처리 (원장 반영)
    const applyRes = applyDonationToAppState(currentState, repDonationEvent);
    expect(applyRes.ok).toBe(true);
    if (!applyRes.ok) return;
    currentState = applyRes.state;

    // 대표의 현금 계좌 정산금 및 기여도 130,000원 정상 적립 확인
    const jakiAfter = currentState.members.find((m) => m.id === "m_jaki");
    expect(jakiAfter?.account).toBe(130000);
    expect(jakiAfter?.contribution).toBe(130000);

    // 2. 줍줍 판정 훅 실행
    const zubzubRes = await processZubzubDonationHook(userId, repDonationEvent, currentState);
    expect(zubzubRes.action).toBe("enqueued_waiting");

    if (zubzubRes.action === "enqueued_waiting") {
      expect(zubzubRes.queueItem.status).toBe("WAITING");
      expect(zubzubRes.queueItem.sigName).toBe("NO BATIDÃO");
      expect(zubzubRes.queueItem.bonusAmount).toBe(130000);
    }

    // 3. 큐 대기 상태 확인
    const waitings = await listWaitingZubzubQueues(userId);
    expect(waitings.length).toBe(1);
    expect(waitings[0]?.sigName).toBe("NO BATIDÃO");
    expect(waitings[0]?.bonusAmount).toBe(130000);
  });

  it("Step 2: 일반 멤버 시그 후원 유입 → 선착순 줍줍(CLAIMED) 및 현금/기여도 원장 격리 검증", async () => {
    // 1) 선행 조건: 대표 시그 130,000원 대기열 적재
    const repDonationEvent: DonationEvent = {
      id: "evt_rep_batidao",
      donorName: "자키회장",
      amount: 130000,
      memberId: "m_jaki",
      target: "account",
      at: new Date().toISOString(),
      matchedSigName: "NO BATIDÃO",
    };
    const repApply = applyDonationToAppState(currentState, repDonationEvent);
    if (repApply.ok) currentState = repApply.state;
    await processZubzubDonationHook(userId, repDonationEvent, currentState);

    // 2) 진아(m_jina)에게 50,000원 '러브다이브' 시그 후원 인제스트 발생
    const jinaDonationEvent: DonationEvent = {
      id: "evt_jina_lovedive",
      donorName: "진아수호대",
      amount: 50000,
      memberId: "m_jina",
      target: "account",
      at: new Date().toISOString(),
      message: "진아 러브다이브 가자!",
      matchedSigName: "러브다이브",
    };

    // 진아의 실제 후원 적립
    const jinaApply = applyDonationToAppState(currentState, jinaDonationEvent);
    expect(jinaApply.ok).toBe(true);
    if (jinaApply.ok) currentState = jinaApply.state;

    // 3) 줍줍 판정 훅 실행 (진아의 시그로 줍줍 매칭!)
    const claimRes = await processZubzubDonationHook(userId, jinaDonationEvent, currentState);
    expect(claimRes.action).toBe("claimed");

    if (claimRes.action === "claimed") {
      expect(claimRes.queueItem.status).toBe("CLAIMED");
      expect(claimRes.queueItem.claimedByMemberId).toBe("m_jina");
      expect(claimRes.bonusDonor.donationExcluded).toBe(true); // 현금 제외!
      expect(claimRes.bonusDonor.contributionPoints).toBe(130000); // 기여도 반영!

      // 상태에 보너스 도너 반영 후 멤버 정산 동기화
      currentState = syncMemberTotalsFromDonors({
        ...currentState,
        donors: [...currentState.donors, claimRes.bonusDonor],
      });
    }

    // ⭐️ 4. 원장 격리 핵심 검증:
    const jaki = currentState.members.find((m) => m.id === "m_jaki");
    const jina = currentState.members.find((m) => m.id === "m_jina");

    // 현금 정산(account):
    // - 자키: 130,000원 (본인 실제 입금액)
    // - 진아: 50,000원 (본인 실제 입금액, 130,000원 줍줍은 가상이므로 현금 0원!)
    expect(jaki?.account).toBe(130000);
    expect(jina?.account).toBe(50000);

    // 랭킹 기여도(contribution):
    // - 자키: 130,000점
    // - 진아: 180,000점 (50,000점 + 130,000점 줍줍 복제 보너스!)
    expect(jaki?.contribution).toBe(130000);
    expect(jina?.contribution).toBe(180000);

    // 5. 큐 소진 확인: WAITING 큐가 0개여야 함
    const remainingWaitings = await listWaitingZubzubQueues(userId);
    expect(remainingWaitings.length).toBe(0);
  });

  it("Step 3: 큐 소진 후 다음 멤버 시그 발생 시 추가 보너스 없이 정상 스킵 검증", async () => {
    // 1) 진아가 이미 줍줍을 가져가서 큐가 비어있는 상태에서
    // 수린(m_surin)에게 50,000원 '러브다이브' 시그 후원 발생
    const surinDonationEvent: DonationEvent = {
      id: "evt_surin_lovedive",
      donorName: "수린팬",
      amount: 50000,
      memberId: "m_surin",
      target: "account",
      at: new Date().toISOString(),
      matchedSigName: "러브다이브",
    };

    const surinApply = applyDonationToAppState(currentState, surinDonationEvent);
    if (surinApply.ok) currentState = surinApply.state;

    // 줍줍 훅 실행
    const skipRes = await processZubzubDonationHook(userId, surinDonationEvent, currentState);
    expect(skipRes.action).toBe("skipped");
    if (skipRes.action === "skipped") {
      expect(skipRes.reason).toBe("no_waiting_queue");
    }

    // 수린은 본인 50,000원만 정상 반영
    const surin = currentState.members.find((m) => m.id === "m_surin");
    expect(surin?.account).toBe(50000);
    expect(surin?.contribution).toBe(50000);
  });

  it("Step 4: 관리자 수동 취소(Rollback) 시 가상 보너스 즉시 회수 검증", async () => {
    // 1) 큐 추가 및 진아 획득 시뮬레이션
    const repEvt: DonationEvent = {
      id: "evt_rep_1",
      donorName: "팬",
      amount: 130000,
      memberId: "m_jaki",
      matchedSigName: "NO BATIDÃO",
    };
    const enq = await processZubzubDonationHook(userId, repEvt, currentState);
    const queueId = (enq as any).queueItem.id;

    const jinaEvt: DonationEvent = {
      id: "evt_jina_1",
      donorName: "팬2",
      amount: 50000,
      memberId: "m_jina",
      matchedSigName: "러브다이브",
    };
    const claimedRes = await processZubzubDonationHook(userId, jinaEvt, currentState);
    const bonusDonor = (claimedRes as any).bonusDonor;

    currentState = syncMemberTotalsFromDonors({
      ...currentState,
      donors: [bonusDonor],
    });

    expect(currentState.members.find((m) => m.id === "m_jina")?.contribution).toBe(130000);

    // 2) 관리자가 해당 큐 건을 취소 (Revert)
    const revertRes = await revertOrCancelZubzubQueue(userId, queueId, currentState);
    expect(revertRes.ok).toBe(true);
    if (revertRes.newState) currentState = revertRes.newState;

    // 보너스 도너가 제거되어 진아의 기여도가 0으로 정상 롤백됨
    expect(currentState.members.find((m) => m.id === "m_jina")?.contribution).toBe(0);
    expect(currentState.donors.length).toBe(0);
  });

  it("Step 5: 정산 리셋(Settlement Reset) 시 미수령 줍줍 대기열 일괄 자동 취소 검증", async () => {
    // 1) 대표 시그 130,000원 유입으로 큐에 1건 대기 중
    const repEvt: DonationEvent = {
      id: "evt_rep_reset_test",
      donorName: "팬",
      amount: 130000,
      memberId: "m_jaki",
      matchedSigName: "NO BATIDÃO",
    };
    await processZubzubDonationHook(userId, repEvt, currentState);

    let waitings = await listWaitingZubzubQueues(userId);
    expect(waitings.length).toBe(1);

    // 2) 방송 종료 / 회차 정산 리셋 실행
    const resetTime = Date.now();
    const resetState = applySettlementResetToState(currentState, {
      mode: "keep",
      resetAt: resetTime,
    });
    const canceledCount = await cancelAllWaitingZubzub(userId);

    expect(canceledCount).toBe(1);
    expect(resetState.zubzubWaitingItems?.length).toBe(0);

    // 3) 리셋 후 대기열이 0건으로 완전 초기화되었는지 검증
    waitings = await listWaitingZubzubQueues(userId);
    expect(waitings.length).toBe(0);
  });
});
