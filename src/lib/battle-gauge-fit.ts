/** 게이지 막대 안 금액 글자 — 세그먼트 폭 대비 비율(실측 공용) */
export function battleGaugeScoreWidthCqw(labelLength: number): number {
  const len = Math.max(1, Math.floor(labelLength));
  return Math.max(7, Math.min(16, 72 / len));
}
