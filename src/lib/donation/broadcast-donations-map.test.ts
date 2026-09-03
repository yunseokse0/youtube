import { describe, expect, it } from "vitest";
import type { Donor } from "@/types";
import {
  broadcastRowToDonor,
  donorToBroadcastRow,
  donorsToBroadcastRows,
} from "@/lib/donation/broadcast-donations-map";

function sampleDonor(partial?: Partial<Donor>): Donor {
  return {
    id: "d1",
    name: "에겐",
    amount: 10_000,
    memberId: "m1",
    at: 1_700_000_000_000,
    target: "toon",
    message: "화이팅",
    memberAutoAssigned: true,
    contributionPoints: 1_000,
    ...partial,
  };
}

describe("broadcast-donations-map", () => {
  it("roundtrips donor fields", () => {
    const donor = sampleDonor({
      groupSplit: true,
      donationExcluded: true,
      hsPushDir: "left",
      hsTerritoryExcluded: true,
    });
    const row = donorToBroadcastRow("din", donor, 99);
    expect(row.user_id).toBe("din");
    expect(row.member_auto_assigned).toBe(1);
    expect(row.group_split).toBe(1);
    expect(row.donation_excluded).toBe(1);
    expect(row.hs_push_dir).toBe("left");
    expect(row.contribution_points).toBe(1_000);
    expect(row.updated_at_ms).toBe(99);

    const back = broadcastRowToDonor(row);
    expect(back.id).toBe(donor.id);
    expect(back.name).toBe(donor.name);
    expect(back.amount).toBe(donor.amount);
    expect(back.memberId).toBe(donor.memberId);
    expect(back.at).toBe(donor.at);
    expect(back.target).toBe("toon");
    expect(back.message).toBe("화이팅");
    expect(back.memberAutoAssigned).toBe(true);
    expect(back.groupSplit).toBe(true);
    expect(back.donationExcluded).toBe(true);
    expect(back.hsPushDir).toBe("left");
    expect(back.hsTerritoryExcluded).toBe(true);
    expect(back.contributionPoints).toBe(1_000);
  });

  it("omits falsey optional flags on reverse map", () => {
    const row = donorToBroadcastRow("din", sampleDonor({ memberAutoAssigned: false }));
    const back = broadcastRowToDonor(row);
    expect(back.memberAutoAssigned).toBeUndefined();
  });

  it("dedupes by id when building rows", () => {
    const rows = donorsToBroadcastRows("din", [
      sampleDonor({ id: "a", amount: 1 }),
      sampleDonor({ id: "a", amount: 2 }),
      sampleDonor({ id: "b", amount: 3 }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.amount).toBe(1);
    expect(rows[1]?.id).toBe("b");
  });

  it("clamps invalid target and push dir", () => {
    const row = donorToBroadcastRow("din", sampleDonor({
      target: "cash" as Donor["target"],
      hsPushDir: "up" as Donor["hsPushDir"],
    }));
    expect(row.target).toBeNull();
    expect(row.hs_push_dir).toBeNull();
  });
});
