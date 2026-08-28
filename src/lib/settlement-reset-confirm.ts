/** 정산 리셋 API — 사용자가 관리자 UI에 직접 입력해야만 통과 */
export const SETTLEMENT_RESET_CONFIRM_PHRASE = "정산리셋";

export type SettlementResetConfirmBody = {
  userConfirmed?: boolean;
  confirmPhrase?: unknown;
};

export function normalizeSettlementResetConfirmPhrase(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, "");
}

export function isSettlementResetExplicitlyConfirmed(
  body: SettlementResetConfirmBody | null | undefined
): boolean {
  if (!body || body.userConfirmed !== true) return false;
  return normalizeSettlementResetConfirmPhrase(body.confirmPhrase) === SETTLEMENT_RESET_CONFIRM_PHRASE;
}
