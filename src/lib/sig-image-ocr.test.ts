import { describe, expect, it } from "vitest";
import { parseSigAmountFromText } from "./sig-image-ocr";

describe("parseSigAmountFromText", () => {
  it("전각 숫자와 붙은 원 표기를 인식한다", () => {
    expect(parseSigAmountFromText("특가　７６３，０００원")).toBe(763000);
    expect(parseSigAmountFromText("500000원")).toBe(500000);
  });

  it("공백 없이 숫자+원 패턴을 인식한다", () => {
    expect(parseSigAmountFromText("247000원")).toBe(247000);
  });
});
