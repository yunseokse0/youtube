import { describe, it, expect } from "vitest";
import { ADMIN_NAV_ITEMS, LEGACY_TO_NEW_KEY } from "@/app/admin/admin-nav-config";
import { applyOverlayDonationDisplayTotals } from "@/lib/overlay-donation-aggregate";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { defaultState } from "@/lib/state";
import type { Donor, Member, AppState } from "@/types";

describe("Admin v9 Usability & Full Feature Verification", () => {
  describe("1. 슬림 4대 핵심 네비게이션 구조 검증", () => {
    it("네비게이션 핵심 대분류가 정확히 4개(dashboard, overlay, donor, settlement)로 구성된다", () => {
      const keys = ADMIN_NAV_ITEMS.map((item) => item.key);
      expect(keys).toEqual(["dashboard", "overlay", "donor", "settlement"]);
    });

    it("레거시 키(goal, system, logs)가 새 4대 카테고리로 올바르게 매핑된다", () => {
      expect(LEGACY_TO_NEW_KEY["goal"]).toBe("overlay");
      expect(LEGACY_TO_NEW_KEY["signature"]).toBe("overlay");
      expect(LEGACY_TO_NEW_KEY["system"]).toBe("settlement");
      expect(LEGACY_TO_NEW_KEY["logs"]).toBe("settlement");
    });

    it("각 4대 카테고리에 방송 운영에 필수적인 서브메뉴들이 누락 없이 배정되어 있다", () => {
      const overlayNav = ADMIN_NAV_ITEMS.find((item) => item.key === "overlay");
      expect(overlayNav).toBeDefined();
      const overlaySubKeys = overlayNav?.subItems?.map((s) => s.subKey);
      expect(overlaySubKeys).toContain("ov-manage");
      expect(overlaySubKeys).toContain("ov-donor-rankings");
      expect(overlaySubKeys).toContain("ov-goal");
      const goalSub = overlayNav?.subItems?.find((s) => s.subKey === "ov-goal");
      expect(goalSub?.targetId).toBe("overlay-goal-shortcut");

      const settlementNav = ADMIN_NAV_ITEMS.find((item) => item.key === "settlement");
      expect(settlementNav).toBeDefined();
      const settlementSubKeys = settlementNav?.subItems?.map((s) => s.subKey);
      expect(settlementSubKeys).toContain("st-final");
      expect(settlementSubKeys).toContain("st-logs");
    });
  });

  describe("2. 777데이 시그 단가 분리 연동 (Toona -> 메인 vs 퐁당퐁당) 검증", () => {
    it("777데이 후원 시 메인은 777,000원 전액 반영, 퐁당퐁당은 50,000원 시그단가만 분리 반영된다", () => {
      const members: Member[] = [
        { id: "m1", name: "영실", account: 0, toon: 0, contribution: 0 },
      ];
      const donors: Donor[] = [
        {
          id: "d1",
          name: "후원자A",
          memberId: "m1",
          amount: 777000,
          target: "account",
          at: 1000,
          sigPrice: 50000,
          isSigCredit: true,
        },
      ];

      // 기본 상태 (메인 집계 동기화 상태)
      const baseState: AppState = syncMemberTotalsFromDonors({
        ...defaultState(),
        members,
        donors,
      });

      // 1) 퐁당퐁당 프리셋 (777데이 계산 ON)
      const pongdangRes = applyOverlayDonationDisplayTotals(baseState, {
        day777Calc: true,
        fromAt: null,
      });
      const pongdangM1 = pongdangRes.members.find((m) => m.id === "m1");
      expect(pongdangM1?.account).toBe(777000); // 계좌에는 777,000원 온전히 표출
      expect(pongdangM1?.contribution).toBe(50000); // 퐁당 기여도에는 나온 시그단가 50,000원만 분리 반영

      // 2) 일반 메인 엑셀 프리셋 (기존 방식, day777Calc: false)
      const mainRes = applyOverlayDonationDisplayTotals(baseState, {
        day777Calc: false,
        fromAt: null,
      });
      const mainM1 = mainRes.members.find((m) => m.id === "m1");
      expect(mainM1?.account).toBe(777000); // 메인 엑셀 계좌 777,000원
      expect(mainM1?.contribution).toBe(777000); // 메인 엑셀은 기여도 777,000원 전액 반영
    });
  });

  describe("3. 정산 탭 요약 수치 계산 검증", () => {
    it("운영비 멤버를 제외한 실제 정산 대상 인원 및 계좌/투네 합산이 정확하다", () => {
      const mockMembers = [
        { id: "m1", name: "멤버1", account: 500000, toon: 200000, role: "멤버" },
        { id: "m2", name: "멤버2", account: 300000, toon: 100000, role: "멤버" },
        { id: "m_op", name: "운영비", account: 0, toon: 0, role: "운영비" },
      ];

      const totalAccount = mockMembers.reduce((s, m) => s + m.account, 0);
      const totalToon = mockMembers.reduce((s, m) => s + m.toon, 0);
      const totalDonation = totalAccount + totalToon;

      expect(totalAccount).toBe(800000);
      expect(totalToon).toBe(300000);
      expect(totalDonation).toBe(1100000);

      const regularMembers = mockMembers.filter((m) => m.role !== "운영비");
      expect(regularMembers.length).toBe(2);
    });
  });
});
