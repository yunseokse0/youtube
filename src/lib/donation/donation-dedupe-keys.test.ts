import { describe, expect, it } from "vitest";
import { donationApplyPrimaryKey } from "./donation-dedupe-keys";
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
});
