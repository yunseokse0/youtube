import { describe, expect, it } from "vitest";
import {
  SETTLEMENT_RESET_CONFIRM_PHRASE,
  isSettlementResetExplicitlyConfirmed,
  normalizeSettlementResetConfirmPhrase,
  stripUnconfirmedSettlementResetFromApiPayload,
} from "@/lib/settlement-reset-confirm";

describe("settlement-reset-confirm", () => {
  it("accepts exact phrase with userConfirmed", () => {
    expect(
      isSettlementResetExplicitlyConfirmed({
        userConfirmed: true,
        confirmPhrase: SETTLEMENT_RESET_CONFIRM_PHRASE,
      })
    ).toBe(true);
  });

  it("accepts phrase with surrounding whitespace", () => {
    expect(
      isSettlementResetExplicitlyConfirmed({
        userConfirmed: true,
        confirmPhrase: "  정산 리셋  ",
      })
    ).toBe(true);
  });

  it("rejects missing userConfirmed", () => {
    expect(
      isSettlementResetExplicitlyConfirmed({
        confirmPhrase: SETTLEMENT_RESET_CONFIRM_PHRASE,
      })
    ).toBe(false);
  });

  it("rejects wrong phrase", () => {
    expect(
      isSettlementResetExplicitlyConfirmed({
        userConfirmed: true,
        confirmPhrase: "reset",
      })
    ).toBe(false);
  });

  it("rejects empty body", () => {
    expect(isSettlementResetExplicitlyConfirmed(null)).toBe(false);
  });

  it("normalizes phrase", () => {
    expect(normalizeSettlementResetConfirmPhrase(" 정산\n리셋 ")).toBe("정산리셋");
  });

  it("stripUnconfirmedSettlementResetFromApiPayload removes bare settlementReset", () => {
    const out = stripUnconfirmedSettlementResetFromApiPayload({
      updatedAt: 1,
      settlementReset: true,
      donors: [],
    });
    expect(out).toEqual({ updatedAt: 1, donors: [] });
  });

  it("stripUnconfirmedSettlementResetFromApiPayload keeps confirmed reset", () => {
    const out = stripUnconfirmedSettlementResetFromApiPayload({
      settlementReset: true,
      userConfirmed: true,
      confirmPhrase: SETTLEMENT_RESET_CONFIRM_PHRASE,
      donors: [],
    });
    expect(out.settlementReset).toBe(true);
    expect(out.userConfirmed).toBe(true);
  });
});
