import { describe, expect, it } from "vitest";
import {
  aggregateDonorRankingRows,
  buildDonorRankingsFromDonors,
  dedupeDonorRowsForRanking,
} from "./donor-rankings-aggregate";

describe("donor-rankings-aggregate", () => {
  it("계좌·투네를 합쳐 닉네임별 총액 순위를 만든다", () => {
    const { unifiedTop, accountTop, toonTop } = buildDonorRankingsFromDonors(
      [
        { name: "A", amount: 1000, target: "account" },
        { name: "A", amount: 500, target: "toon" },
        { name: "B", amount: 2000, target: "toon" },
      ],
      10
    );
    expect(unifiedTop).toEqual([
      { name: "B", amount: 2000 },
      { name: "A", amount: 1500 },
    ]);
    expect(accountTop).toEqual([{ name: "A", amount: 1000 }]);
    expect(toonTop).toEqual([
      { name: "B", amount: 2000 },
      { name: "A", amount: 500 },
    ]);
  });

  it("top 으로 행 수를 자른다", () => {
    const { unifiedTop } = buildDonorRankingsFromDonors(
      [
        { name: "1", amount: 3, target: "account" },
        { name: "2", amount: 2, target: "account" },
        { name: "3", amount: 1, target: "account" },
      ],
      2
    );
    expect(unifiedTop).toHaveLength(2);
    expect(unifiedTop[0].name).toBe("1");
  });

  it("동일 투네 후원 id 중복 행은 순위 집계에서 1건만 반영", () => {
    const { unifiedTop } = buildDonorRankingsFromDonors(
      [
        { id: "toonation:abc", name: "푸른스님", amount: 5000, target: "toon", at: 100 },
        { id: "toonation:abc::review", name: "푸른스님", amount: 5000, target: "toon", at: 101 },
      ],
      10
    );
    expect(unifiedTop).toEqual([{ name: "푸른스님", amount: 5000 }]);
    expect(dedupeDonorRowsForRanking([
      { id: "toonation:abc", name: "A", amount: 1, at: 1 },
      { id: "toonation:abc::review", name: "A", amount: 1, at: 2 },
    ])).toHaveLength(1);
  });

  it("aggregateDonorRankingRows는 동명 합산", () => {
    expect(
      aggregateDonorRankingRows([
        { name: "x", amount: 1 },
        { name: "x", amount: 2 },
      ])
    ).toEqual([{ name: "x", amount: 3 }]);
  });
});
