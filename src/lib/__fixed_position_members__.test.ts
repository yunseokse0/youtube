import { describe, expect, it } from "vitest";
import { buildRankLinkedMemberPositions } from "./utils";
import type { Member } from "@/types";

describe("대표 외 특정 멤버 직급 고정 (순위 연동 제외) 기능 검증", () => {
  const members: Member[] = [
    { id: "m_rep", name: "자키", account: 0, toon: 0, contribution: 0 },
    { id: "m_sub", name: "영시리", account: 1000, toon: 0, contribution: 1000 },
    { id: "m_advisor", name: "초화", account: 5000, toon: 0, contribution: 5000 },
    { id: "m_normal1", name: "은비", account: 3000, toon: 0, contribution: 3000 },
    { id: "m_normal2", name: "루아", account: 2000, toon: 0, contribution: 2000 },
  ];

  const positions: Record<string, string> = {
    m_rep: "대표",
    m_sub: "부대표",
    m_advisor: "상임고문",
    m_normal1: "",
    m_normal2: "",
  };

  const rankLabels = ["대표", "본부장", "팀장", "과장", "사원"];

  it("순위 연동 모드에서 fixedPositionMemberIds에 지정된 멤버는 순위와 무관하게 고정 직급을 유지한다", () => {
    const roleMap = buildRankLinkedMemberPositions(
      members,
      positions,
      rankLabels,
      {
        rankingMetric: "contribution",
        fixedPositionMemberIds: ["m_sub", "m_advisor"],
      }
    );

    // 대표는 항상 대표
    expect(roleMap["m_rep"]).toBe("대표");

    // 대표 외 고정 멤버는 순위와 무관하게 설정된 직급 유지
    expect(roleMap["m_sub"]).toBe("부대표");
    expect(roleMap["m_advisor"]).toBe("상임고문");

    // 나머지 일반 멤버(은비: 3000원 -> 1위 일반멤버, 루아: 2000원 -> 2위 일반멤버)는
    // 순위에 따라 순차적으로 rankPositionLabels 직급을 부여받음
    // startIdx = 1 (대표 다음) -> 1위 일반멤버는 labels[1] ("본부장"), 2위 일반멤버는 labels[2] ("팀장")
    expect(roleMap["m_normal1"]).toBe("본부장");
    expect(roleMap["m_normal2"]).toBe("팀장");
  });

  it("fixedPositionMemberIds가 비어있으면 기존 순위 연동 로직과 100% 동일하게 동작한다", () => {
    const roleMap = buildRankLinkedMemberPositions(
      members,
      positions,
      rankLabels,
      {
        rankingMetric: "contribution",
        fixedPositionMemberIds: [],
      }
    );

    expect(roleMap["m_rep"]).toBe("대표");
    // 기여도 순: 초화(5000) > 은비(3000) > 루아(2000) > 영시리(1000)
    expect(roleMap["m_advisor"]).toBe("본부장"); // 1위
    expect(roleMap["m_normal1"]).toBe("팀장");   // 2위
    expect(roleMap["m_normal2"]).toBe("과장");   // 3위
    expect(roleMap["m_sub"]).toBe("사원");       // 4위
  });
});
