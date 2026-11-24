import { describe, it, expect } from "vitest";
import { formatSigSalesWon } from "@/lib/sig-sales-panel-ui";
import {
  formatSigMatchScoreLabel,
  formatSigMatchGapLabel,
  formatSigMatchManualAdjustStepLabel,
} from "@/lib/settlement-utils";

describe("시그 판매 및 시그 대전 통화/원 표기 제외 및 숫자만 표시 검증", () => {
  it("formatSigSalesWon: ₩ 및 원 표시 없이 쉼표 포맷 숫자만 반환", () => {
    expect(formatSigSalesWon(68000)).toBe("68,000");
    expect(formatSigSalesWon(160000)).toBe("160,000");
    expect(formatSigSalesWon(2564200)).toBe("2,564,200");
    expect(formatSigSalesWon(0)).toBe("0");
  });

  it("formatSigMatchScoreLabel: amount 모드에서 원 표시 없이 숫자만 반환", () => {
    expect(formatSigMatchScoreLabel(50000, "amount")).toBe("50,000");
    expect(formatSigMatchScoreLabel(1234567, "amount")).toBe("1,234,567");
    expect(formatSigMatchScoreLabel(0, "amount")).toBe("0");
  });

  it("formatSigMatchGapLabel: amount 모드에서 원 표시 없이 숫자만 반환", () => {
    expect(formatSigMatchGapLabel(25000, "amount")).toBe("25,000");
    expect(formatSigMatchGapLabel(0, "amount")).toBe("0");
  });

  it("formatSigMatchManualAdjustStepLabel: amount 모드에서 원 표시 없이 숫자만 반환", () => {
    expect(formatSigMatchManualAdjustStepLabel(10000, "amount")).toBe("10,000");
  });

  it("count 모드에서는 시그 개수 단위 정상 유지", () => {
    expect(formatSigMatchScoreLabel(5, "count")).toBe("5 시그");
    expect(formatSigMatchGapLabel(2, "count")).toBe("2 시그");
  });
});
