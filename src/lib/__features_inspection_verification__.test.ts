import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));

import {
  buildRankLinkedMemberPositions,
  sortMembersForRanking,
  type MemberRankingMetric,
} from "./utils";
import {
  resolveDay777Calc,
  resolveMemberRankingMetric,
  resolvePongdangManualMode,
} from "./overlay-params";
import {
  applyOverlayDonationDisplayTotals,
  membersWithOverlayDonationAggregate,
} from "./overlay-donation-aggregate";
import type { AppState, Member, OverlayPreset } from "@/types";

describe("순위 연동 직급, 멤버 고정 직급 및 777데이 옵션 종합 정합성 검증", () => {
  const members: Member[] = [
    { id: "m1", name: "자키", account: 100_000, toon: 50_000, contribution: 50_000, restroom: 0, operating: false },
    { id: "m2", name: "열음", account: 200_000, toon: 100_000, contribution: 300_000, restroom: 0, operating: false },
    { id: "m3", name: "수린", account: 50_000, toon: 20_000, contribution: 10_000, restroom: 0, operating: false },
    { id: "m4", name: "초화", account: 10_000, toon: 5_000, contribution: 5_000, restroom: 0, operating: false },
  ];

  const rankLabels = ["대표", "이사", "부장", "과장"];

  describe("1. 순위 연동 직급 (Rank-linked position) 검증", () => {
    it("대표 미지정 시: 기여도 1위부터 순서대로 rankPositionLabels 부여", () => {
      // 기여도 순위: 열음(30만, 1위) > 자키(5만, 2위) > 수린(1만, 3위) > 초화(5천, 4위)
      const roles = buildRankLinkedMemberPositions(
        members,
        {}, // 대표 없음
        rankLabels,
        { rankingMetric: "contribution" }
      );

      expect(roles["m2"]).toBe("대표"); // 1위 열음 -> 대표
      expect(roles["m1"]).toBe("이사"); // 2위 자키 -> 이사
      expect(roles["m3"]).toBe("부장"); // 3위 수린 -> 부장
      expect(roles["m4"]).toBe("과장"); // 4위 초화 -> 과장
    });

    it("대표 지정 시: 지정된 대표는 '대표' 고정, 나머지 멤버가 1위부터 이사, 부장, 과장 순서로 부여", () => {
      // 자키(m1)를 대표로 지정
      const memberPositions = { m1: "대표" };

      // 나머지 멤버 기여도 순위: 열음(30만, 1위) > 수린(1만, 2위) > 초화(5천, 3위)
      const roles = buildRankLinkedMemberPositions(
        members,
        memberPositions,
        rankLabels,
        { rankingMetric: "contribution" }
      );

      expect(roles["m1"]).toBe("대표"); // 대표 지정 자키 -> 대표 고정
      expect(roles["m2"]).toBe("이사"); // 나머지 1위 열음 -> 이사 (rankLabels[1])
      expect(roles["m3"]).toBe("부장"); // 나머지 2위 수린 -> 부장 (rankLabels[2])
      expect(roles["m4"]).toBe("과장"); // 나머지 3위 초화 -> 과장 (rankLabels[3])
    });

    it("순위 산정 기준 변경 시(기여도순 -> 계좌금액순): 직급이 계좌 순위에 맞게 동적 재배정", () => {
      // 계좌 순위: 열음(20만, 1위) > 자키(10만, 2위) > 수린(5만, 3위) > 초화(1만, 4위)
      const rolesAccount = buildRankLinkedMemberPositions(
        members,
        {},
        rankLabels,
        { rankingMetric: "account" }
      );
      expect(rolesAccount["m2"]).toBe("대표"); // 계좌 1위 열음
      expect(rolesAccount["m1"]).toBe("이사"); // 계좌 2위 자키

      // 만약 초화(m4)의 계좌가 500_000원으로 급상승한 경우
      const updatedMembers = members.map((m) =>
        m.id === "m4" ? { ...m, account: 500_000 } : m
      );
      const rolesReordered = buildRankLinkedMemberPositions(
        updatedMembers,
        {},
        rankLabels,
        { rankingMetric: "account" }
      );
      expect(rolesReordered["m4"]).toBe("대표"); // 1위로 올라선 초화가 즉시 대표 배정
      expect(rolesReordered["m2"]).toBe("이사"); // 열음은 2위 이사로 변경
    });
  });

  describe("2. 멤버 고정 직급 (Fixed position) 및 전환 스냅샷 검증", () => {
    it("멤버 고정 직급 모드: 순위 변동과 무관하게 각 멤버의 고정 직급 유지", () => {
      const fixedPositions: Record<string, string> = {
        m1: "대표",
        m2: "이사",
        m3: "대리",
        m4: "사원",
      };

      // 기여도가 역전되어도 fixedPositions에 정의된 직급 그대로 유지
      expect(fixedPositions["m1"]).toBe("대표");
      expect(fixedPositions["m2"]).toBe("이사");
      expect(fixedPositions["m3"]).toBe("대리");
      expect(fixedPositions["m4"]).toBe("사원");
    });

    it("순위 연동 -> 직급 고정 전환 시: 현재 순위 직급이 memberPositions에 안전하게 스냅샷되어 보존", () => {
      // 순위 연동 상태에서 계산된 현재 직급
      const snapshottedPositions = buildRankLinkedMemberPositions(
        members,
        { m1: "대표" },
        rankLabels,
        { rankingMetric: "contribution" }
      );

      expect(snapshottedPositions).toEqual({
        m1: "대표",
        m2: "이사",
        m3: "부장",
        m4: "과장",
      });

      // 고정 모드로 전환 후 저장된 memberPositions가 그대로 유지됨
      const stateAfterSwitch: AppState = {
        members,
        memberPositionMode: "fixed",
        memberPositions: snapshottedPositions,
      };

      expect(stateAfterSwitch.memberPositions?.["m1"]).toBe("대표");
      expect(stateAfterSwitch.memberPositions?.["m2"]).toBe("이사");
      expect(stateAfterSwitch.memberPositions?.["m3"]).toBe("부장");
      expect(stateAfterSwitch.memberPositions?.["m4"]).toBe("과장");
    });
  });

  describe("3. 777데이 옵션 (day777Calc) 설정 및 정합성 검증", () => {
    const testState: AppState = {
      members: [
        { id: "m1", name: "자키", account: 0, toon: 0, contribution: 0, operating: false },
      ],
      donors: [
        { id: "d1", name: "후원자777", amount: 777_000, memberId: "m1", target: "account", at: 1000 },
      ],
      sigInventory: [
        { id: "sig1", name: "시그5만", price: 50_000, command: "50000" },
      ],
      rouletteState: {
        phase: "LANDED",
        startedAt: 1000,
        selectedSigs: [{ id: "sig1", name: "시그5만", price: 50_000, command: "50000" }],
      } as any,
    };

    it("resolveDay777Calc: 프리셋 및 URL 옵션 정확도", () => {
      // 1. 프리셋에 day777Calc: true 명시
      expect(resolveDay777Calc(new URLSearchParams(), { day777Calc: true }, { ready: true })).toBe(true);

      // 2. 프리셋에 day777Calc: false 명시 (강제 OFF)
      expect(resolveDay777Calc(new URLSearchParams(), { day777Calc: false }, { ready: true })).toBe(false);

      // 3. 독립 OBS URL 파라미터 day777Calc=true 단독 적용 (프리셋 연동 전 ready: false)
      expect(resolveDay777Calc(new URLSearchParams({ day777Calc: "true" }), null, { ready: false })).toBe(true);

      // 4. 퐁당퐁당 테마 기본값 -> 777데이 옵션 기본 OFF (day777Calc: false)
      expect(resolveDay777Calc(new URLSearchParams(), { theme: "excelPongdang" }, { ready: true })).toBe(false);
    });

    it("777데이 ON일 때: 777,000원 후원금은 계좌에 보존되고, 기여도는 나온 시그 50,000원만 반영", () => {
      const resultOn = applyOverlayDonationDisplayTotals(testState, { day777Calc: true });
      expect(resultOn.members[0].account).toBe(777_000); // 계좌 원장 777,000원
      expect(resultOn.members[0].contribution).toBe(50_000); // 기여도는 시그 단가 50,000원
    });

    it("777데이 OFF일 때: 777,000원 후원금이 계좌와 기여도 양쪽에 동일하게 반영", () => {
      const stateWithDirectSync: AppState = {
        ...testState,
        members: [{ id: "m1", name: "자키", account: 777_000, toon: 0, contribution: 777_000, operating: false }],
      };
      const resultOff = applyOverlayDonationDisplayTotals(stateWithDirectSync, { day777Calc: false });
      expect(resultOff.members[0].account).toBe(777_000);
      expect(resultOff.members[0].contribution).toBe(777_000);
    });
  });
});
