import { describe, expect, it } from "vitest";
import {
  buildDonationAlertUrl,
  donationAlertFromAppliedHint,
  donationAlertFromLatestDonor,
  donationAlertsFromUnseenDonors,
  donationContributionPoints,
  donationAlertTargetLabel,
} from "@/lib/donation/donation-alert-overlay";

describe("donation-alert-overlay", () => {
  it("maps amount to contribution points 1:1 (won = points)", () => {
    expect(donationContributionPoints(40_000)).toBe(40_000);
    expect(donationContributionPoints(4_000)).toBe(4_000);
    expect(donationContributionPoints(10_000)).toBe(10_000);
  });

  it("labels account vs toon", () => {
    expect(donationAlertTargetLabel("account")).toBe("계좌 후원");
    expect(donationAlertTargetLabel("toon")).toBe("투네이션 후원");
  });

  it("builds OBS url with SSE allow", () => {
    expect(buildDonationAlertUrl("din")).toContain("/overlay/donation-alert?");
    expect(buildDonationAlertUrl("din")).toContain("u=din");
    expect(buildDonationAlertUrl("din")).toContain("overlayAllowSse=1");
  });

  it("builds alert from donationApplied hint", () => {
    const item = donationAlertFromAppliedHint({
      donorName: "푸바오",
      memberName: "MC거루",
      amount: 40_000,
      target: "toon",
    });
    expect(item?.contributionPoints).toBe(40_000);
    expect(item?.memberName).toBe("MC거루");
  });

  it("picks latest donor from roster", () => {
    const item = donationAlertFromLatestDonor(
      [
        { id: "d1", name: "옛", amount: 1000, memberId: "m1", at: 100, target: "account" },
        { id: "d2", name: "새", amount: 20_000, memberId: "m2", at: 200, target: "toon" },
      ],
      [
        { id: "m1", name: "A" },
        { id: "m2", name: "B" },
      ]
    );
    expect(item?.id).toBe("d2");
    expect(item?.memberName).toBe("B");
    expect(item?.contributionPoints).toBe(20_000);
  });

  it("lists unseen donors oldest-first", () => {
    const seen = new Set(["d1"]);
    const items = donationAlertsFromUnseenDonors(
      [
        { id: "d1", name: "옛", amount: 1000, memberId: "m1", at: 100, target: "account" },
        { id: "d3", name: "최신", amount: 3000, memberId: "m1", at: 300, target: "toon" },
        { id: "d2", name: "중간", amount: 2000, memberId: "m2", at: 200, target: "toon" },
      ],
      [
        { id: "m1", name: "A" },
        { id: "m2", name: "B" },
      ],
      seen
    );
    expect(items.map((i) => i.id)).toEqual(["d2", "d3"]);
  });
});
