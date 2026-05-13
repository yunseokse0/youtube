import { describe, expect, it } from "vitest";
import type { SigItem } from "@/types";
import {
  dedupeSigInventory,
  normalizeSigDedupKeyImageUrl,
  normalizeSigDedupKeyName,
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
  it("이미지 URL 기준으로 위쪽 행만 남긴다(이름은 행마다 다름)", () => {
    const inv: SigItem[] = [
      base({ id: "1", name: "A", imageUrl: "https://cdn/a.gif" }),
      base({ id: "2", name: "B", imageUrl: "https://cdn/a.gif?v=2" }),
      base({ id: "3", name: "C", imageUrl: "https://cdn/b.gif" }),
    ];
    const { nextInventory, removedCount } = dedupeSigInventory(inv, "imageUrl");
    expect(removedCount).toBe(1);
    expect(nextInventory.map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("imageUrl 전략: URL은 다르지만 이름이 같으면 아래쪽 행을 제거한다", () => {
    const inv: SigItem[] = [
      base({ id: "1", name: "애교", imageUrl: "https://cdn/a.gif" }),
      base({ id: "2", name: "애 교", imageUrl: "https://cdn/b.gif" }),
      base({ id: "3", name: "댄스", imageUrl: "https://cdn/c.gif" }),
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

describe("normalizeSigDedupKeyName", () => {
  it("엑셀 업로드와 동일하게 공백 제거 후 소문자로 통일", () => {
    expect(normalizeSigDedupKeyName("애 교")).toBe(normalizeSigDedupKeyName("애교"));
  });
});
