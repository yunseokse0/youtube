import type { DonorsAmountFormat } from "@/types";
import { formatDonorsAmount, roundToThousand } from "@/lib/state";

/** 엑셀표 숫자 열 `ch` 폭 추정용 — 포맷된 문자열 길이(쉼표 포함) */
export function overlayFormattedAmountLength(
  n: number,
  format: DonorsAmountFormat,
  locale = "ko-KR"
): number {
  return formatDonorsAmount(n, format, locale).length;
}

/** 표에 들어갈 모든 금액 중 최대 표시 길이 */
export function maxOverlayAmountDisplayLength(
  amounts: number[],
  format: DonorsAmountFormat,
  locale = "ko-KR"
): number {
  if (!amounts.length) return 0;
  return Math.max(...amounts.map((n) => overlayFormattedAmountLength(n, format, locale)));
}

/** 풀 표기 시 천 원 반올림 후 locale 문자열 (열 폭 문서·테스트용) */
export function overlayFullAmountLabel(n: number, locale = "ko-KR"): string {
  return roundToThousand(Math.max(0, Math.round(Number(n) || 0))).toLocaleString(locale);
}
