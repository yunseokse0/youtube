import { describe, expect, it } from "vitest";
import {
  isCrossDonationSourcePair,
  shouldTreatAsCrossSourceDuplicate,
  shouldTreatAsDuplicateDonationContent,
} from "./apply-donation-state";

describe("cross-source donation dedupe", () => {
  it("detects bank vs toonation id pair", () => {
    expect(isCrossDonationSourcePair("bank:sms:abc", "toonation:fp-1")).toBe(true);
    expect(isCrossDonationSourcePair("toonation:a", "toonation:b")).toBe(false);
  });

  it("flags bank+toonation same name/amount within 3m", () => {
    const at = Date.parse("2026-09-02T01:00:00+09:00");
    expect(
      shouldTreatAsCrossSourceDuplicate(
        { id: "toonation:fp-100", name: "자키집쓰볼탱69", amount: 100, at },
        {
          id: "bank:sms:xyz",
          donorName: "자키집쓰볼탱69",
          amount: 100,
          at: new Date(at + 50_000).toISOString(),
        }
      )
    ).toBe(true);
  });

  it("flags bank resend within 60s", () => {
    const at = 1_700_000_000_000;
    expect(
      shouldTreatAsCrossSourceDuplicate(
        { id: "bank:sms:a", name: "에겐", amount: 10000, at },
        { id: "bank:sms:b", donorName: "에겐", amount: 10000, at: at + 5_000 }
      )
    ).toBe(true);
  });

  it("keeps distinct toonation events with different messages", () => {
    const at = Date.now();
    expect(
      shouldTreatAsDuplicateDonationContent(
        {
          id: "toonation:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          name: "철수",
          amount: 1000,
          target: "toon",
          message: "첫번째",
          at,
        },
        {
          id: "toonation:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          donorName: "철수",
          amount: 1000,
          target: "toon",
          message: "두번째",
          at: at + 1000,
          externalId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        }
      )
    ).toBe(false);
  });
});
