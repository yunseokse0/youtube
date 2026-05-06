import { describe, expect, it } from "vitest";
import type { SigItem } from "@/types";
import {
  dedupeSigInventory,
  normalizeSigDedupKeyImageUrl,
  normalizeSigDedupKeyNamePrice,
} from "./sig-inventory-dedup";
import { ONE_SHOT_SIG_ID } from "./sig-roulette";

const base = (over: Partial<SigItem>): SigItem => ({
  id: "a",
  name: "테스트",
  price: 1000,
  imageUrl: "/x.png",
  memberId: "",
  maxCount: 1,
  soldCount: 0,
  isRolling: false,
  isActive: true,
  ...over,
});

describe("normalizeSigDedupKeyImageUrl", () => {
  it("http(s)는 origin+pathname으로 통일한다", () => {
    expect(normalizeSigDedupKeyImageUrl("https://Ex.COM/path/sig.gif?v=1")).toBe(
      normalizeSigDedupKeyImageUrl("https://ex.com/path/sig.gif")
    );
  });
});

describe("dedupeSigInventory", () => {
  it("이미지 URL 기준으로 위쪽 행만 남긴다", () => {
    const inv: SigItem[] = [
      base({ id: "1", imageUrl: "https://cdn/a.gif" }),
      base({ id: "2", imageUrl: "https://cdn/a.gif?v=2" }),
      base({ id: "3", imageUrl: "https://cdn/b.gif" }),
    ];
    const { nextInventory, removedCount } = dedupeSigInventory(inv, "imageUrl");
    expect(removedCount).toBe(1);
    expect(nextInventory.map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("원샷 행은 유지하고 나머지만 중복 제거한다", () => {
    const inv: SigItem[] = [
      base({ id: ONE_SHOT_SIG_ID, name: "원샷", imageUrl: "https://cdn/z.gif" }),
      base({ id: "1", imageUrl: "https://cdn/a.gif" }),
      base({ id: "2", imageUrl: "https://cdn/a.gif" }),
    ];
    const { nextInventory, removedCount } = dedupeSigInventory(inv, "imageUrl");
    expect(removedCount).toBe(1);
    expect(nextInventory.some((x) => x.id === ONE_SHOT_SIG_ID)).toBe(true);
    expect(nextInventory.filter((x) => x.imageUrl.includes("/a.gif")).length).toBe(1);
  });

  it("이름+가격 기준 중복 제거", () => {
    const inv: SigItem[] = [
      base({ id: "1", name: "  식사  ", price: 3000, imageUrl: "/a.png" }),
      base({ id: "2", name: "식사", price: 3000, imageUrl: "/b.png" }),
    ];
    const { removedCount } = dedupeSigInventory(inv, "nameAndPrice");
    expect(removedCount).toBe(1);
  });
});

describe("normalizeSigDedupKeyNamePrice", () => {
  it("공백 정규화 후 동일 키", () => {
    expect(normalizeSigDedupKeyNamePrice("  A  ", 100)).toBe(normalizeSigDedupKeyNamePrice("A", 100));
  });
});
