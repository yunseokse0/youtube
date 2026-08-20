/** 정산서.xlsx 지급/전체 정산과 동일한 공제·원천세 계산 (순수 함수) */

export const PAYMENT_FEE_DEFAULTS = {
  accountPlatformFeeRate: 0,
  accountVatRate: 0.1,
  toonPlatformFeeRate: 0.1,
  toonVatRate: 0.1,
} as const;

export type PaymentFeeRates = {
  accountPlatformFeeRate: number;
  accountVatRate: number;
  toonPlatformFeeRate: number;
  toonVatRate: number;
};

export function roundWon(n: number): number {
  return Math.max(0, Math.round(Number(n) || 0));
}

/** 엑셀 ROUNDDOWN(n, -1) */
export function roundDownToTens(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n / 10) * 10;
}

/**
 * 소득세 = ROUNDDOWN(pretax×3%, -1)
 * 지방소득세 = ROUNDDOWN(소득세×10%, -1)
 * 원천세 = 합
 */
export function computeExcelWithholding(pretaxTotal: number): {
  incomeTax: number;
  localIncomeTax: number;
  withholding: number;
} {
  const base = Math.max(0, Number(pretaxTotal) || 0);
  const incomeTax = roundDownToTens(base * 0.03);
  const localIncomeTax = roundDownToTens(incomeTax * 0.1);
  return { incomeTax, localIncomeTax, withholding: incomeTax + localIncomeTax };
}

export type PaymentChannelBreakdown = {
  accountGross: number;
  accountPlatformFee: number;
  accountVat: number;
  accountNet: number;
  accountStreamerShare: number;
  toonGross: number;
  toonPlatformFee: number;
  toonVat: number;
  toonNet: number;
  toonStreamerShare: number;
  pretaxTotal: number;
  withholding: number;
  payout: number;
  incomeTax: number;
  localIncomeTax: number;
};

/**
 * 계좌: (후원 − 플랫폼수수료) × 부가세 → 순매출 × 비율 = A
 * 투네: 후원 × 수수료·부가세 → 순매출 × 비율 = B
 * 입금: (A+B) − 원천세(기본 3.3% = 엑셀 ROUNDDOWN 방식)
 */
export function computePaymentChannelBreakdown(input: {
  accountGross: number;
  toonGross: number;
  accountRatio: number;
  toonRatio: number;
  feeRate?: number;
  skipWithholding?: boolean;
  rates?: Partial<PaymentFeeRates>;
}): PaymentChannelBreakdown {
  const cfg = { ...PAYMENT_FEE_DEFAULTS, ...input.rates };
  const accountGross = roundWon(input.accountGross);
  const toonGross = roundWon(input.toonGross);
  const accountRatio = Math.max(0, Math.min(1, Number(input.accountRatio) || 0));
  const toonRatio = Math.max(0, Math.min(1, Number(input.toonRatio) || 0));
  const feeRate = Math.max(0, Number(input.feeRate) || 0);

  const accountPlatformFee = roundWon(accountGross * cfg.accountPlatformFeeRate);
  const accountVat = roundWon(Math.max(0, accountGross - accountPlatformFee) * cfg.accountVatRate);
  const accountNet = Math.max(0, accountGross - accountPlatformFee - accountVat);
  const accountStreamerShare = roundWon(accountNet * accountRatio);

  const toonPlatformFee = roundWon(toonGross * cfg.toonPlatformFeeRate);
  const toonVat = roundWon(toonGross * cfg.toonVatRate);
  const toonNet = Math.max(0, toonGross - toonPlatformFee - toonVat);
  const toonStreamerShare = roundWon(toonNet * toonRatio);

  const pretaxTotal = accountStreamerShare + toonStreamerShare;
  let incomeTax = 0;
  let localIncomeTax = 0;
  let withholding = 0;
  if (!input.skipWithholding && pretaxTotal > 0) {
    if (feeRate === 0) {
      withholding = 0;
    } else if (Math.abs(feeRate - 0.033) < 0.0005) {
      const w = computeExcelWithholding(pretaxTotal);
      incomeTax = w.incomeTax;
      localIncomeTax = w.localIncomeTax;
      withholding = w.withholding;
    } else {
      withholding = roundWon(pretaxTotal * feeRate);
    }
  }
  const payout = Math.max(0, pretaxTotal - withholding);

  return {
    accountGross,
    accountPlatformFee,
    accountVat,
    accountNet,
    accountStreamerShare,
    toonGross,
    toonPlatformFee,
    toonVat,
    toonNet,
    toonStreamerShare,
    pretaxTotal,
    withholding,
    payout,
    incomeTax,
    localIncomeTax,
  };
}

export const DEFAULT_TAX_INVOICE_VAT_RATE = 0.1;

/** 세금계산서 발행 시 원천세 차감 후 금액에 부가세 가산 */
export function computeTaxInvoiceFinalAmount(
  payoutAfterWithholding: number,
  taxInvoiceIssued: boolean,
  vatRateRaw?: number
): { outputVat: number; finalPayout: number } {
  const payout = Math.max(0, roundWon(payoutAfterWithholding));
  if (!taxInvoiceIssued) {
    return { outputVat: 0, finalPayout: payout };
  }
  const vatRate = Math.max(0, Number(vatRateRaw ?? DEFAULT_TAX_INVOICE_VAT_RATE) || DEFAULT_TAX_INVOICE_VAT_RATE);
  const outputVat = roundWon(payout * vatRate);
  return { outputVat, finalPayout: payout + outputVat };
}
