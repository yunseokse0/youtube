import { describe, expect, it } from "vitest";
import type { Member } from "@/types";
import {
  buildOverlayRankedMembers,
  buildRankLinkedMemberPositions,
  sortMembersForRanking,
} from "./utils";

describe("Fixed position hierarchy and rank exclusion (대표 1번째, 실장 2번째, 순위 제외)", () => {
  const members: Member[] = [
    { id: "zakiexcel", name: "자키", account: 0, toon: 17600, contribution: 17.6 },
    { id: "ina", name: "이나", account: 0, toon: 141200, contribution: 141.2 },
    { id: "jina", name: "진아", account: 0, toon: 0, contribution: 0 },
    { id: "chaerin", name: "채린", account: 0, toon: 0, contribution: 0 },
    { id: "surin", name: "수린", account: 0, toon: 0, contribution: 0 },
    { id: "chaeyoung", name: "채영", account: 0, toon: 0, contribution: 0 },
    { id: "johwa", name: "조화", account: 0, toon: 0, contribution: 0 },
  ];

  const positions: Record<string, string> = {
    zakiexcel: "대표",
    chaerin: "실장",
    ina: "",
    jina: "",
    surin: "",
    chaeyoung: "",
    johwa: "",
  };

  it("buildOverlayRankedMembers places 대표 1st, 실장 2nd, and excludes both from ranking (rank: null)", () => {
    const ranked = buildOverlayRankedMembers(
      members,
      positions,
      (m) => positions[m.id] || "",
      members,
      undefined,
      "contribution",
      {
        fixedPositionMemberIds: ["chaerin"],
        memberPositionMode: "rankLinked",
      }
    );

    // 1st: 대표 (자키), rank: null
    expect(ranked[0].m.name).toBe("자키");
    expect(ranked[0].rank).toBeNull();
    expect(ranked[0].isRepresentative).toBe(true);

    // 2nd: 실장 (채린), rank: null (순위에서 제외!)
    expect(ranked[1].m.name).toBe("채린");
    expect(ranked[1].rank).toBeNull();
    expect(ranked[1].isFixedPosition).toBe(true);

    // 3rd: 이나 (기여도 141.2로 순위 경쟁 1위!)
    expect(ranked[2].m.name).toBe("이나");
    expect(ranked[2].rank).toBe(1);

    // 4th+: 나머지 멤버들 기여도/생성순 2위부터
    expect(ranked[3].m.name).toBe("진아");
    expect(ranked[3].rank).toBe(2);

    expect(ranked[4].m.name).toBe("수린");
    expect(ranked[4].rank).toBe(3);

    expect(ranked[5].m.name).toBe("채영");
    expect(ranked[5].rank).toBe(4);

    expect(ranked[6].m.name).toBe("조화");
    expect(ranked[6].rank).toBe(5);
  });

  it("identifies '실장' as fixed position even without explicit fixedPositionMemberIds option", () => {
    const ranked = buildOverlayRankedMembers(
      members,
      positions,
      (m) => positions[m.id] || "",
      members,
      undefined,
      "contribution"
    );

    expect(ranked[0].m.name).toBe("자키");
    expect(ranked[0].rank).toBeNull();

    expect(ranked[1].m.name).toBe("채린");
    expect(ranked[1].rank).toBeNull();

    expect(ranked[2].m.name).toBe("이나");
    expect(ranked[2].rank).toBe(1);
  });

  it("sortMembersForRanking places 대표 1st, 실장 2nd and gives rank labels only to competing members in rankLinked mode", () => {
    const rankLabels = ["에이스", "과장", "대리", "사원", "인턴"];
    const rows = sortMembersForRanking(members, positions, {
      mode: "rankLinked",
      rankPositionLabels: rankLabels,
      fixedPositionMemberIds: ["chaerin"],
      rankingMetric: "contribution",
    });

    // 1st: 대표 (자키)
    expect(rows[0].name).toBe("자키");
    expect(rows[0].position).toBe("대표");

    // 2nd: 실장 (채린)
    expect(rows[1].name).toBe("채린");
    expect(rows[1].position).toBe("실장");

    // 3rd: 이나 (1위 직급 라벨인 '에이스' 부여)
    expect(rows[2].name).toBe("이나");
    expect(rows[2].position).toBe("에이스");

    // 4th: 진아 (2위 직급 라벨인 '과장' 부여)
    expect(rows[3].name).toBe("진아");
    expect(rows[3].position).toBe("과장");
  });

  it("buildRankLinkedMemberPositions assigns dynamic labels only to competing members", () => {
    const rankLabels = ["1등", "2등", "3등", "4등", "5등"];
    const roleMap = buildRankLinkedMemberPositions(members, positions, rankLabels, {
      fixedPositionMemberIds: ["chaerin"],
      rankingMetric: "contribution",
    });

    expect(roleMap["zakiexcel"]).toBe("대표");
    expect(roleMap["chaerin"]).toBe("실장");
    expect(roleMap["ina"]).toBe("1등");
    expect(roleMap["jina"]).toBe("2등");
  });
});
