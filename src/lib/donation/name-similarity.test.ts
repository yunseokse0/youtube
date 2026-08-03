import { describe, expect, it } from "vitest";
import { nameSimilarityScore, stripHonorificSuffix } from "@/lib/donation/name-similarity";

describe("nameSimilarityScore", () => {
  it("strips honorific suffix", () => {
    expect(stripHonorificSuffix("피자님")).toBe("피자");
    expect(stripHonorificSuffix("문형배")).toBe("문형배");
  });

  it("scores identical names as 1", () => {
    expect(nameSimilarityScore("피자", "피자")).toBe(1);
    expect(nameSimilarityScore("피자님", "피자")).toBe(1);
  });

  it("scores partial inclusion highly", () => {
    expect(nameSimilarityScore("피자🍕", "피자")).toBeGreaterThan(0.9);
  });

  it("scores typos above threshold", () => {
    expect(nameSimilarityScore("문형배", "문현배")).toBeGreaterThan(0.65);
  });

  it("scores hangul consonant-skeleton names (지히 ↔ 자하)", () => {
    expect(nameSimilarityScore("지히", "자하")).toBeGreaterThanOrEqual(0.72);
  });
});
