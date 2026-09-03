import { describe, expect, it } from "vitest";
import {
  donationApplyContentKey,
  donationApplyPrimaryKey,
  donationContentClaimTtlSec,
  donationContentDedupeFingerprint,
} from "./donation-dedupe-keys";
import type { DonationEvent } from "./types";

describe("donationApplyPrimaryKey", () => {
  it("uses reliable external id", () => {
    const event: DonationEvent = {
      id: "toonation:abc::review",
      provider: "toonation",
      externalId: "donation-99",
      donorName: "익명",
      amount: 1000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    expect(donationApplyPrimaryKey("u1", event)).toBe("u1:toonation:ext:donation-99");
  });

  it("uses event id when external id is weak timestamp fallback", () => {
    const event: DonationEvent = {
      id: "toonation:1718100000000-1000-1-abc",
      provider: "toonation",
      externalId: "1718100000000-1000-1-abc",
      donorName: "익명",
      amount: 1000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    expect(donationApplyPrimaryKey("u1", event)).toContain("u1:evt:");
  });

  it("uses real toonation ext for toon-{real}-{unique} weak ids", () => {
    const event: DonationEvent = {
      id: "toonation:toon-donation-8821-1735680000000-19200-0-abc",
      provider: "toonation",
      externalId: "toon-donation-8821-1735680000000-19200-0-abc",
      donorName: "소밍",
      amount: 19200,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    expect(donationApplyPrimaryKey("u1", event)).toBe("u1:toonation:ext:donation-8821");
    expect(donationApplyContentKey("u1", event)).toBeNull();
  });

  it("does not treat fp- fallback as reliable external id", () => {
    const at = "2026-08-20T11:12:56.000Z";
    const event: DonationEvent = {
      id: "toonation:fp-1",
      provider: "toonation",
      externalId: "fp-1",
      donorName: "익명5",
      amount: 60000,
      message: "계좌 익명5 피자",
      at,
      status: "queued",
      target: "account",
    };
    expect(donationApplyContentKey("u1", event)).toBe(
      "u1:content:익명5|60000|account|계좌 익명5 피자"
    );
    expect(donationContentDedupeFingerprint(event)).toBe("익명5|60000|account|계좌 익명5 피자");
  });

  it("donationApplyContentKey uses sliding fingerprint for weak id + non-empty message", () => {
    const event: DonationEvent = {
      id: "toonation:fp-10000-msg-aaa",
      provider: "toonation",
      externalId: "fp-10000-msg-aaa",
      donorName: "구름하정",
      amount: 10000,
      message: "시그니처 팬덤시그 - 언니 생일",
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    expect(donationApplyContentKey("u1", event)).toBe(
      "u1:content:구름하정|10000|toon|시그니처 팬덤시그 - 언니 생일"
    );
    expect(donationContentClaimTtlSec(event)).toBe(15);
  });

  it("donationApplyContentKey is null for reliable external id even with identical message", () => {
    const event: DonationEvent = {
      id: "toonation:donation-99",
      provider: "toonation",
      externalId: "donation-99",
      donorName: "구름하정",
      amount: 10000,
      message: "시그니처 팬덤시그 - 언니 생일",
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    expect(donationApplyContentKey("u1", event)).toBeNull();
  });
});
