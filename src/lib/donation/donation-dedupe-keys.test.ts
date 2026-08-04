import { describe, expect, it } from "vitest";
import {
  donationApplyContentKey,
  donationApplyPrimaryKey,
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

  it("uses event id when external id is weak", () => {
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

  it("does not treat fp- fallback as reliable external id", () => {
    const event: DonationEvent = {
      id: "toonation:fp-10000-abc-t12",
      provider: "toonation",
      externalId: "fp-10000-abc-t12",
      donorName: "익명",
      amount: 10000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    expect(donationApplyPrimaryKey("u1", event)).toBe("u1:evt:toonation:fp-10000-abc-t12");
  });

  it("builds short-lived content key for weak ids", () => {
    const event: DonationEvent = {
      id: "toonation:fp-1",
      provider: "toonation",
      externalId: "fp-1",
      donorName: "익명5",
      amount: 60000,
      message: "계좌 익명5 피자",
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    expect(donationApplyContentKey("u1", event)).toBe(
      "u1:content:익명5|60000|account|계좌 익명5 피자"
    );
    expect(donationContentDedupeFingerprint(event)).toBe("익명5|60000|account|계좌 익명5 피자");
  });
});
