import { describe, expect, it } from "vitest";
import {
  maxOverlayAmountDisplayLength,
  overlayFormattedAmountLength,
  overlayFullAmountLabel,
} from "@/lib/overlay-amount-display";
import { formatManThousand } from "@/lib/state";

/** overlay/page.tsx 기본값(풀·가로·compact 아님)과 동일 */
const DEFAULT_FULL_BANK_CH = 13;
const DEFAULT_FULL_TOTAL_CH = 12;
const DEFAULT_FULL_CONTRIB_CH = 11;

describe("overlay amount display length vs column ch", () => {
  it("풀 표기: 억 단위까지 기본 계좌/투네 열(13ch)에 들어감", () => {
    const len = overlayFormattedAmountLength(99_999_999, "full");
    expect(overlayFullAmountLabel(99_999_999)).toBe("100,000,000");
    expect(len).toBeLessThanOrEqual(DEFAULT_FULL_BANK_CH);
  });

  it("풀 표기: 10억 이상은 기본 계좌 열(13ch)을 넘을 수 있음 → bankCh URL 확대 필요", () => {
    const len = overlayFormattedAmountLength(9_999_999_999, "full");
    expect(overlayFullAmountLabel(9_999_999_999)).toBe("10,000,000,000");
    expect(len).toBeGreaterThan(DEFAULT_FULL_BANK_CH);
  });

  it("풀 표기: 합계 열은 계좌+투네 합이 커지면 기본 totalCh보다 길어질 수 있음", () => {
    const combined = 5_000_000_000 + 5_000_000_000;
    const len = overlayFormattedAmountLength(combined, "full");
    expect(len).toBeGreaterThan(DEFAULT_FULL_TOTAL_CH);
  });

  it("만원 표기: 큰 금액도 문자 수가 풀보다 짧음", () => {
    const fullLen = overlayFormattedAmountLength(9_999_999_999, "full");
    const shortLen = overlayFormattedAmountLength(9_999_999_999, "short");
    expect(shortLen).toBeLessThan(fullLen);
    expect(formatManThousand(9_999_999_999).length).toBe(shortLen);
  });

  it("여러 멤버 금액 중 최대 길이로 열 폭을 잡을 수 있음", () => {
    const maxLen = maxOverlayAmountDisplayLength(
      [320_000, 12_345_678, 99_999_999],
      "full"
    );
    expect(maxLen).toBe(overlayFormattedAmountLength(99_999_999, "full"));
  });
});
