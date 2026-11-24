import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AppState, ContributionLog, Donor, Member } from "@/types";
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
  claimEarliestWaitingZubzub,
  insertZubzubQueueItem,
} from "../zubzub-repo";
import {
  applyOverlayDonationDisplayTotals,
  collectDay777SigContributionByMember,
} from "@/lib/overlay-donation-aggregate";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";

vi.mock("@/app/api/roulette/edge-state-store", () => ({
  saveAppStateForRoulette: vi.fn(async (_uid: string, state: AppState) => ({ ok: true, state })),
}));

vi.mock("@/lib/sse-clients-hub", () => ({
  publishSseEvent: vi.fn(async () => {}),
}));

const userId = "audit_user";

const repMember: Member = { id: "m_rep", name: "자키", account: 0, toon: 0, contribution: 0 };
const memberA: Member = { id: "m_jina", name: "진아", account: 0, toon: 0, contribution: 0 };
const memberB: Member = { id: "m_surin", name: "수린", account: 0, toon: 0, contribution: 0 };

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    members: [repMember, memberA, memberB],
    memberPositions: { m_rep: "대표", m_jina: "부장", m_surin: "과장" },
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
    ...overrides,
  } as AppState;
}

function makeEvent(overrides: Partial<DonationEvent>): DonationEvent {
  return {
    id: "evt_default",
    donorName: "후원자",
    amount: 130000,
    memberId: "m_rep",
    at: new Date().toISOString(),
    ...overrides,
  } as unknown as DonationEvent;
}

beforeEach(() => {
  resetInMemoryZubZubQueueForTests();
});

describe("[AUDIT] 줍줍 - 대표 멤버 식별 경계값", () => {
  it("설정에 지정된 대표가 유효하면 그 멤버를 반환한다", () => {
    const state = makeState();
    expect(findRepresentativeMember(state)?.id).toBe("m_rep");
  });

  it("설정 대표 ID가 무효하면 직급 '대표' 멤버로 폴백한다", () => {
    const state = makeState({
      zubzubSettings: { enabled: true, minSigPrice: 0, representativeMemberId: "m_ghost" },
      memberPositions: { m_jina: "대표", m_rep: "부장" },
    } as any);
    expect(findRepresentativeMember(state)?.id).toBe("m_jina");
  });

  it("'부대표'는 대표로 오인하지 않는다", () => {
    const state = makeState({
      zubzubSettings: { enabled: true, minSigPrice: 0 },
      memberPositions: { m_jina: "부대표", m_surin: "과장" },
      members: [memberA, memberB],
    } as any);
    // 대표 직급이 없으므로 첫 번째 멤버로 폴백 (부대표를 대표로 승격하지 않음)
    expect(findRepresentativeMember(state)?.id).toBe("m_jina"); // 첫 멤버 폴백
    // 부대표만 있는데 첫 멤버가 부대표인 경우에도 "대표 판정"으로 뽑힌 게 아님을 보장
    const state2 = makeState({
      zubzubSettings: { enabled: true, minSigPrice: 0 },
      memberPositions: { m_surin: "과장", m_jina: "부대표" },
      members: [memberB, memberA],
    } as any);
    expect(findRepresentativeMember(state2)?.id).toBe("m_surin"); // 첫 멤버
  });
});

