import { describe, expect, it } from "vitest";
import {
  buildDonationAlertUrl,
  donationAlertFromAppliedHint,
  donationAlertFromLatestDonor,
  donationAlertsFromUnseenDonors,
  donationContributionPoints,
  donationAlertTargetLabel,
} from "./core";
import { createManualDonationAlertSource, mergeDonationAlertSources } from "./source";

describe("donation-alert-overlay (package)", () => {
  it("maps amount to contribution points 1:1 (won = points)", () => {
    expect(donationContributionPoints(40_000)).toBe(40_000);
    expect(donationContributionPoints(4_000)).toBe(4_000);
  });

  it("labels account vs toon", () => {
    expect(donationAlertTargetLabel("account")).toBe("계좌 후원");
    expect(donationAlertTargetLabel("toon")).toBe("투네이션 후원");
  });

  it("builds OBS url with configurable basePath", () => {
    expect(buildDonationAlertUrl("din")).toContain("/overlay/donation-alert?");
    expect(buildDonationAlertUrl("din", { basePath: "/alerts" })).toContain("/alerts?");
    expect(buildDonationAlertUrl("din")).toContain("overlayAllowSse=1");
    expect(buildDonationAlertUrl("din", { host: false })).not.toContain("host=");
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

  it("manual source pushes alerts", () => {
    const manual = createManualDonationAlertSource();
    const received: string[] = [];
    const unsub = manual.subscribe((item) => received.push(item.id));
    const item = donationAlertFromLatestDonor(
      [{ id: "d1", name: "A", amount: 5000, memberId: "m1", at: 1, target: "toon" }],
      [{ id: "m1", name: "M" }]
    );
    expect(item).not.toBeNull();
    manual.push(item!);
    expect(received).toEqual(["d1"]);
    unsub();
  });

  it("mergeDonationAlertSources fans out", () => {
    const a = createManualDonationAlertSource();
    const b = createManualDonationAlertSource();
    const merged = mergeDonationAlertSources(a, b);
    let count = 0;
    merged.subscribe(() => {
      count += 1;
    });
    const item = donationAlertFromAppliedHint({ amount: 1000, donorName: "x", memberName: "y" });
    a.push(item!);
    b.push(item!);
    expect(count).toBe(2);
  });
});
