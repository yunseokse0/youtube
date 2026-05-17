import { describe, expect, it } from "vitest";
import { applySigNamePriceFallback, refineCommonSigOcrMisreads } from "./sig-price-ocr-refine";

describe("refineCommonSigOcrMisreads", () => {
  it("흔한 오인식을 보정한다", () => {
    expect(refineCommonSigOcrMisreads(34200)).toBe(31200);
    expect(refineCommonSigOcrMisreads(35700)).toBe(38700);
    expect(refineCommonSigOcrMisreads(38900)).toBe(38900);
    expect(refineCommonSigOcrMisreads(23000)).toBe(23000);
  });

  it("시그 이름 폴백을 적용한다", () => {
    expect(applySigNamePriceFallback("간바레센빠이", 4200)).toBe(31200);
    expect(applySigNamePriceFallback("간바레센빠이", 31200)).toBe(31200);
    expect(applySigNamePriceFallback("APT", 38700)).toBe(38900);
    expect(applySigNamePriceFallback("APT", 38900)).toBe(38900);
    expect(applySigNamePriceFallback("고민중독", null)).toBe(38700);
    expect(applySigNamePriceFallback("04클럽춤", 0)).toBe(23000);
  });
});