describe("[AUDIT] 줍줍 - 시그 후원 판정 경계값", () => {
  it("금액이 최소 시그 금액 미만이면 matchedSigName이 있어도 시그로 인정하지 않는다", () => {
    const state = makeState();
    const res = isEligibleSigDonation(
      makeEvent({ amount: 49999, matchedSigName: "러브다이브" }),
      state,
      50000
    );
    expect(res.isSig).toBe(false);
  });

  it("금액이 최소 시그 금액과 정확히 같으면 시그로 인정한다", () => {
    const state = makeState();
    const res = isEligibleSigDonation(
      makeEvent({ amount: 50000, matchedSigName: "러브다이브" }),
      state,
      50000
    );
    expect(res.isSig).toBe(true);
    expect(res.sigName).toBe("러브다이브");
  });

  it("최소 금액이 0이고 시그 정보가 없으면 일반 후원은 시그로 인정하지 않는다", () => {
    const state = makeState({ sigInventory: [] });
    const res = isEligibleSigDonation(
      makeEvent({ amount: 100000, matchedSigName: undefined as any, message: "일반응원" }),
      state,
      0
    );
    expect(res.isSig).toBe(false);
  });

  it("시그 인벤토리 단가와 금액이 일치하면 시그로 인정한다", () => {
    const state = makeState();
    const res = isEligibleSigDonation(makeEvent({ amount: 50000 }), state, 0);
    expect(res.isSig).toBe(true);
    expect(res.sigName).toBe("러브다이브");
  });

  it("최소 금액 이상이어도 시그 정보가 없으면 메시지를 시그명으로 만들지 않는다", async () => {
    const state = makeState({
      sigInventory: [],
      zubzubSettings: { enabled: true, minSigPrice: 10000, representativeMemberId: "m_rep" },
    });
    const event = makeEvent({
      amount: 10000,
      message: "미션: 10킬 달성",
      matchedSigName: undefined,
    });

    expect(isEligibleSigDonation(event, state, 10000)).toEqual({
      isSig: false,
      sigName: "",
    });
    const result = await processZubzubDonationHook(userId, event, state);
    expect(result).toMatchObject({ action: "skipped", reason: "not_a_sig_donation" });
    expect(getInMemoryZubZubQueueForTests(userId)).toHaveLength(0);
  });

  it("isSigCredit만으로는 임의 메시지를 시그명으로 만들지 않는다", () => {
    const state = makeState({ sigInventory: [] });
    expect(
      isEligibleSigDonation(
        makeEvent({
          amount: 10000,
          message: "미션: 10킬 달성",
          isSigCredit: true,
          sigPrice: 10000,
          matchedSigName: undefined,
        }),
        state,
        0
      )
    ).toEqual({ isSig: false, sigName: "" });
  });

  it("같은 단가 시그가 여러 개면 메시지로 하나가 특정될 때만 인정한다", () => {
    const state = makeState({
      sigInventory: [
        { id: "sig_a", name: "시그 A", price: 10000 },
        { id: "sig_b", name: "시그 B", price: 10000 },
      ] as any,
    });
    expect(
      isEligibleSigDonation(makeEvent({ amount: 10000, message: "미션: 10킬 달성" }), state, 0)
    ).toMatchObject({ isSig: false, sigName: "" });
    expect(
      isEligibleSigDonation(makeEvent({ amount: 10000, message: "시그 B 부탁" }), state, 0)
    ).toMatchObject({ isSig: true, sigName: "시그 B" });
  });
});

describe("[AUDIT] 줍줍 - FIFO 적재/획득 순서", () => {
  it("대기열 배열 순서와 createdAt 순서가 다르면 createdAt이 가장 이른 건을 획득한다", async () => {
    await insertZubzubQueueItem(userId, {
      id: "q_a",
      triggerDonationId: "ta",
      sigName: "A",
      bonusAmount: 1000,
    });
    await insertZubzubQueueItem(userId, {
      id: "q_b",
      triggerDonationId: "tb",
      sigName: "B",
      bonusAmount: 2000,
    });

    const arr = getInMemoryZubZubQueueForTests(userId);
    // 배열 순서(삽입 순)와 생성 시각을 의도적으로 뒤집는다 (스냅샷 복원/시계 오차 시나리오)
    arr.find((x) => x.id === "q_a")!.createdAt = 5000;
    arr.find((x) => x.id === "q_b")!.createdAt = 1000;

    const claimed = await claimEarliestWaitingZubzub(userId, "m_jina", "d_x");
    expect(claimed?.id).toBe("q_b");
  });

  it("일반 적재 순서(대표→대표)에서는 먼저 넣은 건이 먼저 획득된다", async () => {
    const first = await insertZubzubQueueItem(userId, {
      id: "q1",
      triggerDonationId: "t1",
      sigName: "A",
      bonusAmount: 1000,
    });
    await new Promise((r) => setTimeout(r, 2));
    await insertZubzubQueueItem(userId, {
      id: "q2",
      triggerDonationId: "t2",
      sigName: "B",
      bonusAmount: 2000,
    });

    const claimed = await claimEarliestWaitingZubzub(userId, "m_jina", "d_x");
    expect(claimed?.id).toBe(first.id);
  });
});

