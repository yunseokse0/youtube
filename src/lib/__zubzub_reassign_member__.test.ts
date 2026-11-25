import { describe, it, expect } from "vitest";
import { reassignDonorMemberInAppState } from "@/domain/contribution/apply-donation.usecases";
import { collectDay777SigContributionByMember } from "@/lib/overlay-donation-aggregate";
import { collectPongdangPopupAutoContributionByMember } from "@/lib/pongdang-popup-contribution";
import type { AppState, Donor, Member, ContributionLog } from "@/types";

describe("줍줍 후원 멤버 교체 시 기여도 동시 이전 및 퐁당퐁당/오버레이 집계 검증", () => {
  const members: Member[] = [
    { id: "m_jina", name: "진아", contribution: 50000, account: 50000, toon: 0 },
    { id: "m_surin", name: "수린", contribution: 0, account: 0, toon: 0 },
    { id: "m_chaeyoung", name: "채영", contribution: 0, account: 0, toon: 0 },
  ];

  it("1. 후원 멤버 교체 시 해당 후원과 연동된 줍줍 기여도 로그가 새 멤버로 함께 이전된다", () => {
    const originalDonation: Donor = {
      id: "don_123",
      name: "비비",
      donorName: "비비",
      amount: 50000,
      memberId: "m_jina",
      at: 1000000,
      target: "account",
      sigPrice: 50000,
      claimedZubzubQueueId: "queue_999",
    };

    const zubzubLog: ContributionLog = {
      id: "zubzub_bonus_queue_999",
      memberId: "m_jina",
      amount: 50000,
      baseSigPrice: 50000,
      multiplier: 2,
      delta: 1,
      at: 1000050,
      isZubzubBonus: true,
      zubzubQueueId: "queue_999",
      claimedDonationId: "don_123",
    };

    const baseState: AppState = {
      members,
      donors: [originalDonation],
      contributionLogs: [zubzubLog],
      zubzubWaitingItems: [
        {
          id: "queue_999",
          userId: "zakiexcel",
          sigName: "진아 시그",
          sigIndex: 1,
          bonusAmount: 50000,
          status: "CLAIMED",
          claimedByMemberId: "m_jina",
          claimedDonationId: "don_123",
          enqueuedAt: 999900,
          claimedAt: 1000050,
        },
      ],
      zubzubSettings: {
        enabled: true,
        multiplier: 2,
        applyContributionToPongdang: true,
        applyDoubleContributionToPongdang: true,
      },
    };

    // 진아 -> 수린으로 멤버 교체
    const reassigned = reassignDonorMemberInAppState(baseState, "don_123", "m_surin");
    expect(reassigned).not.toBeNull();
    if (!reassigned) return;

    // A. 원본 후원 멤버 변경 확인
    const updatedDonor = reassigned.donors?.find((d) => d.id === "don_123");
    expect(updatedDonor?.memberId).toBe("m_surin");

    // B. 줍줍 기여도 로그도 수린으로 이전되었는지 확인
    const updatedLog = reassigned.contributionLogs?.find((l) => l.zubzubQueueId === "queue_999");
    expect(updatedLog?.memberId).toBe("m_surin");
    expect(updatedLog?.claimedDonationId).toBe("don_123");

    // C. 줍줍 대기/획득 아이템의 claimedByMemberId 도 수린으로 이전되었는지 확인
    const updatedQueueItem = reassigned.zubzubWaitingItems?.find((q) => q.id === "queue_999");
    expect(updatedQueueItem?.claimedByMemberId).toBe("m_surin");

    // D. 퐁당퐁당 자동 집계(popupAuto)에서 수린에게 기여도가 반영되고 진아는 0이 되는지 확인
    const popupMap = collectPongdangPopupAutoContributionByMember(reassigned);
    expect(popupMap.get("m_surin")).toBe(100000); // 50,000 (시그) + 50,000 (줍줍 2배 보너스) = 100,000
    expect(popupMap.get("m_jina")).toBeUndefined();

    // E. 777 시그 오버레이 집계에서도 수린에게 100,000이 반영되는지 확인
    const day777Map = collectDay777SigContributionByMember(reassigned);
    expect(day777Map.get("m_surin")).toBe(100000);
    expect(day777Map.get("m_jina")).toBeUndefined();
  });

  it("2. 퐁당퐁당 건별 내역에서 줍줍 보너스 행(zubzub_bonus_...)을 직접 교체해도 새 멤버로 이전된다", () => {
    const originalDonation: Donor = {
      id: "don_456",
      name: "열혈팬",
      donorName: "열혈팬",
      amount: 30000,
      memberId: "m_jina",
      at: 2000000,
      target: "account",
      sigPrice: 30000,
      claimedZubzubQueueId: "queue_777",
    };

    const zubzubLog: ContributionLog = {
      id: "zubzub_bonus_queue_777",
      memberId: "m_jina",
      amount: 30000,
      baseSigPrice: 30000,
      multiplier: 2,
      delta: 1,
      at: 2000050,
      isZubzubBonus: true,
      zubzubQueueId: "queue_777",
      claimedDonationId: "don_456",
    };

    const baseState: AppState = {
      members,
      donors: [originalDonation],
      contributionLogs: [zubzubLog],
      zubzubWaitingItems: [
        {
          id: "queue_777",
          userId: "zakiexcel",
          sigName: "777 시그",
          sigIndex: 2,
          bonusAmount: 30000,
          status: "CLAIMED",
          claimedByMemberId: "m_jina",
          claimedDonationId: "don_456",
          enqueuedAt: 1999900,
          claimedAt: 2000050,
        },
      ],
      zubzubSettings: {
        enabled: true,
        multiplier: 2,
        applyContributionToPongdang: true,
      },
    };

    // 줍줍 보너스 로그 행 ID를 직접 전달하여 채영으로 변경
    const reassigned = reassignDonorMemberInAppState(baseState, "zubzub_bonus_queue_777", "m_chaeyoung");
    expect(reassigned).not.toBeNull();
    if (!reassigned) return;

    const updatedLog = reassigned.contributionLogs?.find((l) => l.id === "zubzub_bonus_queue_777");
    expect(updatedLog?.memberId).toBe("m_chaeyoung");

    const updatedQueueItem = reassigned.zubzubWaitingItems?.find((q) => q.id === "queue_777");
    expect(updatedQueueItem?.claimedByMemberId).toBe("m_chaeyoung");
  });

  it("3. 메타데이터(claimedZubzubQueueId)가 누락된 과거 레거시 후원도 시간/금액 휴리스틱으로 연동되어 이전된다", () => {
    const legacyDonation: Donor = {
      id: "don_legacy",
      name: "후원자",
      amount: 20000,
      memberId: "m_jina",
      at: 3000000,
      sigPrice: 20000,
      // claimedZubzubQueueId 없음!
    };

    const legacyZubzubLog: ContributionLog = {
      id: "zubzub_bonus_legacy_queue",
      memberId: "m_jina",
      amount: 20000,
      baseSigPrice: 20000,
      multiplier: 2,
      delta: 1,
      at: 3000020, // 20ms 후 발생
      isZubzubBonus: true,
      zubzubQueueId: "legacy_queue",
      // claimedDonationId 없음!
    };

    const baseState: AppState = {
      members,
      donors: [legacyDonation],
      contributionLogs: [legacyZubzubLog],
      zubzubWaitingItems: [
        {
          id: "legacy_queue",
          userId: "zakiexcel",
          sigName: "레거시 시그",
          sigIndex: 3,
          bonusAmount: 20000,
          status: "CLAIMED",
          claimedByMemberId: "m_jina",
          enqueuedAt: 2999900,
          claimedAt: 3000020,
        },
      ],
      zubzubSettings: {
        enabled: true,
        multiplier: 2,
      },
    };

    const reassigned = reassignDonorMemberInAppState(baseState, "don_legacy", "m_surin");
    expect(reassigned).not.toBeNull();
    if (!reassigned) return;

    const updatedDonor = reassigned.donors?.find((d) => d.id === "don_legacy");
    expect(updatedDonor?.memberId).toBe("m_surin");

    // 휴리스틱으로 연동되어 함께 이전됨
    const updatedLog = reassigned.contributionLogs?.find((l) => l.id === "zubzub_bonus_legacy_queue");
    expect(updatedLog?.memberId).toBe("m_surin");
  });
});
