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

  it("직급 고정 인원을 제외한 순수 순위 연동 라벨(4개 등)이 직접 주어졌을 때 1위부터 순차 부여된다", () => {
    // 6명 중 자키(대표), 제인(실장 고정), 나머지 4명(진아, 수린, 재영, 조화) 순위 연동
    const sixMembers: Member[] = [
      { id: "m_jaki", name: "자키", account: 0, toon: 0, contribution: 0 },
      { id: "m_jane", name: "제인", account: 0, toon: 0, contribution: 0 },
      { id: "m_jina", name: "진아", account: 4000, toon: 0, contribution: 4000 },
      { id: "m_surin", name: "수린", account: 3000, toon: 0, contribution: 3000 },
      { id: "m_jaeyoung", name: "재영", account: 2000, toon: 0, contribution: 2000 },
      { id: "m_johwa", name: "조화", account: 1000, toon: 0, contribution: 1000 },
    ];

    const sixPositions: Record<string, string> = {
      m_jaki: "대표",
      m_jane: "실장",
    };

    // 순위 연동 멤버 4명에게 부여할 4개의 라벨
    const fourDynamicLabels = ["부대표", "이사", "부장", "과장"];

    const roleMap = buildRankLinkedMemberPositions(
      sixMembers,
      sixPositions,
      fourDynamicLabels,
      {
        rankingMetric: "contribution",
        fixedPositionMemberIds: ["m_jane"],
      }
    );

    expect(roleMap["m_jaki"]).toBe("대표");
    expect(roleMap["m_jane"]).toBe("실장");
    // 기여도 순: 진아(4000) 1위 -> labels[0]("부대표")
    expect(roleMap["m_jina"]).toBe("부대표");
    // 수린(3000) 2위 -> labels[1]("이사")
    expect(roleMap["m_surin"]).toBe("이사");
    // 재영(2000) 3위 -> labels[2]("부장")
    expect(roleMap["m_jaeyoung"]).toBe("부장");
    // 조화(1000) 4위 -> labels[3]("과장")
    expect(roleMap["m_johwa"]).toBe("과장");
  });
});
