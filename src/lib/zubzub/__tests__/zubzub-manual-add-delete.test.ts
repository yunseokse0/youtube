import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/roulette/edge-state-store", () => ({
  saveAppStateForRoulette: vi.fn(async (_uid, state) => ({ ok: true, state })),
}));
vi.mock("@/lib/sse-clients-hub", () => ({
  publishSseEvent: vi.fn(async () => {}),
}));

import type { AppState, Member, Donor } from "@/types";
import {
  revertOrCancelZubzubQueue,
} from "../zubzub-engine";
import {
  insertZubzubQueueItem,
  listWaitingZubzubQueues,
  resetInMemoryZubZubQueueForTests,
} from "../zubzub-repo";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";

describe("줍줍 수동 추가 및 회수/삭제 기능 테스트", () => {
  const userId = "test_user_jubjub_manual";

  const initialMembers: Member[] = [
    { id: "m_rep", name: "대표", account: 0, toon: 0, contribution: 0 },
    { id: "m_member1", name: "멤버1", account: 0, toon: 0, contribution: 0 },
    { id: "m_member2", name: "멤버2", account: 0, toon: 0, contribution: 0 },
  ];

  beforeEach(() => {
    resetInMemoryZubZubQueueForTests(userId);
  });

  it("1. 줍줍 대기열에 수동으로 항목을 추가할 수 있다", async () => {
    const queueItem = await insertZubzubQueueItem(userId, {
      id: "manual_q_001",
      triggerDonationId: "manual_trigger_1",
      sigName: "수동 등록 시그",
      bonusAmount: 80000,
    });

    expect(queueItem.id).toBe("manual_q_001");
    expect(queueItem.bonusAmount).toBe(80000);
    expect(queueItem.status).toBe("WAITING");

    const waitings = await listWaitingZubzubQueues(userId);
    expect(waitings.length).toBe(1);
    expect(waitings[0].sigName).toBe("수동 등록 시그");
    expect(waitings[0].bonusAmount).toBe(80000);
  });

  it("2. 대기 중인 줍줍 대기열 항목을 취소(삭제)할 수 있다", async () => {
    await insertZubzubQueueItem(userId, {
      id: "manual_q_002",
      triggerDonationId: "manual_trigger_2",
      sigName: "취소할 시그",
      bonusAmount: 50000,
    });

    const state: AppState = {
      members: initialMembers,
      donors: [],
      zubzubWaitingItems: await listWaitingZubzubQueues(userId),
    } as any;

    const cancelRes = await revertOrCancelZubzubQueue(userId, "manual_q_002", state);
    expect(cancelRes.ok).toBe(true);

    const waitingsAfter = await listWaitingZubzubQueues(userId);
    expect(waitingsAfter.length).toBe(0);
  });

  it("3. 이미 멤버에게 지급되어 쌓인 줍줍 보너스를 회수/삭제하고 멤버 기여도를 정상 롤백할 수 있다", async () => {
    const queueId = "claimed_q_003";
    const bonusDonor: Donor = {
      id: `zubzub_bonus_${queueId}`,
      name: "[대표 줍줍] NO BATIDÃO",
      donorName: "대표 시그 줍줍",
      amount: 130000,
      memberId: "m_member1",
      at: Date.now(),
      message: "[대표 시그 줍줍] NO BATIDÃO (+130,000점)",
      donationExcluded: true,
      isSigCredit: true,
      sigPrice: 130000,
      contributionPoints: 130000,
      isZubzubBonus: true,
      zubzubQueueId: queueId,
    };

    // 초기 상태: 멤버1에게 130,000점 보너스가 반영된 상태
    const stateWithBonus: AppState = syncMemberTotalsFromDonors({
      members: initialMembers,
      donors: [bonusDonor],
      zubzubWaitingItems: [],
    } as any);

    const m1Before = stateWithBonus.members.find((m) => m.id === "m_member1");
    expect(m1Before?.contribution).toBe(130000);

    // 회수/삭제 실행 (donor.id 또는 queueId 전달)
    const revertRes = await revertOrCancelZubzubQueue(userId, `zubzub_bonus_${queueId}`, stateWithBonus);
    expect(revertRes.ok).toBe(true);

    // 회수 후 검증: donors 목록에서 제거되고 멤버1의 기여도가 0으로 원상 복구됨
    const nextState = revertRes.newState!;
    expect(nextState.donors.length).toBe(0);
    const m1After = nextState.members.find((m) => m.id === "m_member1");
    expect(m1After?.contribution).toBe(0);
  });
});
