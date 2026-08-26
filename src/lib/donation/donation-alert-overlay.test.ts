import { describe, expect, it } from "vitest";
import {
  buildDonationAlertUrl,
  donationAlertFromAppliedHint,
  donationAlertFromLatestDonor,
  donationAlertsFromUnseenDonors,
  donationContributionPoints,
  donationAlertTargetLabel,
} from "@/lib/donation/donation-alert-overlay";

describe("donation-alert-overlay (compat)", () => {
  it("re-exports core helpers via @donation-alert-overlay/core", () => {
    expect(donationContributionPoints(40_000)).toBe(40_000);
    expect(donationAlertTargetLabel("account")).toBe("계좌 후원");
    expect(buildDonationAlertUrl("din")).toContain("u=din");
    expect(
      donationAlertFromAppliedHint({ donorName: "a", memberName: "b", amount: 1000 })?.amount
    ).toBe(1000);
    expect(
      donationAlertFromLatestDonor([{ id: "d1", name: "n", amount: 1, at: 1 }], [])?.id
    ).toBe("d1");
    expect(
      donationAlertsFromUnseenDonors([{ id: "d2", name: "n", amount: 1, at: 1 }], [], new Set()).length
    ).toBe(1);
  });
});
