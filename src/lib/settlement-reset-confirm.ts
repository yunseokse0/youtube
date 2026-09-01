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

/** POST /api/state 본문 — 승인 없는 정산 리셋·donationInit 플래그 제거 (403 confirm_required 방지) */
export function stripUnconfirmedSettlementResetFromApiPayload<
  T extends Record<string, unknown>,
>(body: T): T {
  if (
    body.settlementReset === true &&
    !isSettlementResetExplicitlyConfirmed(body as SettlementResetConfirmBody)
  ) {
    const {
      settlementReset: _sr,
      userConfirmed: _uc,
      confirmPhrase: _cp,
      donationInit: _di,
      ...rest
    } = body;
    return rest as T;
  }
  if (body.donationInit === true) {
    const { donationInit: _di, ...rest } = body;
    return rest as T;
  }
  return body;
}
