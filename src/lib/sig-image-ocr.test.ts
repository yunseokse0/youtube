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

  it("소수 만·천 원 표기를 인식한다", () => {
    expect(parseSigAmountFromText("특가 7.7만")).toBe(77000);
    expect(parseSigAmountFromText("350 천 원")).toBe(350000);
  });

  it("OCR 잡음·원 없는 천단위·붙은 만원을 인식한다", () => {
    expect(parseSigAmountFromText("7 7 , 0 0 0")).toBe(77000);
    expect(parseSigAmountFromText("77.000")).toBe(77000);
    expect(parseSigAmountFromText("5O,OOO")).toBe(50000);
    expect(parseSigAmountFromText("12.5만원")).toBe(125000);
  });
});
