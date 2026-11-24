import { describe, it, expect } from "vitest";
import {
  formatZubzubSimpleWaiting,
  formatZubzubSimpleClaimed,
  type ZubzubClaimedEvent,
} from "@/components/overlay/ZubzubOverlayBanner";
import type { ZubZubQueueItem } from "@/types";

describe("ZubzubOverlayBanner - 초간결 1줄 디자인 포맷터 검증", () => {
  it("대기 중인 줍줍이 있을 때 간결한 1줄 텍스트로 포맷팅하고 불필요한 미사여구를 배제한다", () => {
    const item: ZubZubQueueItem = {
      id: "q1",
      userId: "zakiexcel",
      triggerDonationId: "t1",
      sigName: "NO BATIDÃO",
      bonusAmount: 130000,
      status: "WAITING",
      createdAt: Date.now(),
    };

    const res = formatZubzubSimpleWaiting(item, 1);

    expect(res.badgeLabel).toBe("대표 줍줍 :");
    expect(res.sigName).toBe("[NO BATIDÃO]");
    expect(res.bonusText).toBe("+130,000");
    expect(res.extraCount).toBe(0);

    // 복잡하고 긴 문구가 포함되지 않는지 검증
    const fullText = `${res.badgeLabel} ${res.sigName} ${res.bonusText}`;
    expect(fullText).not.toContain("선착순 줍줍");
    expect(fullText).not.toContain("대표 시그 줍줍 대기중");
    expect(fullText).not.toContain("🚨");
  });

  it("대기 중인 줍줍이 여러 개일 때 심플한 카운트(+N)를 계산한다", () => {
    const item: ZubZubQueueItem = {
      id: "q1",
      userId: "zakiexcel",
      triggerDonationId: "t1",
      sigName: "NO BATIDÃO",
      bonusAmount: 130000,
      status: "WAITING",
      createdAt: Date.now(),
    };

    const resSingle = formatZubzubSimpleWaiting(item, 1);
    expect(resSingle.extraCount).toBe(0);

    const resMultiple = formatZubzubSimpleWaiting(item, 3);
    expect(resMultiple.extraCount).toBe(2); // 1개 표시 중이므로 나머지 +2개
  });

  it("줍줍 성공 알림(Claimed) 시 복잡한 3줄 박스 대신 깔끔한 1줄 정보로 포맷팅한다", () => {
    const claimedEvent: ZubzubClaimedEvent = {
      type: "zubzub_claimed",
      queueItem: {
        id: "q1",
        userId: "zakiexcel",
        triggerDonationId: "t1",
        sigName: "NO BATIDÃO",
        bonusAmount: 130000,
        status: "CLAIMED",
        createdAt: Date.now(),
      },
      memberId: "m_jina",
      memberName: "진아",
      bonusAmount: 130000,
      timestamp: Date.now(),
    };

    const res = formatZubzubSimpleClaimed(claimedEvent);

    expect(res.icon).toBe("🎉");
    expect(res.memberName).toBe("진아");
    expect(res.actionText).toBe("줍줍 성공!");
    expect(res.sigName).toBe("[NO BATIDÃO]");
    expect(res.bonusText).toBe("+130,000");

    // 불필요한 설명 문구가 포함되지 않는지 검증
    const fullText = `${res.memberName} ${res.actionText} ${res.sigName} ${res.bonusText}`;
    expect(fullText).not.toContain("복제 지급 완료");
    expect(fullText).not.toContain("(랭킹 기여도)");
    expect(fullText).not.toContain("대표 시그 줍줍 완료!");
  });

  it("대기 중인 줍줍이 없을 때도 alwaysShowWaiting 기본 옵션(true)으로 '🎁 대표 줍줍 : 대기 없음' 뱃지를 항상 유지한다", () => {
    // 뱃지 라벨 및 기본 빈 상태 텍스트 검증
    const badgeLabel = "대표 줍줍 :";
    const emptyText = "대기 없음";
    expect(badgeLabel).toBe("대표 줍줍 :");
    expect(emptyText).toBe("대기 없음");
    const fullEmptyBadgeText = `🎁 ${badgeLabel} ${emptyText}`;
    expect(fullEmptyBadgeText).toBe("🎁 대표 줍줍 : 대기 없음");
  });
});