describe("[AUDIT] 줍줍 - 전체 흐름 및 롤백 경계값", () => {
  it("비활성 상태에서는 훅이 스킵된다", async () => {
    const state = makeState({ zubzubSettings: { enabled: false, minSigPrice: 0 } } as any);
    expect(isZubzubEnabled(state)).toBe(false);
    const res = await processZubzubDonationHook(userId, makeEvent({}), state);
    expect(res.action).toBe("skipped");
    if (res.action === "skipped") expect(res.reason).toBe("zubzub_disabled");
  });

  it("memberId가 없으면 스킵된다", async () => {
    const state = makeState();
    const res = await processZubzubDonationHook(userId, makeEvent({ memberId: "" }), state);
    expect(res.action).toBe("skipped");
    if (res.action === "skipped") expect(res.reason).toBe("no_member_id");
  });

  it("아직 획득되지 않은(WAITING) 건만 취소해도 성공하고 donors는 변하지 않는다", async () => {
    const enq = await processZubzubDonationHook(
      userId,
      makeEvent({ id: "e1", memberId: "m_rep", amount: 130000, matchedSigName: "NO BATIDÃO" }),
      makeState()
    );
    const queueId = (enq as any).queueItem.id as string;

    const state = makeState();
    const revert = await revertOrCancelZubzubQueue(userId, queueId, state);
    expect(revert.ok).toBe(true);
    expect(revert.newState?.donors?.length).toBe(0);
    const q = getInMemoryZubZubQueueForTests(userId).find((x) => x.id === queueId);
    expect(q?.status).toBe("CANCELED");
  });

  it("두 번째 일반 멤버 시그는 남은 대기 건이 없으면 스킵된다", async () => {
    await processZubzubDonationHook(
      userId,
      makeEvent({ id: "e1", memberId: "m_rep", amount: 130000, matchedSigName: "NO BATIDÃO" }),
      makeState()
    );
    const claim1 = await processZubzubDonationHook(
      userId,
      makeEvent({ id: "e2", memberId: "m_jina", amount: 130000, matchedSigName: "NO BATIDÃO" }),
      makeState()
    );
    expect(claim1.action).toBe("claimed");

    const claim2 = await processZubzubDonationHook(
      userId,
      makeEvent({ id: "e3", memberId: "m_surin", amount: 130000, matchedSigName: "NO BATIDÃO" }),
      makeState()
    );
    expect(claim2.action).toBe("skipped");
    if (claim2.action === "skipped") expect(claim2.reason).toBe("no_waiting_queue");
  });

  it("금액이 다른 일반 멤버 시그는 대기 건을 획득하지 못한다", async () => {
    await processZubzubDonationHook(
      userId,
      makeEvent({ id: "e1", memberId: "m_rep", amount: 130000, matchedSigName: "NO BATIDÃO" }),
      makeState()
    );
    const mismatch = await processZubzubDonationHook(
      userId,
      makeEvent({ id: "e2", memberId: "m_jina", amount: 50000, matchedSigName: "러브다이브" }),
      makeState()
    );
    expect(mismatch.action).toBe("skipped");
    if (mismatch.action === "skipped") expect(mismatch.reason).toBe("no_waiting_queue");

    const waitings = getInMemoryZubZubQueueForTests(userId).filter((x) => x.status === "WAITING");
    expect(waitings.length).toBe(1);
    expect(waitings[0]?.bonusAmount).toBe(130000);
  });
});

