import { describe, expect, it } from "vitest";
import {
  isGifArrayBuffer,
  pickConsensusSigPrice,
  pickGifFrameIndices,
} from "./sig-gif-ocr-frames";

describe("sig-gif-ocr-frames", () => {
  it("GIF 시그니처를 인식한다", () => {
    const buf = new TextEncoder().encode("GIF89a").buffer;
    expect(isGifArrayBuffer(buf)).toBe(true);
    expect(isGifArrayBuffer(new ArrayBuffer(4))).toBe(false);
  });

  it("프레임 샘플 인덱스를 분산한다", () => {
    const idx = pickGifFrameIndices(91, 20);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(90);
    expect(idx.length).toBeLessThanOrEqual(20);
    expect(idx).toContain(8);
    expect(idx.some((i) => i >= 48 && i <= 76)).toBe(true);
    expect(new Set(idx).size).toBe(idx.length);
  });

  it("합의 가격을 고른다", () => {
    expect(pickConsensusSigPrice([77000, 77000, 2800])).toBe(77000);
    expect(pickConsensusSigPrice([2800])).toBe(2800);
    expect(pickConsensusSigPrice([7000, 383100, 25000, 38700])).toBe(38700);
    expect(pickConsensusSigPrice([2000, 31200])).toBe(31200);
    expect(pickConsensusSigPrice([384100])).toBeNull();
    expect(pickConsensusSigPrice([763000])).toBe(763000);
    expect(pickConsensusSigPrice([23000, 38900])).toBe(38900);
    expect(pickConsensusSigPrice([])).toBeNull();
  });
});