describe("[AUDIT] 줍줍 보너스 ↔ 퐁당퐁당 기여도 일관성", () => {
  const bonusDonor: Donor = {
    id: "zubzub_bonus_q1",
    name: "[대표 줍줍] 하트시그",
    donorName: "대표 시그 줍줍",
    amount: 130000,
    memberId: "m_jina",
    at: 1_700_000_000_000,
    donationExcluded: true,
    isSigCredit: true,
    sigPrice: 130000,
    contributionPoints: 130000,
    isZubzubBonus: true,
    zubzubQueueId: "q1",
    provider: "zubzub_bonus",
    externalId: "q1",
  };

  it("현금 정산에서는 0, 랭킹 기여도에는 전액 반영된다", () => {
    const synced = syncMemberTotalsFromDonors(makeState({ donors: [bonusDonor] }));
    const m = synced.members.find((x) => x.id === "m_jina");
    expect(m?.account).toBe(0);
    expect(m?.toon).toBe(0);
    expect(m?.contribution).toBe(130000);
  });

  it("퐁당퐁당 기여도(day777)에 줍줍 보너스가 포함되고 마이너스 처리 시 차감된다", () => {
    const base = makeState({ donors: [bonusDonor] });
    expect(collectDay777SigContributionByMember(base).get("m_jina")).toBe(130000);

    const minusState = makeState({ donors: [{ ...bonusDonor, pongdangMinus: true }] });
    expect(collectDay777SigContributionByMember(minusState).get("m_jina")).toBe(-130000);
  });

  it("ignorePongdangMinus=true(메인 엑셀표)면 줍줍 보너스 마이너스를 무시하고 (+)로 합산한다", () => {
    const minusState = makeState({ donors: [{ ...bonusDonor, pongdangMinus: true }] });
    const map = collectDay777SigContributionByMember(minusState, null, {
      ignorePongdangMinus: true,
    });
    expect(map.get("m_jina")).toBe(130000);
  });
});

describe("[AUDIT] 퐁당퐁당 - 마이너스 로그 및 자동배정 제외", () => {
  const minusLog: ContributionLog = {
    id: "cl_pd_audit_1",
    memberId: "m_jina",
    donorName: "관리자 수동",
    amount: 10000,
    delta: -1,
    note: "퐁당퐁당 수동 차감",
    at: 1_700_000_000_000,
    ...({ isPongdang: true } as any),
  };

  it("ignorePongdangMinus=true면 퐁당 마이너스 로그를 합산에서 제외한다", () => {
    const state = makeState({ contributionLogs: [minusLog] });
    const withIgnore = collectDay777SigContributionByMember(state, null, {
      ignorePongdangMinus: true,
    });
    expect(withIgnore.get("m_jina")).toBeUndefined();

    const withoutIgnore = collectDay777SigContributionByMember(state, null, {
      ignorePongdangMinus: false,
    });
    expect(withoutIgnore.get("m_jina")).toBe(-10000);
  });

  it("자동 임의 배정(memberAutoAssigned) 후원은 퐁당 기여도에서 제외한다", () => {
    const autoDonor: Donor = {
      id: "d_auto",
      name: "후원자",
      amount: 50000,
      memberId: "m_jina",
      at: 1_700_000_000_000,
      sigPrice: 50000,
      isSigCredit: true,
      memberAutoAssigned: true,
    };
    const state = makeState({ donors: [autoDonor] });
    expect(collectDay777SigContributionByMember(state).get("m_jina")).toBeUndefined();
  });

  it("오버레이는 음수 기여도를 0으로, 팝업창은 음수를 그대로 표시한다", () => {
    const donor: Donor = {
      id: "d_minus",
      name: "후원자",
      amount: 50000,
      memberId: "m_jina",
      at: 1_700_000_000_000,
      sigPrice: 50000,
      isSigCredit: true,
      pongdangMinus: true,
    };
    const state = makeState({ donors: [donor] });
    const overlay = applyOverlayDonationDisplayTotals(state, { day777Calc: true });
    expect(overlay.members.find((m) => m.id === "m_jina")?.contribution).toBe(0);

    const popup = applyOverlayDonationDisplayTotals(state, {
      day777Calc: true,
      isPongdangPopup: true,
    });
    expect(popup.members.find((m) => m.id === "m_jina")?.contribution).toBe(-50000);
  });
});
